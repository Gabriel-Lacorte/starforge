import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import {
    ErrorCode,
    applyOperation,
    createSprite,
    decodeFrame,
    decodeOperation,
    decodeSprite,
    encodeFrame,
    normalizeSpriteTitle,
    stampLamport,
    type Sprite,
} from '@starforge/core'
import type { RelayConfig } from './config.js'
import { ConnLimits, createThrottle } from './limits.js'
import { Room } from './room.js'
import { MAX_ROOMS, type RoomStore } from './store.js'
import { Telemetry, type RoomMetrics } from './telemetry.js'
import { WsSocket } from './ws/socket.js'

export const ROOM_ID_RE = /^[A-Za-z0-9_-]{12}$/

const ROOM_MIN_SIZE = 16
const ROOM_MAX_SIZE = 256
const ROOMS_PER_HOUR_PER_IP = 20

export const MAX_CONNECTIONS = 2048

export function newId(): string {
    return randomBytes(9).toString('base64url')
}

export function clientIp(req: IncomingMessage, socket: Socket): string {
    const remote = socket.remoteAddress ?? ''
    if (!isLoopback(remote)) return socket.remoteAddress ?? 'unknown'

    const cf = req.headers['cf-connecting-ip']
    const cfFirst = Array.isArray(cf) ? cf[0]?.trim() : cf?.trim()
    if (cfFirst !== undefined && cfFirst.length > 0) return cfFirst
    const forwarded = req.headers['x-forwarded-for']

    const first = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? ''))
        .split(',')[0]
        ?.trim()
    if (first !== undefined && first.length > 0) return first

    return socket.remoteAddress ?? 'unknown'
}

function isLoopback(addr: string): boolean {
    let ip = addr.trim().toLowerCase()
    if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1)
    ip = ip.split('%')[0] ?? ''

    if (ip.startsWith('::ffff:')) ip = ip.slice('::ffff:'.length)
    return ip === '::1' || ip === 'localhost' || ip.startsWith('127.')
}

export interface RoomCreateInit {
    readonly title: string
    readonly width: number
    readonly height: number
    readonly snapshot?: string
}

export interface RoomCreateError {
    readonly status: number
    readonly code: number
    readonly message: string
}

export type RoomCreateResult = { readonly id: string } | { readonly error: RoomCreateError }

export interface RoomInfo {
    readonly id: string
    readonly title: string
    readonly width: number
    readonly height: number
    readonly members: number
    readonly seq: number
}

interface RegistryEntry {
    readonly room: Room
    readonly title: string
    readonly width: number
    readonly height: number
    seq: number
}

interface PersistHooks {
    append(seq: number, stamp: number, body: Uint8Array, orderKey?: number): void
    snapshot(seq: number, bytes: Uint8Array, lamport: number): void
}

export class RoomRegistry {
    private readonly store: RoomStore
    private readonly clock: () => number
    private readonly entries = new Map<string, RegistryEntry>()
    private readonly allowCreate: (ip: string, now?: number) => boolean

    private readonly telemetry: Telemetry
    private readonly maxConnections: number
    private liveSockets = 0

    constructor(
        store: RoomStore,
        opts?: { now?: () => number; maxConnections?: number; telemetry?: Telemetry },
    ) {
        this.store = store
        this.clock = opts?.now ?? (() => Date.now())
        this.allowCreate = createThrottle(ROOMS_PER_HOUR_PER_IP)
        this.maxConnections = opts?.maxConnections ?? MAX_CONNECTIONS
        this.telemetry = opts?.telemetry ?? new Telemetry(store)
    }

    private roomMetrics(): RoomMetrics {
        return {
            count: (name: string, n?: number): void => {
                this.telemetry.count(name, n)
            },
        }
    }

    private now(): number {
        return this.clock()
    }

    private hooks(id: string): PersistHooks {
        return {
            append: (seq: number, stamp: number, body: Uint8Array, orderKey?: number): void => {
                this.store.appendOp(id, {
                    seq,
                    stamp,
                    body,
                    ...(orderKey !== undefined ? { orderKey } : {}),
                })
                const entry = this.entries.get(id)
                if (entry !== undefined) entry.seq = seq
                this.store.touch(id, this.now())
            },
            snapshot: (seq: number, bytes: Uint8Array, lamport: number): void => {
                this.store.setSnapshot(id, seq, new TextDecoder().decode(bytes), lamport)
                const entry = this.entries.get(id)
                if (entry !== undefined) entry.seq = seq
            },
        }
    }

