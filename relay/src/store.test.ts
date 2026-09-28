import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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
        lamport: 0,
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
            store.setSnapshot('abc', 2, '{"v":2}', 7)
            expect(store.loadAll()[0]!.ops).toEqual([])
            expect(store.loadAll()[0]!.room.snapshotSeq).toBe(2)
            expect(store.loadAll()[0]!.room.lamport).toBe(7)
            store.deleteRoom('abc')
            expect(store.loadAll()).toEqual([])
        } finally {
            store.close()
        }
    })

    it('persists and reloads order keys alongside ops', () => {
        const store = new RoomStore(':memory:')
        try {
            store.saveRoom(room('abc'))
            store.appendOp('abc', { seq: 1, stamp: 1, body: Uint8Array.of(1), orderKey: 2.5 })
            store.appendOp('abc', { seq: 2, stamp: 2, body: Uint8Array.of(2) })
            const ops = store.loadAll()[0]!.ops
            expect(ops[0]).toMatchObject({ seq: 1, orderKey: 2.5 })
            expect(ops[1]).toMatchObject({ seq: 2 })
            expect(ops[1]!.orderKey).toBeUndefined()
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

    it('boots over a junk oversized stat row by clamping it', () => {
        const dir = mkdtempSync(join(tmpdir(), 'relay-store-'))
        const path = join(dir, 'relay.sqlite')
        const raw = new DatabaseSync(path)
        raw.exec('CREATE TABLE stat (key TEXT PRIMARY KEY, value INTEGER NOT NULL)')
        raw.prepare('INSERT INTO stat (key, value) VALUES (?, ?)').run(
            'rooms_created',
            62_056_283_881_901_529n,
        )
        raw.close()

        const store = new RoomStore(path)
        try {
            expect(store.loadStats()).toEqual({ rooms_created: 9_007_199_254_740_991 })
            store.bumpStats({ rooms_created: 1 })
            expect(store.loadStats()).toEqual({ rooms_created: 9_007_199_254_740_991 })
        } finally {
            store.close()
        }
    })
})
