import { describe, expect, it, vi } from 'vitest'
import { decodeFrame, encodeFrame, type NetFrame } from '@starforge/core'
import { RoomConnection, type SocketLike } from './connection'

function hello() {
    return { type: 'hello', protocol: 1, room: 'abc', nickname: 'ada', color: 1, since: 0 } as const
}

class FakeSocket implements SocketLike {
    onopen: (() => void) | null = null
    onmessage: ((data: ArrayBuffer) => void) | null = null
    onerror: (() => void) | null = null
    onclose: (() => void) | null = null
    readonly sent: Uint8Array[] = []
    closed = false

    send(data: Uint8Array): void {
        this.sent.push(data)
    }

    close(): void {
        this.closed = true
    }
}

describe('room connection', () => {
    it('says hello on open and redials with backoff after a drop', () => {
        vi.useFakeTimers()
        try {
            const sockets: FakeSocket[] = []
            const conn = new RoomConnection('ws://x/wire', hello, (url) => {
                expect(url).toBe('ws://x/wire')
                const socket = new FakeSocket()
                sockets.push(socket)
                return socket
            })
            const states: string[] = []
            conn.subscribe(() => states.push(conn.status()))
            conn.connect()
            expect(conn.status()).toBe('connecting')
            sockets[0]!.onopen!()
            expect(conn.status()).toBe('open')
            expect(decodeFrame(sockets[0]!.sent[0]!).type).toBe('hello')
            sockets[0]!.onclose!()
            expect(conn.status()).toBe('connecting')
            expect(sockets.length).toBe(1)
            vi.advanceTimersByTime(500)
            expect(sockets.length).toBe(2)
            sockets[1]!.onopen!()
            sockets[1]!.onclose!()
            vi.advanceTimersByTime(999)
            expect(sockets.length).toBe(2)
            vi.advanceTimersByTime(1)
            expect(sockets.length).toBe(3)
        } finally {
            vi.useRealTimers()
        }
    })

    it('closes for good on a server error', () => {
        const sockets: FakeSocket[] = []
        const conn = new RoomConnection('ws://x/wire', hello, () => {
            const socket = new FakeSocket()
            sockets.push(socket)
            return socket
        })
        const errors: string[] = []
        conn.onError = (message) => errors.push(message)
        conn.connect()
        sockets[0]!.onopen!()
        const bytes = encodeFrame({ type: 'error', code: 4, message: 'room is full' })
        sockets[0]!.onmessage!(bytes.buffer)
        expect(errors).toEqual(['room is full'])
        expect(conn.status()).toBe('closed')
    })

    it('resets backoff in close() so a fresh session redials at 500 ms', () => {
        vi.useFakeTimers()
        try {
            const sockets: FakeSocket[] = []
            const conn = new RoomConnection('ws://x/wire', hello, () => {
                const socket = new FakeSocket()
                sockets.push(socket)
                return socket
            })

            conn.connect()
            sockets[0]!.onopen!()
            sockets[0]!.onclose!()
            vi.advanceTimersByTime(500)
            expect(sockets.length).toBe(2)
            sockets[1]!.onclose!()

            conn.close()
            conn.connect()
            expect(sockets.length).toBe(3)
            sockets[2]!.onopen!()
            sockets[2]!.onclose!()
            vi.advanceTimersByTime(499)
            expect(sockets.length).toBe(3)
            vi.advanceTimersByTime(1)
            expect(sockets.length).toBe(4)
            conn.close()
        } finally {
            vi.useRealTimers()
        }
    })

    it('tracks lastSeq as the max OP seq seen and resets on demand', () => {
        const sockets: FakeSocket[] = []
        const conn = new RoomConnection('ws://x/wire', hello, () => {
            const socket = new FakeSocket()
            sockets.push(socket)
            return socket
        })
        expect(conn.lastSeq).toBe(0)
        conn.connect()
        sockets[0]!.onopen!()
        sockets[0]!.onmessage!(welcomeBytes(4).buffer as ArrayBuffer)
        expect(conn.lastSeq).toBe(4)
        sockets[0]!.onmessage!(opBytes(3).buffer as ArrayBuffer)
        expect(conn.lastSeq).toBe(4)
        sockets[0]!.onmessage!(opBytes(2).buffer as ArrayBuffer)
        expect(conn.lastSeq).toBe(4)
        conn.resetSeq(9)
        expect(conn.lastSeq).toBe(9)
        sockets[0]!.onmessage!(opBytes(4).buffer as ArrayBuffer)
        expect(conn.lastSeq).toBe(9)
        conn.close()
    })

    it('invokes the hello factory fresh on every attempt so since follows lastSeq', () => {
        vi.useFakeTimers()
        try {
            const sockets: FakeSocket[] = []
            const hellos: NetFrame[] = []
            const conn: RoomConnection = new RoomConnection(
                'ws://x/wire',
                () => ({ ...hello(), since: conn.lastSeq }),
                () => {
                    const socket = new FakeSocket()
                    sockets.push(socket)
                    return socket
                },
            )
            conn.connect()
            sockets[0]!.onopen!()
            sockets[0]!.onmessage!(welcomeBytes(0).buffer as ArrayBuffer)
            expect(hellosOf(sockets[0]!, hellos)).toBe(1)
            expect(hellos[0]).toMatchObject({ type: 'hello', since: 0 })

            sockets[0]!.onmessage!(opBytes(7).buffer as ArrayBuffer)
            sockets[0]!.onmessage!(opBytes(5).buffer as ArrayBuffer)
            expect(conn.lastSeq).toBe(7)
            sockets[0]!.onclose!()
            vi.advanceTimersByTime(500)
            expect(sockets.length).toBe(2)
            sockets[1]!.onopen!()
            expect(hellosOf(sockets[1]!, hellos)).toBe(1)
            expect(hellos).toHaveLength(2)
            expect(hellos[1]).toMatchObject({ type: 'hello', since: 7 })
            conn.close()
        } finally {
            vi.useRealTimers()
        }
    })
})

function welcomeBytes(seq: number): Uint8Array {
    return encodeFrame({
        type: 'welcome',
        site: 1,
        seq,
        lamport: 0,
        peers: [],
        snapshot: new TextEncoder().encode('{}'),
    })
}

function opBytes(seq: number): Uint8Array {
    return encodeFrame({ type: 'op', seq, stamp: (1 << 8) | 1, body: Uint8Array.of(9) })
}

function hellosOf(socket: FakeSocket, seen: NetFrame[]): number {
    let drained = 0
    for (const bytes of socket.sent) {
        seen.push(decodeFrame(bytes))
        drained += 1
    }
    socket.sent.length = 0
    return drained
}
