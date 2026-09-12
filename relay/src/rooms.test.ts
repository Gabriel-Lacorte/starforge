import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage } from 'node:http'
import net from 'node:net'
import type { Socket } from 'node:net'
import { ErrorCode, WIRE_PROTOCOL, decodeFrame, encodeFrame } from '@starforge/core'
import { RoomStore } from './store.js'
import { RoomRegistry, clientIp } from './rooms.js'

function registry() {
    const store = new RoomStore(':memory:')
    return { store, rooms: new RoomRegistry(store, { now: () => 1000 }) }
}

describe('room registry', () => {
    it('creates rooms with URL-safe ids and opens them by id', () => {
        const { rooms } = registry()
        const created = rooms.create('1.2.3.4', { title: 'Orbit', width: 64, height: 64 })
        if (!('id' in created)) throw new Error('create failed')
        expect(created.id).toMatch(/^[A-Za-z0-9_-]{12}$/)
        expect(rooms.get(created.id)).toBeDefined()
        expect(rooms.roomInfo(created.id)).toMatchObject({ title: 'Orbit', members: 0, seq: 0 })
    })

    it('rejects oversized canvases and the 21st room per hour per IP', () => {
        const { rooms } = registry()
        const big = rooms.create('9.9.9.9', { title: 'x', width: 512, height: 512 })
        if (!('error' in big)) throw new Error('expected rejection')
        expect(big.error.code).toBe(ErrorCode.documentTooLarge)
        for (let i = 0; i < 20; i++) {
            const r = rooms.create('1.2.3.4', { title: `r${String(i)}`, width: 16, height: 16 })
            if (!('id' in r)) throw new Error(`create ${String(i)} failed`)
        }
        const over = rooms.create('1.2.3.4', { title: 'over', width: 16, height: 16 })
        if (!('error' in over)) throw new Error('expected throttle')
        expect(over.error.code).toBe(ErrorCode.tooManyRooms)
    })

    it('a throttled 21st create returns 429 without destroying the oldest room', () => {
        const store = new RoomStore(':memory:')
        try {
            const rooms = new RoomRegistry(store, { now: () => 1000 })
            let oldest = ''
            for (let ip = 0; ip < 5; ip++) {
                for (let i = 0; i < 20; i++) {
                    const created = rooms.create(`10.9.${String(ip)}.1`, {
                        title: `r${String(ip)}-${String(i)}`,
                        width: 16,
                        height: 16,
                    })
                    if (!('id' in created)) throw new Error('setup create failed')
                    if (ip === 0 && i === 0) oldest = created.id
                }
            }
            const over = rooms.create('10.9.0.1', { title: 'over', width: 16, height: 16 })
            if (!('error' in over)) throw new Error('expected throttle')
            expect(over.error.status).toBe(429)
            expect(over.error.code).toBe(ErrorCode.tooManyRooms)
            expect(rooms.roomInfo(oldest)).not.toBeNull()
            expect(rooms.get(oldest)).toBeDefined()
        } finally {
            store.close()
        }
    })

    it('rehydrates documents and op tails across restarts', () => {
        const store = new RoomStore(':memory:')
        const first = new RoomRegistry(store, { now: () => 1000 })
        const created = first.create('1.2.3.4', { title: 'keep', width: 16, height: 16 })
        if (!('id' in created)) throw new Error('create failed')
        const second = new RoomRegistry(store, { now: () => 2000 })
        const rehydrated = second.rehydrate()
        expect(rehydrated).toEqual({ rooms: 1, dropped: 0 })
        expect(second.roomInfo(created.id)).toMatchObject({ title: 'keep', members: 0 })
    })

    it('drops a room whose op log is corrupt on rehydrate', () => {
        const store = new RoomStore(':memory:')
        try {
            const first = new RoomRegistry(store, { now: () => 1000 })
            const created = first.create('1.2.3.4', {
                title: 'poison',
                width: 16,
                height: 16,
            })
            if (!('id' in created)) throw new Error('create failed')
            store.appendOp(created.id, { seq: 1, stamp: 1, body: new Uint8Array([0, 1, 2, 3]) })
            const second = new RoomRegistry(store, { now: () => 2000 })
            expect(second.rehydrate()).toEqual({ rooms: 0, dropped: 1 })
            expect(second.roomInfo(created.id)).toBeNull()
        } finally {
            store.close()
        }
    })
})

describe('clientIp', () => {
    function req(headers: Record<string, string>): IncomingMessage {
        return { headers } as unknown as IncomingMessage
    }

    function sock(addr: string): Socket {
        return { remoteAddress: addr } as unknown as Socket
    }

    it('ignores spoofed proxy headers from a direct public peer', () => {
        expect(
            clientIp(
                req({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }),
                sock('203.0.113.7'),
            ),
        ).toBe('203.0.113.7')
    })

    it('honors cf-connecting-ip behind a loopback edge', () => {
        expect(clientIp(req({ 'cf-connecting-ip': '1.1.1.1' }), sock('127.0.0.1'))).toBe('1.1.1.1')
    })
})

function maskedFrame(opcode: number, payload: Uint8Array): Uint8Array {
    const key = [7, 8, 9, 10]
    const out = [0x80 | opcode, 0x80 | payload.length, ...key]
    payload.forEach((byte, i) => out.push(byte ^ key[i % 4]!))
    return Uint8Array.from(out)
}

interface ServerFrame {
    readonly opcode: number
    readonly payload: Uint8Array
}

