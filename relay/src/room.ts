import {
    WIRE_PROTOCOL,
    applyOperation,
    createSprite,
    decodeFrame,
    decodeOperation,
    decodeSprite,
    encodeFrame,
    encodeSprite,
    ErrorCode,
    OperationError,
    stampLamport,
    stampSite,
    type DocumentOperation,
    type Hello,
    type NetFrame,
    type Sprite,
} from '@starforge/core'
import { MAX_LOG, SNAPSHOT_EVERY } from './store.js'
import { SILENT_LOG, hexHead, type RelayLog } from './log.js'
import type { ConnLimits } from './limits.js'
import type { RoomMetrics } from './telemetry.js'
import { type Peer } from './ws/socket.js'

interface Member {
    peer: Peer
    nickname: string
    color: number
}

interface LogEntry {
    seq: number
    stamp: number
    body: Uint8Array
    orderKey?: number
}

interface PersistHooks {
    append(seq: number, stamp: number, body: Uint8Array, orderKey?: number): void
    snapshot(seq: number, bytes: Uint8Array, lamport: number): void
}

function isPresenceFrame(bytes: Uint8Array): boolean {
    try {
        return decodeFrame(bytes).type === 'presence'
    } catch {
        return false
    }
}

function rejectDetail(error: OperationError): string {
    return error.message.replace(/^operation rejected \[[a-z]+\]: /, '')
}

const SEEN_STAMPS_MAX = 2048

export class Room {
    private doc: Sprite
    private members = new Map<number, Member>()
    private seq = 0
    private maxLamport = 0
    private log: LogEntry[] = []
    private snapshotSeq = 0
    private persist: PersistHooks | undefined
    private readonly metrics: RoomMetrics | undefined
    private readonly roomLog: RelayLog
    private readonly label: string

    private readonly seenStamps = new Map<number, true>()
    touchedAt: number

    constructor(
        doc?: Sprite,
        persist?: PersistHooks,
        metrics?: RoomMetrics,
        opts?: {
            label?: string
            log?: RelayLog
        },
    ) {
        this.doc = doc ?? createSprite({ width: 64, height: 64, title: 'relay-room' })
        this.persist = persist
        this.metrics = metrics
        this.roomLog = opts?.log ?? SILENT_LOG
        this.label = opts?.label ?? '-'
        this.touchedAt = Date.now()
    }

    private count(name: string, n = 1): void {
        this.metrics?.count(name, n)
    }

    snapshotBytes(): Uint8Array {
        return new TextEncoder().encode(JSON.stringify(encodeSprite(this.doc)))
    }

    peers(): { site: number; nickname: string; color: number }[] {
        return [...this.members].map(([site, member]) => ({
            site,
            nickname: member.nickname,
            color: member.color,
        }))
    }

    touch(now: number): void {
        this.touchedAt = now
    }

    missedSince(since: number): NetFrame[] {
        if (since === this.seq) return []

        if (since > this.seq || this.seq - since > MAX_LOG) {
            this.count('resyncs_sent')
            return [{ type: 'resync', seq: this.seq, snapshot: this.snapshotBytes() }]
        }

        const tail = this.log.filter((entry) => entry.seq > since)
        if (tail.length < this.seq - since) {
            this.count('resyncs_sent')
            return [{ type: 'resync', seq: this.seq, snapshot: this.snapshotBytes() }]
        }

        return tail.map((entry) => this.replayable(entry))
    }

    restore(snapshotSeq: number, seq: number, lamport: number, log: LogEntry[]): void {
        this.snapshotSeq = snapshotSeq
        this.seq = seq
        this.maxLamport = lamport
        this.log = [...log]
        for (const entry of log) this.seenStamps.set(entry.stamp, true)
    }

    private replayable(entry: LogEntry): NetFrame {
        return {
            type: 'op',
            seq: entry.seq,
            stamp: entry.stamp,
            body: entry.body,
            ...(entry.orderKey !== undefined ? { orderKey: entry.orderKey } : {}),
        }
    }

    private allocSite(): number | null {
        for (let site = 1; site <= 0xff; site++) {
            if (!this.members.has(site)) return site
        }
        return null
    }

