import { describe, expect, it } from 'vitest'
import { MAX_ROOMS, ROOM_TTL_DAYS, RoomStore } from './store'

function room(id: string, touchedAt = 1000) {
    return {
        id,
        title: 'orbit',
        width: 64,
        height: 64,
        snapshot: '{"v":1}',
        snapshotSeq: 0,
        touchedAt,
    }
}

describe('room store', () => {
    it('round-trips a room with its op tail in seq order', () => {
        const store = new RoomStore(':memory:')
        try {
            store.saveRoom(room('abc'))
            store.appendOp('abc', { seq: 2, stamp: 2, body: Uint8Array.of(9) })
            store.appendOp('abc', { seq: 1, stamp: 1, body: Uint8Array.of(7) })
            const [loaded] = store.loadAll()
            expect(loaded!.room.title).toBe('orbit')
            expect(loaded!.ops.map((op) => op.seq)).toEqual([1, 2])
            expect([...loaded!.ops[0]!.body]).toEqual([7])
        } finally {
            store.close()
        }
    })

    it('compacts the log below a new snapshot and deletes rooms with them', () => {
        const store = new RoomStore(':memory:')
        try {
            store.saveRoom(room('abc'))
            store.appendOp('abc', { seq: 1, stamp: 1, body: Uint8Array.of(1) })
            store.appendOp('abc', { seq: 2, stamp: 2, body: Uint8Array.of(2) })
            store.setSnapshot('abc', 2, '{"v":2}')
            expect(store.loadAll()[0]!.ops).toEqual([])
            expect(store.loadAll()[0]!.room.snapshotSeq).toBe(2)
            store.deleteRoom('abc')
            expect(store.loadAll()).toEqual([])
        } finally {
            store.close()
        }
    })

    it('prunes rooms untouched for longer than the TTL', () => {
        const day = 24 * 3600 * 1000
        const store = new RoomStore(':memory:')
        try {
            store.saveRoom(room('fresh', 10 * day))
            store.saveRoom(room('stale', 0))
            expect(store.pruneStale(10 * day + ROOM_TTL_DAYS * day + 1)).toBe(1)
            expect(store.loadAll().map((entry) => entry.room.id)).toEqual(['fresh'])
            expect(MAX_ROOMS).toBe(100)
        } finally {
            store.close()
        }
    })
})