/** Reads N unmasked server frames (16-bit lengths supported) off a raw socket. */
function readServerFrames(socket: Socket, n: number): Promise<ServerFrame[]> {
    return new Promise((resolve, reject) => {
        let acc = new Uint8Array(0)
        const frames: ServerFrame[] = []
        const onData = (chunk: Buffer) => {
            const next = new Uint8Array(acc.length + chunk.length)
            next.set(acc, 0)
            next.set(new Uint8Array(chunk), acc.length)
            acc = next
            while (frames.length < n && acc.length >= 2) {
                const marker = acc[1]! & 0x7f
                let header = 2
                let len = marker
                if (marker === 126) {
                    if (acc.length < 4) return
                    len = ((acc[2]! << 8) | acc[3]!) >>> 0
                    header = 4
                } else if (marker === 127) {
                    socket.off('data', onData)
                    reject(new Error('64-bit server frame lengths unsupported in test'))
                    return
                }
                if (acc.length < header + len) return
                frames.push({ opcode: acc[0]! & 0x0f, payload: acc.slice(header, header + len) })
                acc = acc.slice(header + len)
            }
            if (frames.length >= n) {
                socket.off('data', onData)
                resolve(frames)
            }
        }
        socket.on('data', onData)
        socket.on('error', reject)
    })
}

describe('unknown-room join', () => {
    it('answers ERROR roomNotFound and closes 1008 over real loopback', async () => {
        const store = new RoomStore(':memory:')
        const rooms = new RoomRegistry(store, { now: () => 1000 })
        const server = net.createServer((socket) => {
            rooms.attach(socket, '127.0.0.1', {
                port: 0,
                origins: [],
                dataDir: '',
                maxMessageBytes: 1024 * 1024,
                maxMembers: 16,
            })
        })
        await new Promise<void>((resolve) => {
            server.listen(0, () => resolve())
        })
        const address = server.address()
        if (address === null || typeof address === 'string') throw new Error('no port')
        const client = net.connect(address.port, '127.0.0.1')
        try {
            await new Promise<void>((resolve) => {
                client.on('connect', () => resolve())
            })
            const hello = encodeFrame({
                type: 'hello',
                protocol: WIRE_PROTOCOL,
                room: 'AAAAAAAAAAAA',
                nickname: 'ada',
                color: 1,
                since: 0,
            })
            client.write(maskedFrame(0x2, hello))
            const frames = await readServerFrames(client, 2)
            const err = decodeFrame(frames[0]!.payload)
            if (err.type !== 'error') throw new Error('expected error frame')
            expect(err.code).toBe(ErrorCode.roomNotFound)
            expect(frames[1]!.opcode).toBe(0x8)
            expect((frames[1]!.payload[0]! << 8) | frames[1]!.payload[1]!).toBe(1008)
        } finally {
            client.destroy()
            await new Promise<void>((resolve) => {
                server.close(() => resolve())
            })
            store.close()
        }
    })
})

describe('heartbeat', () => {
    it('pings idle sockets at 30 s and drops them with 1001 after 90 s of silence', async () => {
        vi.useFakeTimers()
        try {
            const store = new RoomStore(':memory:')
            try {
                const rooms = new RoomRegistry(store)
                const created = rooms.create('127.0.0.1', {
                    title: 'hb',
                    width: 16,
                    height: 16,
                })
                if (!('id' in created)) throw new Error('create failed')
                const server = net.createServer((socket) => {
                    rooms.attach(socket, '127.0.0.1', {
                        port: 0,
                        origins: [],
                        dataDir: '',
                        maxMessageBytes: 1024 * 1024,
                        maxMembers: 16,
                    })
                })
                await new Promise<void>((resolve) => {
                    server.listen(0, () => resolve())
                })
                const address = server.address()
                if (address === null || typeof address === 'string') throw new Error('no port')
                const client = net.connect(address.port, '127.0.0.1')
                try {
                    await new Promise<void>((resolve) => {
                        client.on('connect', () => resolve())
                    })
                    client.write(
                        maskedFrame(
                            0x2,
                            encodeFrame({
                                type: 'hello',
                                protocol: WIRE_PROTOCOL,
                                room: created.id,
                                nickname: 'ada',
                                color: 1,
                                since: 0,
                            }),
                        ),
                    )
                    const [welcome] = await readServerFrames(client, 1)
                    expect(welcome!.opcode).toBe(0x2)
                    const decoded = decodeFrame(welcome!.payload)
                    if (decoded.type !== 'welcome') throw new Error('expected welcome')

                    const pingPromise = readServerFrames(client, 1)
                    await vi.advanceTimersByTimeAsync(30000)
                    const [ping] = await pingPromise
                    expect(ping!.opcode).toBe(0x9)
                    expect(ping!.payload.length).toBe(0)

                    const restPromise = readServerFrames(client, 2)
                    await vi.advanceTimersByTimeAsync(61000)
                    const rest = await restPromise
                    expect(rest[0]!.opcode).toBe(0x9)
                    expect(rest[1]!.opcode).toBe(0x8)
                    expect((rest[1]!.payload[0]! << 8) | rest[1]!.payload[1]!).toBe(1001)
                } finally {
                    client.destroy()
                }
                await new Promise<void>((resolve) => {
                    server.close(() => resolve())
                })
            } finally {
                store.close()
            }
        } finally {
            vi.useRealTimers()
        }
    })
})
