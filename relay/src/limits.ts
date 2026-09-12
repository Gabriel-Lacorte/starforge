export class TokenBucket {
    private tokens: number
    private last: number
    private readonly capacity: number
    private readonly refillPerSec: number

    constructor(capacity: number, refillPerSec: number) {
        this.capacity = capacity
        this.refillPerSec = refillPerSec
        this.tokens = capacity
        this.last = Date.now()
    }

    take(count = 1): boolean {
        const now = Date.now()
        this.tokens = Math.min(
            this.capacity,
            this.tokens + ((now - this.last) / 1000) * this.refillPerSec,
        )
        this.last = now
        if (this.tokens < count) return false
        this.tokens -= count
        return true
    }
}

export function createThrottle(limitPerHour: number): (ip: string, now?: number) => boolean {
    const hits = new Map<string, number[]>()
    return (ip: string, now: number = Date.now()): boolean => {
        const cutoff = now - 3600 * 1000
        const kept = (hits.get(ip) ?? []).filter((at) => at > cutoff)
        if (kept.length >= limitPerHour) {
            hits.set(ip, kept)
            return false
        }
        kept.push(now)
        hits.set(ip, kept)
        return true
    }
}

const OP_CAPACITY = 60
const OP_REFILL_PER_SEC = 60
const BYTE_CAPACITY = 262144
const BYTE_REFILL_PER_SEC = 262144

export class ConnLimits {
    private readonly ops = new TokenBucket(OP_CAPACITY, OP_REFILL_PER_SEC)
    private readonly bytes = new TokenBucket(BYTE_CAPACITY, BYTE_REFILL_PER_SEC)

    admit(count: number): boolean {
        if (!this.bytes.take(count)) return false
        return this.ops.take(1)
    }

    admitBytes(count: number): boolean {
        return this.bytes.take(count)
    }

    admitOp(): boolean {
        return this.ops.take(1)
    }
}
