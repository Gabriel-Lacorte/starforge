import { afterEach, describe, expect, it } from 'vitest'
import net from 'node:net'
import type { Socket } from 'node:net'
import { WsSocket } from './socket'

const sockets: Socket[] = []
const servers: net.Server[] = []

afterEach(async () => {
    for (const s of sockets.splice(0)) {
        try {
            s.destroy()
        } catch {
            /* ignore */
        }
    }
    await Promise.all(
        servers.splice(0).map(
            (server) =>
                new Promise<void>((resolve) => {
                    server.close(() => resolve())
                }),
        ),
    )
})

function maskedFrame(opcode: number, payload: readonly number[]): Uint8Array {
    const key = [7, 8, 9, 10]
    const out = [0x80 | opcode, 0x80 | payload.length, ...key]
    payload.forEach((byte, i) => out.push(byte ^ key[i % 4]!))
    return Uint8Array.from(out)
}

function readN(socket: Socket, n: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        let acc = new Uint8Array(0)
        const onData = (chunk: Buffer) => {
            const next = new Uint8Array(acc.length + chunk.length)
            next.set(acc, 0)
            next.set(new Uint8Array(chunk), acc.length)
            acc = next
            if (acc.length >= n) {
                socket.off('data', onData)
                resolve(acc.slice(0, n))
            }
        }
        socket.on('data', onData)
        socket.on('error', reject)
    })
}

describe('ws socket', () => {
    it('answers pings and delivers binary messages', async () => {
        const server = net.createServer()
        servers.push(server)
        await new Promise<void>((resolve) => {
            server.listen(0, () => resolve())
        })

        const address = server.address()
        if (address === null || typeof address === 'string') throw new Error('no port')
        const port = address.port

        const connected = new Promise<WsSocket>((resolve) => {
            server.on('connection', (socket) => {
                sockets.push(socket)
                resolve(new WsSocket(socket, 1024))
            })
        })

        const client = net.connect(port, '127.0.0.1')
        sockets.push(client)
        await new Promise<void>((resolve) => {
            client.on('connect', () => resolve())
        })
        const peer = await connected

        client.write(maskedFrame(0x9, []))
        const pong = await readN(client, 2)
        expect([...pong]).toEqual([0x8a, 0x00])

        const received = new Promise<{ opcode: number; payload: Uint8Array }>((resolve) => {
            peer.onMessage = (opcode, payload) => resolve({ opcode, payload })
        })
        client.write(maskedFrame(0x2, [104, 105]))
        const message = await received
        expect(message.opcode).toBe(0x2)
        expect([...message.payload]).toEqual([104, 105])
    })

    it('closes 1011 instead of crashing when the handler throws', async () => {
        const server = net.createServer()
        servers.push(server)
        await new Promise<void>((resolve) => {
            server.listen(0, () => resolve())
        })
        const address = server.address()
        if (address === null || typeof address === 'string') throw new Error('no port')
        const port = address.port

        const connected = new Promise<WsSocket>((resolve) => {
            server.on('connection', (socket) => {
                sockets.push(socket)
                resolve(new WsSocket(socket, 1024))
            })
        })
        const client = net.connect(port, '127.0.0.1')
        sockets.push(client)
        await new Promise<void>((resolve) => {
            client.on('connect', () => resolve())
        })
        const peer = await connected

        peer.onMessage = () => {
            throw new Error('boom')
        }
        client.write(maskedFrame(0x2, [1]))
        const close = await readN(client, 4)
        expect([...close]).toEqual([0x88, 0x02, 0x03, 0xf3])
    })

    it('fires onPong when the client sends a pong', async () => {
        const server = net.createServer()
        servers.push(server)
        await new Promise<void>((resolve) => {
            server.listen(0, () => resolve())
        })
        const address = server.address()
        if (address === null || typeof address === 'string') throw new Error('no port')
        const port = address.port

        const connected = new Promise<WsSocket>((resolve) => {
            server.on('connection', (socket) => {
                sockets.push(socket)
                resolve(new WsSocket(socket, 1024))
            })
        })
        const client = net.connect(port, '127.0.0.1')
        sockets.push(client)
        await new Promise<void>((resolve) => {
            client.on('connect', () => resolve())
        })
        const peer = await connected

        expect(() => peer.onPong()).not.toThrow()
        const fired = new Promise<void>((resolve) => {
            peer.onPong = () => resolve()
        })
        client.write(maskedFrame(0xa, []))
        await fired
    })
})
