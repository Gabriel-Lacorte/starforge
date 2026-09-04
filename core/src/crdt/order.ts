import { isNewer, type Stamp } from './stamp'

interface Entry {
    key: number
    stamp: Stamp
}

export class OrderBook {
    private readonly entries = new Map<string, Entry>()
    private rebalanceStamp: Stamp = 0

    seed(ids: readonly string[]): void {
        const entries = new Map<string, Entry>()
        for (const [key, id] of ids.entries()) {
            if (entries.has(id)) {
                throw new RangeError(`Duplicate order id: ${id}`)
            }
            entries.set(id, { key, stamp: 0 })
        }

        this.entries.clear()
        for (const [id, entry] of entries) {
            this.entries.set(id, entry)
        }
        this.rebalanceStamp = 0
    }

    key(id: string): number {
        return this.entry(id).key
    }

    add(id: string, key: number, stamp: Stamp): void {
        this.assertFiniteKey(key)
        if (this.entries.has(id)) {
            throw new RangeError(`Duplicate order id: ${id}`)
        }
        this.entries.set(id, { key, stamp })
    }

    accept(id: string, key: number, stamp: Stamp): boolean {
        const entry = this.entry(id)
        this.assertFiniteKey(key)
        if (!isNewer(stamp, this.rebalanceStamp)) {
            return false
        }
        if (!isNewer(stamp, entry.stamp)) {
            return false
        }

        entry.key = key
        entry.stamp = stamp
        return true
    }

    sorted(ids: readonly string[]): string[] {
        for (const id of ids) {
            this.entry(id)
        }
        return [...ids].sort((left, right) => {
            const keyDifference = this.key(left) - this.key(right)
            return keyDifference || left.localeCompare(right)
        })
    }

    applyRebalance(keys: readonly (readonly [id: string, key: number])[], stamp: Stamp): boolean {
        const updates = new Map<string, number>()
        for (const [id, key] of keys) {
            this.entry(id)
            this.assertFiniteKey(key)
            if (updates.has(id)) {
                throw new RangeError(`Duplicate order id: ${id}`)
            }
            updates.set(id, key)
        }

        if (!isNewer(stamp, this.rebalanceStamp)) {
            return false
        }

        for (const [id, key] of updates) {
            const entry = this.entry(id)
            if (isNewer(stamp, entry.stamp)) {
                entry.key = key
                entry.stamp = stamp
            }
        }
        this.rebalanceStamp = stamp
        return true
    }

    private entry(id: string): Entry {
        const entry = this.entries.get(id)
        if (entry === undefined) {
            throw new RangeError(`Unknown order id: ${id}`)
        }
        return entry
    }

    private assertFiniteKey(key: number): void {
        if (!Number.isFinite(key)) {
            throw new RangeError(`Invalid order key: ${key}`)
        }
    }
}
