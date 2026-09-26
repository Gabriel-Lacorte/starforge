import {
    ErrorCode,
    GeometryLockedError,
    Replica,
    WIRE_PROTOCOL,
    decodeOperation,
    decodeSprite,
    encodeOperation,
    splitPixelPatch,
    type DocumentOperation,
    type NetFrame,
    type Sprite,
} from '@starforge/core'
import { DocumentSession } from '../document/session'
import type { ToolId } from '../editor/store'
import type { StrokeBroadcast } from '../editor/strokeBroadcast'
import { RoomConnection, type ConnStatus } from './connection'
import { Outbox } from './outbox'
import { PresenceStore, toolFromWire, toolToWire } from './presence'
import type { RoomProfile } from './profile'
import { localStoragePendingStore, type PendingStore } from './pendingStore'

export interface RoomCreateInit {
    readonly title: string
    readonly width: number
    readonly height: number
    readonly snapshot?: unknown
}

export async function createRoom(
    apiBase: string,
    init: RoomCreateInit,
    fetchImpl: typeof fetch = fetch,
): Promise<{ id: string }> {
    let response
    try {
        response = await fetchImpl(`${apiBase}/api/rooms`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(init),
        })
    } catch {
        throw new Error('could not reach the relay, the relay may be down :C')
    }
    if (response.ok) {
        const data = (await response.json()) as { id: string }
        return { id: data.id }
    }
    if (response.status === 429) throw new Error('too many rooms created, try again later')
    if (response.status >= 500) {
        throw new Error('could not reach the relay, the relay may be down :C')
    }
    let code: unknown
    try {
        code = ((await response.json()) as { error?: unknown }).error
    } catch {
        code = undefined
    }
    if (response.status === 400 && code === 'document_too_large') {
        throw new Error('canvas too large for a room (16 to 256 per side)')
    }
    throw new Error(`invalid room (${String(response.status)})`)
}

export interface ToolSource {
    readonly state: { readonly tool: ToolId }
}

export interface HoverSource {
    readonly state: { readonly hover: { readonly x: number; readonly y: number } | null }
}

export type StrokeSource = Pick<StrokeBroadcast, 'take'>

export interface RoomConnectionLike {
    onFrame: (frame: NetFrame) => void
    onError: (message: string, code?: number) => void

    send(frame: NetFrame): void
    status(): ConnStatus
    subscribe(listener: () => void): () => void
    close(): void
    connect?(): void

    readonly lastSeq: number
    resetSeq(seq: number): void
}

export interface SeqStore {
    load(roomId: string): number
    save(roomId: string, seq: number): void
}

const SEQ_KEY = 'starforge:lastSeq:'

function localStorageSeqStore(): SeqStore {
    return {
        load(roomId: string): number {
            try {
                if (typeof localStorage === 'undefined') return 0
                const raw = localStorage.getItem(`${SEQ_KEY}${roomId}`)
                const parsed = raw === null ? 0 : Number(raw)
                return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
            } catch {
                return 0
            }
        },
        save(roomId: string, seq: number): void {
            try {
                if (typeof localStorage === 'undefined') return
                localStorage.setItem(`${SEQ_KEY}${roomId}`, String(seq))
            } catch {
                /* private mode */
            }
        },
    }
}

export interface RoomControllerOptions {
    readonly url: string
    readonly room: string
    readonly profile: RoomProfile
    readonly connection?: RoomConnectionLike
    readonly store?: ToolSource
    readonly readout?: HoverSource
    readonly stroke?: StrokeSource

    readonly since?: number
    readonly seqStore?: SeqStore
    readonly pendingStore?: PendingStore
}

const PRESENCE_MS = 50
const OPS_BURST = 12
const OPS_PER_TICK = 2
const RATE_LIMIT_RETRY_MS = 1500
const PRESENCE_HEARTBEAT_MS = 5000
const REMINT_DRAIN_MS = 800
const GEOMETRY_NOTICE = 'canvas size is locked while the room is open'
const RATE_LIMIT_NOTICE = 'the relay is busy, catching up shortly'

