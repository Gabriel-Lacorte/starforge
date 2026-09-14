export interface OutboxEntry {
    readonly stamp: number
    readonly body: Uint8Array
}

export const MAX_PENDING = 500

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
