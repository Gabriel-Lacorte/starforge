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
import type { ConnLimits } from './limits.js'
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
}

interface PersistHooks {
    append(seq: number, stamp: number, body: Uint8Array): void
    snapshot(seq: number, bytes: Uint8Array): void
}

function isPresenceFrame(bytes: Uint8Array): boolean {
    try {
        return decodeFrame(bytes).type === 'presence'
    } catch {
        return false
    }
}

export class Room {
    private doc: Sprite
    private members = new Map<number, Member>()
    private seq = 0
    private maxLamport = 0
    private log: LogEntry[] = []
    private snapshotSeq = 0
    private persist: PersistHooks | undefined
    touchedAt: number

    constructor(doc?: Sprite, persist?: PersistHooks) {
        this.doc = doc ?? createSprite({ width: 64, height: 64, title: 'relay-room' })
        this.persist = persist
        this.touchedAt = Date.now()
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
        if (since >= this.seq) return []
        if (this.seq - since > MAX_LOG) {
            return [{ type: 'resync', seq: this.seq, snapshot: this.snapshotBytes() }]
        }
        const tail = this.log.filter((entry) => entry.seq > since)
        if (tail.length < this.seq - since) {
            return [{ type: 'resync', seq: this.seq, snapshot: this.snapshotBytes() }]
        }
        return tail.map((entry) => ({
            type: 'op' as const,
            seq: entry.seq,
            stamp: entry.stamp,
            body: entry.body,
        }))
    }

    restore(snapshotSeq: number, seq: number, lamport: number, log: LogEntry[]): void {
        this.snapshotSeq = snapshotSeq
        this.seq = seq
        this.maxLamport = lamport
        this.log = [...log]
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
            peer.close(1002)
            return { error: { code: ErrorCode.invalidOperation, message: 'unsupported protocol' } }
        }
        if (this.members.size >= 16) {
            peer.send(
                encodeFrame({ type: 'error', code: ErrorCode.roomFull, message: 'room is full' }),
            )
            peer.close(1011)
            return { error: { code: ErrorCode.roomFull, message: 'room is full' } }
        }
        const site = this.allocSite()
        if (site === null) {
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
        for (const frame of this.missedSince(hello.since)) {
            peer.send(encodeFrame(frame))
        }

        return { site }
    }

    onBytes(site: number, bytes: Uint8Array, limits?: ConnLimits): void {
        const member = this.members.get(site)
        if (!member) return
        if (limits !== undefined && !limits.admitBytes(bytes.length)) {
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
            const out = encodeFrame({ ...frame, site })
            for (const [otherSite, other] of this.members) {
                if (otherSite !== site) other.peer.send(out)
            }
            return
        }
        if (frame.type !== 'op') {
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
            member.peer.send(
                encodeFrame({
                    type: 'error',
                    code: ErrorCode.invalidOperation,
                    message: 'invalid operation',
                }),
            )
            return
        }

        if (stampSite(frame.stamp) !== site) {
            member.peer.send(
                encodeFrame({
                    type: 'error',
                    code: ErrorCode.invalidOperation,
                    message: 'invalid operation',
                }),
            )
            return
        }
        const candidate = decodeSprite(encodeSprite(this.doc))
        try {
            applyOperation(candidate, op)
        } catch (error) {
            if (error instanceof OperationError) {
                member.peer.send(
                    encodeFrame({
                        type: 'error',
                        code: ErrorCode.invalidOperation,
                        message: 'invalid operation',
                    }),
                )
                return
            }
            throw error
        }

        const lamport = stampLamport(frame.stamp)
        if (lamport > this.maxLamport) this.maxLamport = lamport

        applyOperation(this.doc, op)
        this.seq += 1
        this.log.push({ seq: this.seq, stamp: frame.stamp, body: frame.body })
        this.persist?.append(this.seq, frame.stamp, frame.body)
        this.touch(Date.now())
        if (this.seq - this.snapshotSeq >= SNAPSHOT_EVERY) {
            this.snapshotSeq = this.seq
            this.log = []
            this.persist?.snapshot(this.seq, this.snapshotBytes())
        }

        const out = encodeFrame({ type: 'op', seq: this.seq, stamp: frame.stamp, body: frame.body })
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