interface PendingConnect {
    readonly promise: Promise<DocumentSession>
    readonly resolve: (session: DocumentSession) => void
    readonly reject: (error: Error) => void
}

function splitPixelPatchIfNeeded(op: DocumentOperation): DocumentOperation[] {
    if (op.kind !== 'pixel.patch') return [op]
    return splitPixelPatch(op)
}

export class RoomController {
    session: DocumentSession | null = null
    readonly peers = new PresenceStore()
    readonly notices: string[] = []
    onNotice: (message: string) => void = (): void => undefined
    onResync: (doc: Sprite, seq: number) => void = (): void => undefined

    private readonly profile: RoomProfile
    private readonly connection: RoomConnectionLike
    private readonly toolStore: ToolSource | undefined
    private readonly readout: HoverSource | undefined
    private readonly strokeSource: StrokeSource | undefined
    private readonly seqStore: SeqStore
    private readonly roomId: string
    private replica: Replica | null = null
    private site: number | null = null
    private currentError: string | null = null
    private readonly listeners = new Set<() => void>()
    private pending: PendingConnect | null = null
    private timer: ReturnType<typeof setInterval> | null = null
    private retryTimer: ReturnType<typeof setTimeout> | null = null
    private lastPresenceKey: string | null = null
    private lastPresenceAt = 0
    private sendPausedUntil = 0
    private remintAt = 0
    private readonly onVisible: () => void = (): void => undefined
    private operationUnsub: (() => void) | null = null
    private readonly opQueue: Extract<NetFrame, { type: 'op' }>[] = []
    private readonly queuedStamps = new Set<number>()

    private readonly outbox = new Outbox()

    private forwardedLocal: DocumentOperation | null = null
    private wasOpen = false
    private readonly pendingStore: PendingStore

    constructor(opts: RoomControllerOptions) {
        this.profile = opts.profile
        this.toolStore = opts.store
        this.readout = opts.readout
        this.strokeSource = opts.stroke
        this.roomId = opts.room
        if (opts.connection !== undefined) {
            this.connection = opts.connection
        } else {
            let live: RoomConnection | null = null
            live = new RoomConnection(opts.url, () => ({
                type: 'hello',
                protocol: WIRE_PROTOCOL,
                room: opts.room,
                nickname: this.profile.nickname,
                color: this.profile.color,
                since: live?.lastSeq ?? 0,
            }))
            this.connection = live
        }
        this.seqStore = opts.seqStore ?? localStorageSeqStore()
        const seeded = opts.since ?? this.seqStore.load(opts.room)
        if (seeded > 0) this.connection.resetSeq(seeded)
        this.pendingStore = opts.pendingStore ?? localStoragePendingStore()
        for (const entry of this.pendingStore.load(opts.room)) {
            this.outbox.add(entry.stamp, entry.body, entry.orderKey)
        }
        this.connection.onFrame = (frame): void => {
            this.handleFrame(frame)
        }
        this.connection.onError = (message, code): void => {
            this.handleError(message, code)
        }
        this.connection.subscribe((): void => {
            this.handleStatus()
            this.notify()
        })
        this.timer = setInterval((): void => {
            this.flushOps(OPS_PER_TICK)
            this.tickPresence()
            if (this.remintAt !== 0 && Date.now() >= this.remintAt) this.remintDrained()
            const before = this.peers.peers().length
            this.peers.sweep(Date.now())
            if (this.peers.peers().length !== before) this.notify()
        }, PRESENCE_MS)

        if (typeof document !== 'undefined') {
            this.onVisible = (): void => {
                if (document.visibilityState === 'visible') this.tickPresence()
            }
            document.addEventListener('visibilitychange', this.onVisible)
        }
    }

