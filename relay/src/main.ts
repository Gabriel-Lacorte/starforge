import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { loadConfig } from './config.js'
import { Room } from './room.js'
import { createServer } from './http.js'

const root = dirname(fileURLToPath(import.meta.url))
const dist = join(root, '..', '..', 'client', 'dist')

const config = loadConfig(process.env)
const room = new Room()

const server = createServer({
    distDir: existsSync(dist) ? dist : null,
    origins: config.origins,
    onSocket: (socket) => {
        room.attach(socket, config)
    },
})
server.listen(config.port, () => {
    console.log(`relay listening on :${String(config.port)}`)
})

// Deploys and rollbacks send SIGTERM: stop accepting, let flying ops land,
// then force the door. Long-lived WebSocket rooms never drain on their own,
// so the cap keeps a rollout from hanging forever.
function shutdown(signal: string): void {
    console.log(`relay received ${signal}, draining...`)
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
