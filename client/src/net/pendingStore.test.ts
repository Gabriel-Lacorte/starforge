import { describe, expect, it } from 'vitest'
import { localStoragePendingStore } from './pendingStore'

function memoryStorage(initial: Record<string, string> = {}): Storage {
    const data = new Map(Object.entries(initial))
    return {
        get length(): number {
            return data.size
        },
        clear: (): void => {
            data.clear()
        },
        getItem: (key: string): string | null => data.get(key) ?? null,
        key: (index: number): string | null => [...data.keys()][index] ?? null,
        removeItem: (key: string): void => {
            data.delete(key)
        },
        setItem: (key: string, value: string): void => {
            data.set(key, value)
        },
    }
}

describe('pending store', () => {
    it('round-trips pending ops per room', () => {
        const store = localStoragePendingStore(memoryStorage())
        store.save('abc', [
            { stamp: 7, body: Uint8Array.of(1, 2, 3) },
            { stamp: 9, body: Uint8Array.of(4) },
        ])
        const loaded = store.load('abc')
        expect(loaded).toHaveLength(2)
        expect(loaded[0]).toEqual({ stamp: 7, body: Uint8Array.of(1, 2, 3) })
        expect(loaded[1]).toEqual({ stamp: 9, body: Uint8Array.of(4) })
        expect(store.load('other')).toEqual([])
    })

    it('drops corrupt payloads instead of throwing', () => {
        const store = localStoragePendingStore(
            memoryStorage({
                'starforge:pending:abc': 'not json{{{',
                'starforge:pending:def': JSON.stringify([
                    { stamp: 1, body: '!!!' },
                    { stamp: -2, body: 'AA==' },
                    { stamp: 3, body: 'AQI=' },
                    'garbage',
                    null,
                ]),
            }),
        )
        expect(store.load('abc')).toEqual([])
        const loaded = store.load('def')
        expect(loaded).toHaveLength(1)
        expect(loaded[0]).toEqual({ stamp: 3, body: Uint8Array.of(1, 2) })
    })
})
