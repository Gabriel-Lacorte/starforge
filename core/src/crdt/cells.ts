import { isNewer, type Stamp } from './stamp'

function assertSize(size: number): void {
    if (!Number.isInteger(size) || size < 1) {
        throw new RangeError(`Invalid cel size: ${size}`)
    }
}

function assertStamp(stamp: Stamp, allowBaseline = false): void {
    if (!Number.isInteger(stamp) || stamp < (allowBaseline ? 0 : 1) || stamp > 0xffffffff) {
        throw new RangeError(`Invalid stamp: ${stamp}`)
    }
}

export class CelStamps {
    private shadow: Uint32Array | undefined
    private readonly size: number
    readonly baseline: Stamp

    constructor(size: number, baseline: Stamp = 0) {
        assertSize(size)
        assertStamp(baseline, true)
        this.size = size
        this.baseline = baseline
    }

    get hasShadow(): boolean {
        return this.shadow !== undefined
    }

    read(index: number): Stamp {
        this.assertIndex(index)
        const stamp = this.shadow?.[index]
        return stamp === undefined || stamp === 0 ? this.baseline : stamp
    }

    accept(index: number, stamp: Stamp): boolean {
        this.assertIndex(index)
        assertStamp(stamp)

        if (!isNewer(stamp, this.read(index))) {
            return false
        }

        this.shadow ??= new Uint32Array(this.size)
        this.shadow[index] = stamp
        return true
    }

    private assertIndex(index: number): void {
        if (!Number.isInteger(index) || index < 0 || index >= this.size) {
            throw new RangeError(`Invalid cel index: ${index}`)
        }
    }
}