    create(ip: string, init: RoomCreateInit): RoomCreateResult {
        const title = normalizeSpriteTitle(init.title) || 'Untitled'
        if (
            !Number.isInteger(init.width) ||
            !Number.isInteger(init.height) ||
            init.width < ROOM_MIN_SIZE ||
            init.width > ROOM_MAX_SIZE ||
            init.height < ROOM_MIN_SIZE ||
            init.height > ROOM_MAX_SIZE
        ) {
            return {
                error: {
                    status: 400,
                    code: ErrorCode.documentTooLarge,
                    message: 'canvas dimensions must be integers between 16 and 256',
                },
            }
        }

        let doc: Sprite
        if (init.snapshot !== undefined) {
            let raw: unknown
            try {
                raw = JSON.parse(init.snapshot)
            } catch {
                return {
                    error: {
                        status: 400,
                        code: ErrorCode.invalidOperation,
                        message: 'unreadable snapshot',
                    },
                }
            }
            try {
                doc = decodeSprite(raw)
            } catch {
                return {
                    error: {
                        status: 400,
                        code: ErrorCode.invalidOperation,
                        message: 'unreadable snapshot',
                    },
                }
            }
            if (doc.width !== init.width || doc.height !== init.height) {
                return {
                    error: {
                        status: 400,
                        code: ErrorCode.invalidOperation,
                        message: 'snapshot dimensions do not match',
                    },
                }
            }
            doc.meta.title = title
        } else {
            doc = createSprite({ title, width: init.width, height: init.height })
        }
        if (!this.allowCreate(ip, this.now())) {
            return {
                error: {
                    status: 429,
                    code: ErrorCode.tooManyRooms,
                    message: 'too many rooms created from this address',
                },
            }
        }

        this.evict()
        if (this.entries.size >= MAX_ROOMS) {
            let oldest: string | undefined
            let oldestAt = Number.POSITIVE_INFINITY
            for (const [id, entry] of this.entries) {
                if (entry.room.peers().length > 0) continue
                if (entry.room.touchedAt < oldestAt) {
                    oldestAt = entry.room.touchedAt
                    oldest = id
                }
            }
            if (oldest === undefined) {
                return {
                    error: {
                        status: 429,
                        code: ErrorCode.tooManyRooms,
                        message: 'too many rooms created from this address',
                    },
                }
            }
            this.entries.delete(oldest)
            this.store.deleteRoom(oldest)
        }

        let id = newId()
        while (this.entries.has(id)) id = newId()
        const room = new Room(doc, this.hooks(id), this.roomMetrics())
        const at = this.now()
        this.store.saveRoom({
            id,
            title,
            width: init.width,
            height: init.height,
            snapshot: new TextDecoder().decode(room.snapshotBytes()),
            snapshotSeq: 0,
            touchedAt: at,
            lamport: 0,
        })
        room.touch(at)
        this.entries.set(id, { room, title, width: init.width, height: init.height, seq: 0 })
        this.telemetry.count('rooms_created')
        return { id }
    }

    get(id: string): Room | undefined {
        return this.entries.get(id)?.room
    }

    stats(): {
        rooms: { live: number; created: number }
        painters: { now: number }
        ops: { applied: number; rejected: number }
        sockets: { open: number; opened: number }
        resyncs: number
        bytesIn: number
        uptimeSeconds: number
    } {
        const snap = this.telemetry.snapshot()
        let painters = 0
        for (const entry of this.entries.values()) painters += entry.room.peers().length
        return {
            rooms: { live: this.entries.size, created: snap.lifetime.rooms_created ?? 0 },
            painters: { now: painters },
            ops: {
                applied: snap.lifetime.ops_applied ?? 0,
                rejected:
                    (snap.lifetime.ops_rejected ?? 0) +
                    (snap.session.rate_limited_ops ?? 0) +
                    (snap.session.rate_limited_bytes ?? 0),
            },
            sockets: {
                open: this.liveSockets,
                opened: snap.lifetime.sockets_opened ?? 0,
            },
            resyncs: snap.lifetime.resyncs_sent ?? 0,
            bytesIn: snap.session.bytes_in ?? 0,
            uptimeSeconds: snap.uptimeSeconds,
        }
    }

    flushTelemetry(): void {
        this.telemetry.flush()
    }

    seedRoomsEver(count: number): void {
        this.telemetry.seedAtLeast('rooms_created', count)
    }

    roomInfo(id: string): RoomInfo | null {
        const entry = this.entries.get(id)
        if (entry === undefined) return null

        return {
            id,
            title: entry.title,
            width: entry.width,
            height: entry.height,
            members: entry.room.peers().length,
            seq: entry.seq,
        }
    }

