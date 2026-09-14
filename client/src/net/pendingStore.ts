export interface PendingOp {
    readonly stamp: number
    readonly body: Uint8Array
}

export interface PendingStore {
    load(roomId: string): PendingOp[]
    save(roomId: string, ops: readonly PendingOp[]): void
}

const KEY = 'starforge:pending:'

function encodeBody(body: Uint8Array): string {
    let out = ''
    for (let i = 0; i < body.length; i += 0x8000) {
        out += String.fromCharCode(...body.subarray(i, i + 0x8000))
    }
    return btoa(out)
}

function decodeBody(raw: unknown): Uint8Array | null {
    if (typeof raw !== 'string') return null
    try {
        const text = atob(raw)
        const out = new Uint8Array(text.length)
        for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i)
        return out
    } catch {
        return null
    }
}

type PendingStorage = Pick<Storage, 'getItem' | 'setItem'>

function resolveStorage(explicit?: PendingStorage): PendingStorage | undefined {
    if (explicit !== undefined) return explicit
    if (typeof localStorage === 'undefined') return undefined
    return localStorage
}

export function localStoragePendingStore(storage?: PendingStorage): PendingStore {
    return {
        load(roomId: string): PendingOp[] {
            const store = resolveStorage(storage)
            if (store === undefined) return []

            let raw: string | null
            try {
                raw = store.getItem(`${KEY}${roomId}`)
            } catch {
                return []
            }
            if (raw === null) return []

            let parsed: unknown
            try {
                parsed = JSON.parse(raw) as unknown
            } catch {
                return []
            }
            if (!Array.isArray(parsed)) return []

            const ops: PendingOp[] = []
            for (const entry of parsed) {
                if (typeof entry !== 'object' || entry === null) continue

                const record = entry as Record<string, unknown>
                if (!Number.isInteger(record.stamp) || (record.stamp as number) < 0) continue

                const body = decodeBody(record.body)
                if (body === null) continue

                ops.push({ stamp: record.stamp as number, body })
            }

            return ops
        },
        save(roomId: string, ops: readonly PendingOp[]): void {
            const store = resolveStorage(storage)
            if (store === undefined) return

            try {
                store.setItem(
                    `${KEY}${roomId}`,
                    JSON.stringify(
                        ops.map((op) => ({ stamp: op.stamp, body: encodeBody(op.body) })),
                    ),
                )
            } catch {
                /* quota or private mode */
            }
        },
    }
}
