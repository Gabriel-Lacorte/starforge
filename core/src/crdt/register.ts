import { isNewer, type Stamp } from './stamp'

export class LwwRegisters {
    private readonly stamps = new Map<string, Stamp>()

    accept(key: string, stamp: Stamp): boolean {
        const current = this.stamp(key)
        if (!isNewer(stamp, current)) {
            return false
        }

        this.stamps.set(key, stamp)
        return true
    }

    stamp(key: string): Stamp {
        return this.stamps.get(key) ?? 0
    }
}