    evict(): number {
        const now = this.now()
        for (const [id, entry] of this.entries) {
            if (entry.room.peers().length > 0) {
                entry.room.touch(now)
                this.store.touch(id, now)
            }
        }

        const pruned = this.store.pruneStale(now)
        if (pruned > 0) {
            const live = new Set(this.store.loadAll().map((row) => row.room.id))
            for (const [id, entry] of [...this.entries]) {
                if (!live.has(id) && entry.room.peers().length === 0) this.entries.delete(id)
            }
        }
        return pruned
    }

    rehydrate(): { rooms: number; dropped: number } {
        let rooms = 0
        let dropped = 0
        for (const { room: stored, ops } of this.store.loadAll()) {
            if (this.entries.has(stored.id)) continue

            let doc: Sprite
            try {
                doc = decodeSprite(JSON.parse(stored.snapshot))
            } catch {
                this.store.deleteRoom(stored.id)
                dropped += 1
                continue
            }

            const log: { seq: number; stamp: number; body: Uint8Array; orderKey?: number }[] = []
            let seq = stored.snapshotSeq
            let lamport = stored.lamport
            for (const op of ops) {
                if (op.seq <= stored.snapshotSeq) continue

                try {
                    applyOperation(doc, decodeOperation(op.body))
                } catch {
                    continue
                }

                const at = stampLamport(op.stamp)
                if (at > lamport) lamport = at
                log.push({
                    seq: op.seq,
                    stamp: op.stamp,
                    body: op.body,
                    ...(op.orderKey !== undefined ? { orderKey: op.orderKey } : {}),
                })
                if (op.seq > seq) seq = op.seq
            }

            const room = new Room(doc, this.hooks(stored.id), this.roomMetrics())
            room.restore(stored.snapshotSeq, seq, lamport, log)
            room.touch(stored.touchedAt)
            this.entries.set(stored.id, {
                room,
                title: stored.title,
                width: stored.width,
                height: stored.height,
                seq,
            })
            rooms += 1
        }
        return { rooms, dropped }
    }

    attach(raw: Socket, _ip: string, config: RelayConfig): void {
        if (this.liveSockets >= this.maxConnections) {
            raw.destroy()
            return
        }
        this.liveSockets += 1
        this.telemetry.count('sockets_opened')

        const peer = new WsSocket(raw, config.maxMessageBytes)
        let room: Room | undefined
        let site: number | null = null
        let helloSeen = false
        let lastSeen = Date.now()
        const limits = new ConnLimits()

        const timer = setTimeout(() => {
            if (!helloSeen) peer.close(1008)
        }, 5000)
        timer.unref()

        const heartbeat = setInterval(() => {
            if (Date.now() - lastSeen >= 90000) {
                clearInterval(heartbeat)
                peer.close(1001)
                if (site !== null && room !== undefined) room.leave(site)
                site = null
            } else {
                peer.ping()
            }
        }, 30000)
        heartbeat.unref()

        peer.onMessage = (opcode, payload) => {
            lastSeen = Date.now()
            this.telemetry.count('bytes_in', payload.length)
            if (opcode !== 0x2) {
                peer.close(1002)
                return
            }

            if (!helloSeen) {
                let frame
                try {
                    frame = decodeFrame(payload)
                } catch {
                    clearTimeout(timer)
                    peer.close(1002)
                    return
                }

                if (frame.type !== 'hello') {
                    clearTimeout(timer)
                    peer.close(1008)
                    return
                }

                const entry = ROOM_ID_RE.test(frame.room) ? this.entries.get(frame.room) : undefined
                if (entry === undefined) {
                    helloSeen = true
                    clearTimeout(timer)
                    peer.send(
                        encodeFrame({
                            type: 'error',
                            code: ErrorCode.roomNotFound,
                            message: 'room not found',
                        }),
                    )
                    peer.close(1008)
                    return
                }

                room = entry.room
                const result = entry.room.join(peer, frame)
                helloSeen = true
                clearTimeout(timer)
                if ('site' in result) {
                    site = result.site
                    this.store.touch(frame.room, this.now())
                }

                return
            }

            if (site !== null && room !== undefined) room.onBytes(site, payload, limits)
        }

        peer.onPong = (): void => {
            lastSeen = Date.now()
        }

        peer.onClose = () => {
            clearTimeout(timer)
            clearInterval(heartbeat)
            this.liveSockets -= 1
            if (site !== null && room !== undefined) room.leave(site)
        }
    }
}
