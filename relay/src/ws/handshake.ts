import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

export const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export class HttpError extends Error {
    readonly status: number

    constructor(status: number, message: string) {
        super(message)
        this.name = 'HttpError'
        this.status = status
    }
}

export function acceptKey(key: string): string {
    return createHash('sha1')
        .update(key + WS_GUID)
        .digest('base64')
}

export function parseHandshake(req: IncomingMessage): { key: string } {
    if ((req.headers['sec-websocket-version'] ?? '13') !== '13') {
        throw new HttpError(426, 'expected Sec-WebSocket-Version: 13')
    }

    const key = req.headers['sec-websocket-key']
    if (typeof key !== 'string' || key.length === 0) throw new HttpError(400, 'missing key')
    if ((req.headers.upgrade ?? '').toLowerCase() !== 'websocket') {
        throw new HttpError(400, 'expected websocket upgrade')
    }

    return { key }
}

export function handshakeResponse(accept: string): string {
    return (
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    )
}

export function originAllowed(origin: string | undefined, extra: readonly string[]): boolean {
    if (origin === undefined) return true
    if (extra.includes(origin)) return true

    return (
        origin === 'http://localhost:5173' ||
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:')
    )
}
