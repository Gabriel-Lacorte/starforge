import type { Socket } from 'node:net'
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
    type DocumentOperation,
    type Hello,
    type Sprite,
} from '@starforge/core'
import type { RelayConfig } from './config.js'
import { WsSocket, type Peer } from './ws/socket.js'

interface Member {
    peer: Peer
    nickname: string
    color: number
}

export class Room {
    private doc: Sprite
    private members = new Map<number, Member>()
    private seq = 0
    private maxLamport = 0

    constructor(doc?: Sprite) {
        this.doc = doc ?? createSprite({ width: 64, height: 64, title: 'relay-room' })
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
        const snapshot = new TextEncoder().encode(JSON.stringify(encodeSprite(this.doc)))
        peer.send(
            encodeFrame({
                type: 'welcome',
                site,
                seq: this.seq,
                lamport: this.maxLamport,
                snapshot,
            }),
        )
        return { site }
    }

    onBytes(site: number, bytes: Uint8Array): void {
        const member = this.members.get(site)
        if (!member) return
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
        if (lamport > 0xffffff) {
            member.peer.send(
                encodeFrame({
                    type: 'error',
                    code: ErrorCode.lamportExhausted,
                    message: 'lamport exhausted',
                }),
            )
            for (const [, other] of this.members) other.peer.close(1011)
            return
        }
        if (lamport > this.maxLamport) this.maxLamport = lamport
        applyOperation(this.doc, op)
        this.seq += 1
        const out = encodeFrame({ type: 'op', seq: this.seq, stamp: frame.stamp, body: frame.body })
        for (const [otherSite, other] of this.members) {
            if (otherSite !== site) other.peer.send(out)
        }
    }

    leave(site: number): void {
        this.members.delete(site)
    }

    attach(raw: Socket, config: RelayConfig): void {
        const peer = new WsSocket(raw, config.maxMessageBytes)
        let site: number | null = null
        let helloSeen = false

        const timer = setTimeout(() => {
            if (!helloSeen) peer.close(1008)
        }, 5000)
        timer.unref()

        peer.onMessage = (opcode, payload) => {
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
                const result = this.join(peer, frame)
                helloSeen = true
                clearTimeout(timer)
                if ('site' in result) {
                    site = result.site
                }
                return
            }

            if (site !== null) this.onBytes(site, payload)
        }

        peer.onClose = () => {
            clearTimeout(timer)
            if (site !== null) this.leave(site)
        }
    }
}
