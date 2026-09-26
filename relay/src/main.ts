import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync } from 'node:fs'
import { loadConfig } from './config.js'
import { RelayLog } from './log.js'
import { RoomRegistry } from './rooms.js'
import { RoomStore } from './store.js'
import { createServer } from './http.js'

const root = dirname(fileURLToPath(import.meta.url))
const dist = join(root, '..', '..', 'client', 'dist')

const config = loadConfig(process.env)
const log = new RelayLog()
mkdirSync(config.dataDir, { recursive: true })
const store = new RoomStore(join(config.dataDir, 'relay.sqlite'))
const rooms = new RoomRegistry(store, { log, roomsPerHour: config.roomsPerHour })
const rehydrated = rooms.rehydrate()
rooms.seedRoomsEver(store.countRooms())
log.info('rehydrated', { rooms: rehydrated.rooms, dropped: rehydrated.dropped })

const server = createServer({
    distDir: existsSync(dist) ? dist : null,
    origins: config.origins,
    rooms,
    stats: (): unknown => {
        rooms.flushTelemetry()
        return rooms.stats()
    },
    onSocket: (socket, ip) => {
        rooms.attach(socket, ip, config)
    },
})
server.listen(config.port, () => {
    log.info('listening', {
        port: config.port,
        dataDir: config.dataDir,
        maxMessageBytes: config.maxMessageBytes,
        origins: config.origins.length,
        dist: existsSync(dist),
    })
})

function shutdown(signal: string): void {
    log.info('stopping', { signal })
    rooms.flushTelemetry()
    log.flush()
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
process.on('uncaughtException', (error: Error) => {
    log.error('uncaught', { name: error.name, message: error.message, stack: error.stack })
    process.exit(1)
})
process.on('unhandledRejection', (reason: unknown) => {
    log.error('unhandled_rejection', {
        message: reason instanceof Error ? reason.message : String(reason),
    })
    process.exit(1)
})