    join(
        peer: Peer,
        hello: Hello,
    ): { site: number } | { error: { code: number; message: string } } {
        if (hello.protocol !== WIRE_PROTOCOL) {
            this.roomLog.warn('hello_rejected', {
                room: this.label,
                reason: 'unsupported protocol',
                protocol: hello.protocol,
            })
            peer.close(1002)
            return { error: { code: ErrorCode.invalidOperation, message: 'unsupported protocol' } }
        }
        if (this.members.size >= 16) {
            this.count('room_full')
            this.roomLog.warn('room_full', { room: this.label, members: this.members.size })
            peer.send(
                encodeFrame({ type: 'error', code: ErrorCode.roomFull, message: 'room is full' }),
            )
            peer.close(1011)
            return { error: { code: ErrorCode.roomFull, message: 'room is full' } }
        }
        const site = this.allocSite()
        if (site === null) {
            this.count('room_full')
            this.roomLog.warn('room_full', { room: this.label, reason: 'no free site' })
            peer.send(
                encodeFrame({ type: 'error', code: ErrorCode.roomFull, message: 'room is full' }),
            )
            peer.close(1011)
            return { error: { code: ErrorCode.roomFull, message: 'room is full' } }
        }

        const nickname = hello.nickname.slice(0, 64)
        this.members.set(site, { peer, nickname, color: hello.color })
        peer.send(
            encodeFrame({
                type: 'welcome',
                site,
                seq: this.seq,
                lamport: this.maxLamport,
                peers: this.peers().filter((entry) => entry.site !== site),
                snapshot: this.snapshotBytes(),
            }),
        )

        const joined = encodeFrame({ type: 'peerJoin', site, nickname, color: hello.color })
        for (const [otherSite, other] of this.members) {
            if (otherSite !== site) other.peer.send(joined)
        }
        const missed = this.missedSince(hello.since)
        for (const frame of missed) {
            peer.send(encodeFrame(frame))
        }
        this.roomLog.info('join', {
            room: this.label,
            site,
            nickname,
            members: this.members.size,
            seq: this.seq,
            since: hello.since,
            catchUp:
                missed.length === 1 && missed[0]?.type === 'resync'
                    ? 'resync'
                    : `tail:${String(missed.length)}`,
        })

        this.count('joins')
        return { site }
    }

