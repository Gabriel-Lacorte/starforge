import {
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
    const response = await fetchImpl(`${apiBase}/api/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(init),
    })
    if (response.ok) {
        const data = (await response.json()) as { id: string }
        return { id: data.id }
    }
    if (response.status === 429) throw new Error('too many rooms created, try again later')
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

export interface RoomConnectionLike {
    onFrame: (frame: NetFrame) => void
    onError: (message: string) => void

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

    readonly since?: number
    readonly seqStore?: SeqStore
    readonly pendingStore?: PendingStore
}

const PRESENCE_MS = 50
const GEOMETRY_NOTICE = 'canvas size is locked while the room is open'

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
    private readonly seqStore: SeqStore
    private readonly roomId: string
    private replica: Replica | null = null
    private site: number | null = null
    private currentError: string | null = null
    private readonly listeners = new Set<() => void>()
    private pending: PendingConnect | null = null
    private timer: ReturnType<typeof setInterval> | null = null
    private lastPresenceKey: string | null = null
    private operationUnsub: (() => void) | null = null

    private readonly outbox = new Outbox()

    private forwardedLocal: DocumentOperation | null = null
    private wasOpen = false
    private readonly pendingStore: PendingStore

    constructor(opts: RoomControllerOptions) {
        this.profile = opts.profile
        this.toolStore = opts.store
        this.readout = opts.readout
        this.roomId = opts.room
        if (opts.connection !== undefined) {
            this.connection = opts.connection
        } else {
            let live: RoomConnection | null = null
            live = new RoomConnection(opts.url, () => ({
                type: 'hello',
                protocol: WIRE_PROTOCOL,
                room: opts.room,
                nickname: opts.profile.nickname,
                color: opts.profile.color,
                since: live?.lastSeq ?? 0,
            }))
            this.connection = live
        }
        this.seqStore = opts.seqStore ?? localStorageSeqStore()
        const seeded = opts.since ?? this.seqStore.load(opts.room)
        if (seeded > 0) this.connection.resetSeq(seeded)
        this.pendingStore = opts.pendingStore ?? localStoragePendingStore()
        for (const entry of this.pendingStore.load(opts.room)) {
            this.outbox.add(entry.stamp, entry.body)
        }
        this.connection.onFrame = (frame): void => {
            this.handleFrame(frame)
        }
        this.connection.onError = (message): void => {
            this.handleError(message)
        }
        this.connection.subscribe((): void => {
            this.handleStatus()
            this.notify()
        })
        if (this.toolStore !== undefined && this.readout !== undefined) {
            this.timer = setInterval((): void => {
                this.tickPresence()
            }, PRESENCE_MS)
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
                this.handleOp(frame.seq, frame.stamp, frame.body)
                break
            case 'presence':
                this.peers.applyPresence(
                    frame.site,
                    frame.x,
                    frame.y,
                    toolFromWire(frame.tool),
                    frame.layer,
                    frame.frame,
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
        if (this.session !== null) return
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
        this.resendPending()
        const pending = this.pending
        this.pending = null
        pending?.resolve(session)
        this.notify()
    }

    private handleOp(seq: number, stamp: number, body: Uint8Array): void {
        this.seqStore.save(this.roomId, seq)
        if (this.outbox.ack(stamp)) this.persistPending()
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
            result = replica.receive({ type: 'operation', stamp, operation: op })
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
            try {
                const out = replica.publish(chunk, { alreadyApplied: true })
                if (out.message?.type !== 'operation') continue
                stamp = out.message.stamp
                body = encodeOperation(chunk)
                this.outbox.add(stamp, body)
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
            this.connection.send({ type: 'op', seq: 0, stamp, body })
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
            this.outbox.add(entry.stamp, entry.body)
            this.connection.send({ type: 'op', seq: 0, stamp: entry.stamp, body: entry.body })
        }
    }

    private persistPending(): void {
        this.pendingStore.save(this.roomId, this.outbox.pending)
    }

    private handleError(message: string): void {
        this.currentError = message
        const pending = this.pending
        this.pending = null
        pending?.reject(new Error(message))
        this.note(message)
    }

    private tickPresence(): void {
        if (this.toolStore === undefined || this.readout === undefined) return
        const session = this.session
        const site = this.site

        if (session === null || site === null) return
        const hover = this.readout.state.hover
        if (hover === null) return

        const tool = this.toolStore.state.tool
        const target = session.target.state
        const key = `${String(hover.x)}:${String(hover.y)}:${tool}:${target.layer}:${target.frame}`
        if (key === this.lastPresenceKey) return
        this.lastPresenceKey = key

        this.connection.send({
            type: 'presence',
            site,
            x: hover.x,
            y: hover.y,
            tool: toolToWire(tool),
            layer: target.layer,
            frame: target.frame,
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
