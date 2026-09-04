export type SiteId = number
export type Stamp = number

export const MAX_LAMPORT = 0x00ffffff

function assertLamport(lamport: number): void {
    if (!Number.isInteger(lamport) || lamport < 1 || lamport > MAX_LAMPORT) {
        throw new RangeError(`Invalid Lamport value: ${lamport}`)
    }
}

function assertSite(site: number): void {
    if (!Number.isInteger(site) || site < 1 || site > 0xff) {
        throw new RangeError(`Invalid site ID: ${site}`)
    }
}

export function packStamp(lamport: number, site: SiteId): Stamp {
    assertLamport(lamport)
    assertSite(site)

    return ((lamport << 8) | site) >>> 0
}

export function stampLamport(stamp: Stamp): number {
    return stamp >>> 8
}

export function stampSite(stamp: Stamp): SiteId {
    return stamp & 0xff
}

export function isNewer(candidate: Stamp, current: Stamp): boolean {
    return candidate >>> 0 > current >>> 0
}

class LamportExhaustedError extends Error {
    constructor() {
        super('Lamport clock exhausted')
        this.name = 'LamportExhaustedError'
    }
}

export class LamportClock {
    private lamport = 0
    private readonly site: SiteId

    constructor(site: SiteId) {
        assertSite(site)
        this.site = site
    }

    next(): Stamp {
        if (this.lamport >= MAX_LAMPORT) {
            throw new LamportExhaustedError()
        }
        this.lamport += 1
        return packStamp(this.lamport, this.site)
    }

    observe(stamp: Stamp): void {
        this.lamport = Math.max(this.lamport, stampLamport(stamp))
    }
}
