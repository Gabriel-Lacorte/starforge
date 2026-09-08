import { createReadStream, promises as fs, existsSync, statSync } from 'node:fs'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import http from 'node:http'
import type { Socket } from 'node:net'
import { join, normalize, extname } from 'node:path'
import {
    HttpError,
    acceptKey,
    handshakeResponse,
    originAllowed,
    parseHandshake,
} from './ws/handshake.js'

export interface HttpDeps {
    readonly distDir: string | null
    readonly origins: readonly string[]
    readonly onSocket: (socket: Socket) => void
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
    deps.onSocket(socket)
}
