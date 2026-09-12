/** One unacknowledged outbound op: the exact bytes the wire has not confirmed. */
export interface OutboxEntry {
    readonly stamp: number
    readonly body: Uint8Array
}

/** Cap on unacked ops; beyond it the oldest entry is dropped first. */
export const MAX_PENDING = 500

/**
 * Offline outbox: every locally published op waits here until its sender
 * echo comes back and `ack`s it by stamp. A reconnect replays whatever is
 * still pending with the SAME stamps and bytes — duplicates converge (LWW
 * keeps the newest write, the relay just ticks its seq again), so there is
 * no dedupe table. A RESYNC drops everything: in-flight ops are not
 * recovered across a snapshot rejoin (documented boundary).
 */
export class Outbox {
    private entries: OutboxEntry[] = []

    get pending(): readonly OutboxEntry[] {
        return this.entries
    }

    add(stamp: number, body: Uint8Array): void {
        this.entries.push({ stamp, body })
        while (this.entries.length > MAX_PENDING) this.entries.shift()
    }

    ack(stamp: number): boolean {
        const index = this.entries.findIndex((entry) => entry.stamp === stamp)
        if (index < 0) return false
        this.entries.splice(index, 1)
        return true
    }

    takeAll(): OutboxEntry[] {
        const drained = this.entries
        this.entries = []
        return drained
    }

    clear(): void {
        this.entries = []
    }
}
