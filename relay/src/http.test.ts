import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import type { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { createServer } from './http'
import { RoomRegistry } from './rooms.js'
import { RoomStore } from './store.js'

const sockets: Socket[] = []
const servers: http.Server[] = []

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

function readUntil(socket: Socket, marker: string): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = ''
        const onData = (chunk: Buffer) => {
            data += chunk.toString('utf8')
            if (data.includes(marker)) {
                socket.off('data', onData)
                resolve(data)
            }
        }
        socket.on('data', onData)
        socket.on('error', reject)
    })
}

describe('relay http', () => {
    it('upgrades /wire with the RFC accept and serves /healthz', async () => {
        const captured: Socket[] = []
        const server = createServer({
            distDir: null,
            origins: [],
            rooms: new RoomRegistry(new RoomStore(':memory:')),
            onSocket: (socket) => {
                captured.push(socket)
                sockets.push(socket)
            },
        })
        servers.push(server)
        await new Promise<void>((resolve) => {
            server.listen(0, () => resolve())
        })
        const address = server.address()
        if (address === null || typeof address === 'string') throw new Error('no port')
        const port = address.port

        const raw = net.connect(port, '127.0.0.1')
        sockets.push(raw)
        await new Promise<void>((resolve) => {
            raw.on('connect', () => resolve())
        })
        const key = 'dGhlIHNhbXBsZSBub25jZQ=='
        raw.write(
            'GET /wire HTTP/1.1\r\n' +
                'Host: localhost\r\n' +
                'Upgrade: websocket\r\n' +
                'Connection: Upgrade\r\n' +
                `Sec-WebSocket-Key: ${key}\r\n` +
                'Sec-WebSocket-Version: 13\r\n\r\n',
        )
        const head = await readUntil(raw, '\r\n\r\n')
        expect(head.startsWith('HTTP/1.1 101')).toBe(true)
        expect(head).toContain('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=')
        expect(captured.length).toBe(1)

        const health = await new Promise<string>((resolve, reject) => {
            http.get(`http://127.0.0.1:${String(port)}/healthz`, (res) => {
                let body = ''
                res.on('data', (chunk: Buffer) => {
                    body += chunk.toString('utf8')
                })
                res.on('end', () => resolve(body))
            }).on('error', reject)
        })
        expect(health).toBe('{"ok":true}')
    })

    it('serves static files with nosniff and keeps traversal inside dist', async () => {
        const distDir = mkdtempSync(`${tmpdir()}${sep}relay-dist-`)
        writeFileSync(join(distDir, 'index.html'), '<h1>starforge</h1>')
        writeFileSync(join(distDir, 'app.js'), 'console.log(1)')
        const secret = join(tmpdir(), `relay-secret-${String(process.pid)}.js`)
        writeFileSync(secret, 'top secret')

        const server = createServer({
            distDir,
            origins: [],
            rooms: new RoomRegistry(new RoomStore(':memory:')),
            onSocket: () => undefined,
        })
        servers.push(server)
        await new Promise<void>((resolve) => {
            server.listen(0, () => resolve())
        })
        const address = server.address()
        if (address === null || typeof address === 'string') throw new Error('no port')
        const base = `http://127.0.0.1:${String(address.port)}`

        const get = (
            path: string,
        ): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> =>
            new Promise((resolve, reject) => {
                http.get(base + path, (res) => {
                    let body = ''
                    res.on('data', (chunk: Buffer) => {
                        body += chunk.toString('utf8')
                    })
                    res.on('end', () =>
                        resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
                    )
                }).on('error', reject)
            })

        const app = await get('/app.js')
        expect(app.status).toBe(200)
        expect(app.body).toBe('console.log(1)')
        expect(app.headers['content-type']).toContain('javascript')
        expect(app.headers['x-content-type-options']).toBe('nosniff')

        const traversal = await get(`/../${secret.split(sep).pop()!}`)
        expect(traversal.body).not.toContain('top secret')

        const spa = await get('/r/abc123')
        expect(spa.status).toBe(200)
        expect(spa.body).toBe('<h1>starforge</h1>')

        const missing = await get('/missing.js')
        expect(missing.status).toBe(404)
    })

    it('serves robots.txt and sitemap.xml without a dist dir', async () => {
        const server = createServer({
            distDir: null,
            origins: [],
            rooms: new RoomRegistry(new RoomStore(':memory:')),
            onSocket: (): void => undefined,
        })
        servers.push(server)
        await new Promise<void>((resolve) => {
            server.listen(0, () => resolve())
        })
        const address = server.address()
        if (address === null || typeof address === 'string') throw new Error('no port')
        const base = `http://127.0.0.1:${String(address.port)}`
        const robots = await fetch(`${base}/robots.txt`)
        expect(robots.status).toBe(200)
        expect(robots.headers.get('content-type')).toContain('text/plain')
        const robotsBody = await robots.text()
        expect(robotsBody).toContain('Sitemap: https://starforge.lacorte.city/sitemap.xml')
        const sitemap = await fetch(`${base}/sitemap.xml`)
        expect(sitemap.status).toBe(200)
        expect(sitemap.headers.get('content-type')).toContain('application/xml')
        const sitemapBody = await sitemap.text()
        expect(sitemapBody).toContain('https://starforge.lacorte.city/about')
    })
})