    onBytes(site: number, bytes: Uint8Array, limits?: ConnLimits): void {
        const member = this.members.get(site)
        if (!member) return
        if (limits !== undefined && !limits.admitBytes(bytes.length)) {
            this.count('rate_limited_bytes')
            this.roomLog.info(
                'rate_limited',
                { room: this.label, site, kind: 'bytes', bytes: bytes.length },
                'rate_limited',
            )
            if (!isPresenceFrame(bytes)) {
                member.peer.send(
                    encodeFrame({
                        type: 'error',
                        code: ErrorCode.rateLimited,
                        message: 'rate limited',
                    }),
                )
            }
            return
        }

        let frame
        try {
            frame = decodeFrame(bytes)
        } catch {
            this.count('frames_dropped')
            this.roomLog.warn('frame_dropped', {
                room: this.label,
                site,
                reason: 'unreadable frame',
                bytes: bytes.length,
                head: hexHead(bytes),
            })
            member.peer.send(
                encodeFrame({
                    type: 'error',
                    code: ErrorCode.invalidOperation,
                    message: 'unreadable frame',
                }),
            )
            return
        }

        if (frame.type === 'presence') {
            this.count('presence_frames')
            const out = encodeFrame({ ...frame, site, nickname: frame.nickname.slice(0, 64) })
            for (const [otherSite, other] of this.members) {
                if (otherSite !== site) other.peer.send(out)
            }
            return
        }
        if (frame.type !== 'op') {
            this.count('frames_dropped')
            this.roomLog.warn('frame_dropped', {
                room: this.label,
                site,
                reason: 'expected an operation',
                got: frame.type,
            })
            member.peer.send(
                encodeFrame({
                    type: 'error',
                    code: ErrorCode.invalidOperation,
                    message: 'expected an operation',
                }),
            )
            return
        }

        let op: DocumentOperation
        try {
            op = decodeOperation(frame.body)
        } catch {
            this.count('ops_rejected')
            this.roomLog.warn('op_rejected', {
                room: this.label,
                site,
                reason: 'unreadable operation',
                bytes: frame.body.length,
                head: hexHead(frame.body),
            })
            member.peer.send(
                encodeFrame({
                    type: 'error',
                    code: ErrorCode.invalidOperation,
                    message: 'unreadable operation',
                }),
            )
            return
        }
        if (limits !== undefined && !limits.admitOp()) {
            this.count('rate_limited_ops')
            this.roomLog.info(
                'rate_limited',
                { room: this.label, site, kind: 'ops' },
                'rate_limited',
            )
            member.peer.send(
                encodeFrame({
                    type: 'error',
                    code: ErrorCode.rateLimited,
                    message: 'rate limited',
                }),
            )
            return
        }
        if (
            stampSite(frame.stamp) < 1 ||
            stampSite(frame.stamp) > 0xff ||
            stampLamport(frame.stamp) < 1
        ) {
            this.count('ops_rejected')
            this.roomLog.warn('op_rejected', {
                room: this.label,
                site,
                kind: op.kind,
                reason: 'stamp is out of range',
                stamp: frame.stamp,
            })
            member.peer.send(
                encodeFrame({
                    type: 'error',
                    code: ErrorCode.invalidOperation,
                    message: 'invalid operation: stamp is out of range',
                }),
            )
            return
        }

        if (stampSite(frame.stamp) !== site) {
            this.count('ops_rejected')
            this.roomLog.warn('op_rejected', {
                room: this.label,
                site,
                kind: op.kind,
                reason: 'op is stamped for another painter',
                stampSite: stampSite(frame.stamp),
                stamp: frame.stamp,
            })
            member.peer.send(
                encodeFrame({
                    type: 'error',
                    code: ErrorCode.invalidOperation,
                    message: 'invalid operation: op is stamped for another painter',
                }),
            )
            return
        }
        if (frame.orderKey !== undefined && !Number.isFinite(frame.orderKey)) {
            this.count('ops_rejected')
            this.roomLog.warn('op_rejected', {
                room: this.label,
                site,
                kind: op.kind,
                reason: 'op group key is not a number',
                orderKey: String(frame.orderKey),
            })
            member.peer.send(
                encodeFrame({
                    type: 'error',
                    code: ErrorCode.invalidOperation,
                    message: 'invalid operation: op group key is not a number',
                }),
            )
            return
        }

        const candidate = decodeSprite(encodeSprite(this.doc))
        try {
            applyOperation(candidate, op)
        } catch (error) {
            if (error instanceof OperationError) {
                this.count('ops_rejected')
                this.roomLog.warn(
                    'op_rejected',
                    {
                        room: this.label,
                        site,
                        kind: op.kind,
                        reason: rejectDetail(error),
                        stamp: frame.stamp,
                    },
                    'op_rejected',
                )
                member.peer.send(
                    encodeFrame({
                        type: 'error',
                        code: ErrorCode.invalidOperation,
                        message: `invalid operation: ${op.kind}: ${rejectDetail(error)}`,
                    }),
                )
                return
            }
            throw error
        }

        if (this.seenStamps.has(frame.stamp)) {
            this.count('ops_duplicate')
            this.roomLog.debug('op_duplicate', { room: this.label, site, kind: op.kind })
            return
        }
        this.seenStamps.set(frame.stamp, true)
        if (this.seenStamps.size > SEEN_STAMPS_MAX) {
            const oldest = this.seenStamps.keys().next().value
            if (oldest !== undefined) this.seenStamps.delete(oldest)
        }

        const lamport = stampLamport(frame.stamp)
        if (lamport > this.maxLamport) this.maxLamport = lamport

        applyOperation(this.doc, op)
        this.count('ops_applied')
        this.roomLog.debug('op_applied', { room: this.label, site, kind: op.kind, seq: this.seq })
        this.seq += 1
        this.log.push({
            seq: this.seq,
            stamp: frame.stamp,
            body: frame.body,
            ...(frame.orderKey !== undefined ? { orderKey: frame.orderKey } : {}),
        })
        this.persist?.append(
            this.seq,
            frame.stamp,
            frame.body,
            frame.orderKey !== undefined && Number.isFinite(frame.orderKey)
                ? frame.orderKey
                : undefined,
        )
        this.touch(Date.now())
        if (this.seq - this.snapshotSeq >= SNAPSHOT_EVERY) {
            this.snapshotSeq = this.seq
            this.log = []
            this.persist?.snapshot(this.seq, this.snapshotBytes(), this.maxLamport)
        }

        const out = encodeFrame({
            type: 'op',
            seq: this.seq,
            stamp: frame.stamp,
            body: frame.body,
            ...(frame.orderKey !== undefined ? { orderKey: frame.orderKey } : {}),
        })
        for (const [, other] of this.members) {
            other.peer.send(out)
        }
    }

    leave(site: number): void {
        if (!this.members.has(site)) return

        this.members.delete(site)
        const out = encodeFrame({ type: 'peerLeave', site })
        for (const [, other] of this.members) other.peer.send(out)
    }
}
