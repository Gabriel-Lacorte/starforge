import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync } from 'node:fs'
import { loadConfig } from './config.js'
import { RoomRegistry } from './rooms.js'
import { RoomStore } from './store.js'
import { createServer } from './http.js'

const root = dirname(fileURLToPath(import.meta.url))
const dist = join(root, '..', '..', 'client', 'dist')

const config = loadConfig(process.env)
mkdirSync(config.dataDir, { recursive: true })
const store = new RoomStore(join(config.dataDir, 'relay.sqlite'))
const rooms = new RoomRegistry(store)
const rehydrated = rooms.rehydrate()
console.log(
    `relay rehydrated ${String(rehydrated.rooms)} rooms, dropped ${String(rehydrated.dropped)}`,
)

const server = createServer({
    distDir: existsSync(dist) ? dist : null,
    origins: config.origins,
    rooms,
    onSocket: (socket, ip) => {
        rooms.attach(socket, ip, config)
    },
})
server.listen(config.port, () => {
    console.log(`relay listening on :${String(config.port)}`)
})

function shutdown(signal: string): void {
    console.log(`relay received ${signal}`)
    server.close(() => {
        process.exit(0)
    })
    setTimeout(() => {
        process.exit(0)
    }, 5000).unref()
}

process.on('SIGTERM', () => {
    shutdown('SIGTERM')
})
process.on('SIGINT', () => {
    shutdown('SIGINT')
})