interface RoomPayload {
    readonly id?: unknown
    readonly error?: unknown
    readonly members?: unknown
    readonly seq?: unknown
}

describe('room http api', () => {
    it('creates rooms over POST and reads them back over GET', async () => {
        const distDir = mkdtempSync(`${tmpdir()}${sep}relay-dist-`)
        writeFileSync(join(distDir, 'index.html'), '<h1>starforge</h1>')
        const store = new RoomStore(':memory:')
        try {
            const rooms = new RoomRegistry(store)
            const server = createServer({ distDir, origins: [], rooms, onSocket: () => undefined })
            servers.push(server)
            await new Promise<void>((resolve) => {
                server.listen(0, () => resolve())
            })
            const address = server.address()
            if (address === null || typeof address === 'string') throw new Error('no port')
            const base = `http://127.0.0.1:${String(address.port)}`

            const requestJson = (
                method: string,
                path: string,
                body?: unknown,
            ): Promise<{ status: number; json: RoomPayload }> =>
                new Promise((resolve, reject) => {
                    const text = body === undefined ? '' : JSON.stringify(body)
                    const req = http.request(
                        base + path,
                        {
                            method,
                            headers: {
                                'content-type': 'application/json',
                                'content-length': String(text.length),
                            },
                        },
                        (res) => {
                            let raw = ''
                            res.on('data', (chunk: Buffer) => {
                                raw += chunk.toString('utf8')
                            })
                            res.on('end', () => {
                                resolve({
                                    status: res.statusCode ?? 0,
                                    json: JSON.parse(raw) as unknown as RoomPayload,
                                })
                            })
                        },
                    )
                    req.on('error', reject)
                    if (text.length > 0) req.write(text)
                    req.end()
                })

            const created = await requestJson('POST', '/api/rooms', {
                title: 'Orbit',
                width: 64,
                height: 64,
            })
            expect(created.status).toBe(201)
            if (typeof created.json.id !== 'string') throw new Error('missing id')
            expect(created.json.id).toMatch(/^[A-Za-z0-9_-]{12}$/)

            const big = await requestJson('POST', '/api/rooms', {
                title: 'x',
                width: 512,
                height: 512,
            })
            expect(big.status).toBe(400)

            const missing = await requestJson('GET', '/api/rooms/AAAAAAAAAAAA')
            expect(missing.status).toBe(404)
            expect(missing.json).toEqual({ error: 'room_not_found' })

            const info = await requestJson('GET', `/api/rooms/${created.json.id}`)
            expect(info.status).toBe(200)
            expect(info.json).toMatchObject({ members: 0, seq: 0 })
        } finally {
            store.close()
        }
    })
})
