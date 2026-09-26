import type { RoomStore } from './store.js'

const PERSISTED_KEYS: readonly string[] = [
    'rooms_created',
    'ops_applied',
    'ops_rejected',
    'resyncs_sent',
    'sockets_opened',
]

const FLUSH_INTERVAL_MS = 5_000

export interface TelemetrySnapshot {
    readonly lifetime: Readonly<Record<string, number>>
    readonly session: Readonly<Record<string, number>>
    readonly uptimeSeconds: number
}

export class Telemetry {
    private readonly store: RoomStore
    private readonly lifetime = new Map<string, number>()
    private readonly session = new Map<string, number>()
    private readonly dirty = new Set<string>()
    private readonly bootedAt = Date.now()
    private timer: ReturnType<typeof setInterval> | null = null

    constructor(store: RoomStore) {
        this.store = store
        for (const [key, value] of Object.entries(store.loadStats())) {
            this.lifetime.set(key, value)
        }
    }

    count(name: string, n = 1): void {
        if (n <= 0) return

        this.session.set(name, (this.session.get(name) ?? 0) + n)
        if (!PERSISTED_KEYS.includes(name)) return

        this.lifetime.set(name, (this.lifetime.get(name) ?? 0) + n)
        this.dirty.add(name)
        if (this.timer === null) {
            this.timer = setInterval(() => {
                this.flush()
            }, FLUSH_INTERVAL_MS)
            this.timer.unref()
        }
    }

    flush(): void {
        if (this.timer !== null) {
            clearInterval(this.timer)
            this.timer = null
        }
        if (this.dirty.size === 0) return

        const deltas: Record<string, number> = {}
        for (const key of this.dirty) deltas[key] = this.lifetime.get(key) ?? 0
        this.dirty.clear()
        this.store.bumpStats(deltas)
    }

    seedAtLeast(name: string, value: number): void {
        if (!PERSISTED_KEYS.includes(name) || value <= 0) return
        if (value <= (this.lifetime.get(name) ?? 0)) return

        this.lifetime.set(name, value)
        this.dirty.add(name)
    }

    snapshot(): TelemetrySnapshot {
        return {
            lifetime: Object.fromEntries(this.lifetime),
            session: Object.fromEntries(this.session),
            uptimeSeconds: Math.max(0, Math.round((Date.now() - this.bootedAt) / 1000)),
        }
    }
}

export interface RoomMetrics {
    count(name: string, n?: number): void
}
