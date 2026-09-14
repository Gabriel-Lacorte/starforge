import { createReadStream, promises as fs, existsSync, statSync } from 'node:fs'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import http from 'node:http'
import type { Socket } from 'node:net'
import { join, normalize, extname } from 'node:path'
import { ErrorCode } from '@starforge/core'
import {
    HttpError,
    acceptKey,
    handshakeResponse,
    originAllowed,
    parseHandshake,
} from './ws/handshake.js'
import { clientIp, type RoomRegistry } from './rooms.js'

export interface HttpDeps {
    readonly distDir: string | null
    readonly origins: readonly string[]
    readonly rooms: RoomRegistry
    readonly onSocket: (socket: Socket, ip: string) => void
}

const TEXT_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
}

const ROBOTS_TXT = 'User-agent: *\nAllow: /\nSitemap: https://starforge.lacorte.city/sitemap.xml\n'

const SITEMAP_XML =
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://starforge.lacorte.city/</loc></url><url><loc>https://starforge.lacorte.city/about</loc></url></urlset>'

export function createServer(deps: HttpDeps): Server {
    const server = http.createServer((req, res) => {
        void handleRequest(req, res, deps).catch(() => {
            if (!res.headersSent) {
                res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
                res.end('internal error')
            }
        })
    })
    server.on('upgrade', (req, socket) => {
        handleUpgrade(req, socket as Socket, deps)
    })
    return server
}

async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    deps: HttpDeps,
): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (req.method === 'GET' && url.pathname === '/healthz') {
        res.writeHead(200, {
            'content-type': 'application/json',
            'x-content-type-options': 'nosniff',
        })
        res.end('{"ok":true}')
        return
    }

    if (req.method === 'GET' && url.pathname === '/robots.txt') {
        res.writeHead(200, {
            'content-type': 'text/plain; charset=utf-8',
            'x-content-type-options': 'nosniff',
        })
        res.end(ROBOTS_TXT)
        return
    }

    if (req.method === 'GET' && url.pathname === '/sitemap.xml') {
        res.writeHead(200, {
            'content-type': 'application/xml; charset=utf-8',
            'x-content-type-options': 'nosniff',
        })
        res.end(SITEMAP_XML)
        return
    }

    if (req.method === 'POST' && url.pathname === '/api/rooms') {
        await handleCreateRoom(req, res, deps)
        return
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/rooms/')) {
        handleGetRoom(url, res, deps)
        return
    }

    if (req.method !== 'GET') {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('not found')
        return
    }
    if (deps.distDir === null) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('dev runs vite separately')
        return
    }

    const rel = url.pathname === '/' ? '/index.html' : url.pathname
    const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '')
    const file = join(deps.distDir, safe.slice(1))
    if (!file.startsWith(deps.distDir)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('not found')
        return
    }

    try {
        const st = statSync(file)
        if (!st.isFile()) throw new Error('not a file')

        const type = TEXT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
        res.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff' })
        pipeFile(file, res)
    } catch {
        try {
            await fs.access(join(deps.distDir, 'index.html'))
            if (rel !== '/index.html' && !extname(rel)) {
                res.writeHead(200, {
                    'content-type': 'text/html; charset=utf-8',
                    'x-content-type-options': 'nosniff',
                })
                pipeFile(join(deps.distDir, 'index.html'), res)
                return
            }
        } catch {
            /* 404 */
        }

        if (!existsSync(file)) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('not found')
            return
        }
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('not found')
    }
}

function pipeFile(file: string, res: ServerResponse): void {
    const stream = createReadStream(file)
    stream.on('error', () => {
        res.destroy()
    })
    stream.pipe(res)
}

const MAX_ROOM_BODY = 8 * 1024 * 1024

function json(res: ServerResponse, status: number, value: unknown): void {
    res.writeHead(status, {
        'content-type': 'application/json',
        'x-content-type-options': 'nosniff',
    })
    res.end(JSON.stringify(value))
}

function errorName(code: number): string {
    switch (code) {
        case ErrorCode.documentTooLarge:
            return 'document_too_large'
        case ErrorCode.tooManyRooms:
            return 'too_many_rooms'
        case ErrorCode.invalidOperation:
            return 'invalid_operation'
        default:
            return 'invalid_operation'
    }
}

function readJsonBody(
    req: IncomingMessage,
): Promise<{ ok: true; text: string } | { ok: false; destroyed: boolean }> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        let size = 0
        let over = false

        req.on('data', (chunk: Buffer) => {
            if (over) return
            size += chunk.length
            if (size > MAX_ROOM_BODY) {
                over = true
                chunks.length = 0
                req.destroy()
                resolve({ ok: false, destroyed: true })
                return
            }
            chunks.push(chunk)
        })

        req.on('end', () => {
            if (over) resolve({ ok: false, destroyed: false })
            else resolve({ ok: true, text: Buffer.concat(chunks).toString('utf8') })
        })

        req.on('error', reject)
    })
}

async function handleCreateRoom(
    req: IncomingMessage,
    res: ServerResponse,
    deps: HttpDeps,
): Promise<void> {
    const body = await readJsonBody(req)
    if (!body.ok) {
        if (!body.destroyed && !res.headersSent) json(res, 413, { error: 'snapshot_too_large' })
        return
    }

    let parsed: unknown
    try {
        parsed = JSON.parse(body.text) as unknown
    } catch {
        json(res, 400, { error: 'invalid_operation' })
        return
    }
    const record = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
        string,
        unknown
    >

    const title = typeof record.title === 'string' ? record.title : ''
    const snapshot =
        typeof record.snapshot === 'string'
            ? record.snapshot
            : record.snapshot === undefined
              ? undefined
              : JSON.stringify(record.snapshot)

    const result = deps.rooms.create(clientIp(req, req.socket), {
        title,
        width: record.width as number,
        height: record.height as number,
        ...(snapshot === undefined ? {} : { snapshot }),
    })
    if ('id' in result) {
        json(res, 201, { id: result.id })
        return
    }
    json(res, result.error.status, { error: errorName(result.error.code) })
}

function handleGetRoom(url: URL, res: ServerResponse, deps: HttpDeps): void {
    const id = url.pathname.slice('/api/rooms/'.length)
    const info = id.length > 0 && !id.includes('/') ? deps.rooms.roomInfo(id) : null
    if (info === null) {
        json(res, 404, { error: 'room_not_found' })
        return
    }
    json(res, 200, info)
}

function handleUpgrade(req: IncomingMessage, socket: Socket, deps: HttpDeps): void {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/wire') {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
    }

    let key: string
    try {
        key = parseHandshake(req).key
    } catch (error) {
        const status = error instanceof HttpError ? error.status : 400
        const message = error instanceof Error ? error.message : 'bad request'
        socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`)
        socket.destroy()
        return
    }

    const originHeader: unknown = req.headers.origin
    const origin =
        typeof originHeader === 'string'
            ? originHeader
            : Array.isArray(originHeader) && typeof originHeader[0] === 'string'
              ? originHeader[0]
              : undefined
    if (!originAllowed(origin, deps.origins)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
    }

    socket.write(handshakeResponse(acceptKey(key)))
    deps.onSocket(socket, clientIp(req, socket))
}