    connect(): Promise<DocumentSession> {
        if (this.session !== null) return Promise.resolve(this.session)
        if (this.pending !== null) return this.pending.promise
        let resolve!: (session: DocumentSession) => void
        let reject!: (error: Error) => void
        const promise = new Promise<DocumentSession>((res, rej): void => {
            resolve = res
            reject = rej
        })
        this.pending = { promise, resolve, reject }
        this.connection.connect?.()
        return promise
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener)
        return (): void => {
            this.listeners.delete(listener)
        }
    }

    status(): ConnStatus {
        return this.connection.status()
    }

    error(): string | null {
        return this.currentError
    }

    close(): void {
        if (this.timer !== null) {
            clearInterval(this.timer)
            this.timer = null
        }
        if (this.retryTimer !== null) {
            clearTimeout(this.retryTimer)
            this.retryTimer = null
        }
        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.onVisible)
        }
        this.operationUnsub?.()
        this.operationUnsub = null
        this.session?.setCollaborative(null)
        const pending = this.pending
        this.pending = null
        pending?.reject(new Error('room closed before the relay welcomed this client'))
        this.connection.close()
        this.notify()
    }

    private handleFrame(frame: NetFrame): void {
        switch (frame.type) {
            case 'welcome':
                this.handleWelcome(frame)
                break
            case 'op':
                this.handleOp(frame.seq, frame.stamp, frame.body, frame.orderKey)
                break
            case 'presence':
                this.peers.applyPresence(
                    frame.site,
                    frame.x,
                    frame.y,
                    toolFromWire(frame.tool),
                    frame.layer,
                    frame.frame,
                    frame.nickname,
                    frame.color,
                    frame.preview,
                    Date.now(),
                )
                this.notify()
                break
            case 'peerJoin':
                this.peers.applyJoin(frame.site, frame.nickname, frame.color, Date.now())
                this.notify()
                break
            case 'peerLeave':
                this.peers.applyLeave(frame.site)
                this.notify()
                break
            case 'resync':
                this.handleResync(frame.seq, frame.snapshot)
                break
            case 'error':
                this.handleError(frame.message)
                break
            case 'hello':
                break
        }
    }

    private handleWelcome(frame: Extract<NetFrame, { type: 'welcome' }>): void {
        if (this.session !== null) {
            this.handleRewelcome(frame)
            return
        }
        let sprite: Sprite
        try {
            sprite = decodeSprite(JSON.parse(new TextDecoder().decode(frame.snapshot)) as unknown)
        } catch {
            const pending = this.pending
            this.pending = null
            this.currentError = 'the relay sent a snapshot this client cannot read'
            pending?.reject(new Error('the relay sent a snapshot this client cannot read'))
            this.notify()
            return
        }
        const site = frame.site
        const session = new DocumentSession(sprite, {
            author: `net-${String(site)}-${this.profile.nickname}`,
        })
        this.site = site
        this.seqStore.save(this.roomId, frame.seq)
        this.session = session
        this.replica = new Replica(session.doc, site)
        this.replica.observeLamport(frame.lamport)
        for (const peer of frame.peers ?? []) {
            this.peers.applyJoin(peer.site, peer.nickname, peer.color, Date.now())
        }
        this.operationUnsub = session.onOperation((op, origin): void => {
            if (origin !== 'local') return
            this.handleLocalOperation(op)
        })
        session.setCollaborative({
            filter: (op): DocumentOperation | null => this.replica?.filterInverse(op) ?? null,
            publish: (op): void => this.publishAlreadyApplied(op),
        })
        this.recoverPendingInto(session)
        const pending = this.pending
        this.pending = null
        pending?.resolve(session)
        this.notify()
    }

    private recoverPendingInto(session: DocumentSession): void {
        for (const entry of this.outbox.pending) {
            try {
                session.applyRemote(decodeOperation(entry.body))
            } catch {
                /* unreadable or locked */
            }
        }
        this.scheduleRemint()
    }

    private scheduleRemint(): void {
        this.remintAt = Date.now() + REMINT_DRAIN_MS
    }

    private remintDrained(): void {
        this.remintAt = 0
        const stale = this.outbox.takeAll()
        for (const entry of stale) this.queuedStamps.delete(entry.stamp)
        this.persistPending()
        for (const entry of stale) {
            try {
                this.sendAlreadyApplied(decodeOperation(entry.body))
            } catch {
                /* an unreadable pending op is dropped, not retried forever */
            }
        }
    }

    private handleRewelcome(frame: Extract<NetFrame, { type: 'welcome' }>): void {
        const session = this.session
        if (session === null) return
        this.seqStore.save(this.roomId, frame.seq)
        this.peers.reset()
        for (const peer of frame.peers ?? []) {
            this.peers.applyJoin(peer.site, peer.nickname, peer.color, Date.now())
        }

        if (this.site !== null && frame.site !== this.site) {
            this.site = frame.site
            this.replica = new Replica(session.doc, frame.site)
            this.replica.observeLamport(frame.lamport)
            this.scheduleRemint()
        } else if (this.replica !== null) {
            this.replica.observeLamport(frame.lamport)
            this.resendPending()
        }
        this.notify()
    }

    private handleOp(
        seq: number,
        stamp: number,
        body: Uint8Array,
        orderKey: number | undefined,
    ): void {
        this.seqStore.save(this.roomId, seq)
        if (this.outbox.ack(stamp)) {
            this.queuedStamps.delete(stamp)
            this.persistPending()
        }
        const replica = this.replica
        const session = this.session
        if (replica === null || session === null) return
        let op: DocumentOperation
        try {
            op = decodeOperation(body)
        } catch {
            return
        }
        let result: ReturnType<Replica['receive']>
        try {
            result = replica.receive({
                type: 'operation',
                stamp,
                operation: op,
                ...(orderKey !== undefined ? { orderKey } : {}),
            })
        } catch {
            return
        }
        for (const out of result.operations) {
            try {
                session.applyRemote(out)
            } catch {
                /* */
            }
        }
    }

    private handleLocalOperation(op: DocumentOperation): void {
        this.forwardedLocal = op
        this.sendAlreadyApplied(op)
    }

    private publishAlreadyApplied(op: DocumentOperation): void {
        if (this.forwardedLocal === op) {
            this.forwardedLocal = null
            return
        }
        this.forwardedLocal = null
        this.sendAlreadyApplied(op)
    }

    private sendAlreadyApplied(op: DocumentOperation): void {
        const replica = this.replica
        if (replica === null) return
        for (const chunk of splitPixelPatchIfNeeded(op)) {
            let stamp: number
            let body: Uint8Array
            let orderKey: number | undefined
            try {
                const out = replica.publish(chunk, { alreadyApplied: true })
                if (out.message?.type !== 'operation') continue
                stamp = out.message.stamp
                orderKey = out.message.orderKey
                body = encodeOperation(chunk)
                this.outbox.add(stamp, body, orderKey)
                this.persistPending()
            } catch (error) {
                if (error instanceof GeometryLockedError) {
                    this.note(GEOMETRY_NOTICE)
                    this.close()
                    return
                }
                this.note(error instanceof Error ? error.message : 'could not share the change')
                return
            }
            this.queueOp({
                type: 'op',
                seq: 0,
                stamp,
                body,
                ...(orderKey !== undefined ? { orderKey } : {}),
            })
        }
    }

    private queueOp(frame: Extract<NetFrame, { type: 'op' }>): void {
        if (this.queuedStamps.has(frame.stamp)) return
        this.queuedStamps.add(frame.stamp)
        this.opQueue.push(frame)
        this.flushOps(OPS_BURST)
    }

    private flushOps(budget: number): void {
        if (this.connection.status() !== 'open') return
        if (Date.now() < this.sendPausedUntil) return
        while (budget > 0 && this.opQueue.length > 0) {
            const frame = this.opQueue.shift()!
            this.queuedStamps.delete(frame.stamp)
            this.connection.send(frame)
            budget -= 1
        }
    }

    private handleResync(seq: number, snapshot: Uint8Array): void {
        try {
            const doc = decodeSprite(JSON.parse(new TextDecoder().decode(snapshot)) as unknown)

            this.outbox.clear()
            this.persistPending()
            this.forwardedLocal = null
            this.connection.resetSeq(seq)
            this.seqStore.save(this.roomId, seq)
            this.onResync(doc, seq)
            this.notify()
        } catch {
            /* */
        }
    }

    private handleStatus(): void {
        const open = this.connection.status() === 'open'
        const was = this.wasOpen
        this.wasOpen = open
        if (open && !was && this.session !== null) this.resendPending()
    }

    private resendPending(): void {
        const pending = this.outbox.takeAll()
        for (const entry of pending) {
            this.outbox.add(entry.stamp, entry.body, entry.orderKey)
            this.queueOp({
                type: 'op',
                seq: 0,
                stamp: entry.stamp,
                body: entry.body,
                ...(entry.orderKey !== undefined ? { orderKey: entry.orderKey } : {}),
            })
        }
    }

    private persistPending(): void {
        this.pendingStore.save(this.roomId, this.outbox.pending)
    }

    private handleError(message: string, code?: number): void {
        if (code === ErrorCode.rateLimited) {
            this.sendPausedUntil = Date.now() + RATE_LIMIT_RETRY_MS
            this.note(RATE_LIMIT_NOTICE)
            this.schedulePendingRetry()
            return
        }
        this.currentError = message
        const pending = this.pending
        this.pending = null
        pending?.reject(new Error(message))
        this.note(message)
    }

    private schedulePendingRetry(): void {
        if (this.retryTimer !== null) return
        this.retryTimer = setTimeout((): void => {
            this.retryTimer = null
            if (this.session !== null && this.connection.status() === 'open') {
                this.resendPending()
            }
        }, RATE_LIMIT_RETRY_MS)
    }

    updateProfile(next: RoomProfile): void {
        this.profile.nickname = next.nickname
        this.profile.color = next.color
        this.lastPresenceKey = null
        this.tickPresence()
        this.notify()
    }

    private tickPresence(): void {
        if (this.toolStore === undefined || this.readout === undefined) return
        const session = this.session
        const site = this.site

        if (session === null || site === null) return

        const tool = this.toolStore.state.tool
        const target = session.target.state
        const hover = this.readout.state.hover

        const x = hover?.x ?? -1
        const y = hover?.y ?? -1

        const preview = this.strokeSource?.take() ?? null
        const key = `${String(x)}:${String(y)}:${tool}:${target.layer}:${target.frame}:${this.profile.nickname}:${String(this.profile.color)}:${preview === null ? 'off' : `on${String(preview.cells.length)}:${String(preview.full)}`}`
        const now = Date.now()
        if (key === this.lastPresenceKey && now - this.lastPresenceAt < PRESENCE_HEARTBEAT_MS)
            return
        this.lastPresenceKey = key
        this.lastPresenceAt = now

        this.connection.send({
            type: 'presence',
            site,
            x,
            y,
            tool: toolToWire(tool),
            layer: target.layer,
            frame: target.frame,
            nickname: this.profile.nickname,
            color: this.profile.color,
            ...(preview !== null
                ? { preview: { color: preview.color, cells: preview.cells, full: preview.full } }
                : {}),
        })
    }

    private note(message: string): void {
        this.notices.push(message)
        this.onNotice(message)
        this.notify()
    }

    private notify(): void {
        for (const listener of this.listeners) listener()
    }
}
