import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RoomStore } from './store'
import { Telemetry } from './telemetry'

const stores: RoomStore[] = []

function freshStore(): RoomStore {
    const store = new RoomStore(join(mkdtempSync(join(tmpdir(), 'telemetry-')), 'relay.sqlite'))
    stores.push(store)
    return store
}

afterEach(() => {
    while (stores.length > 0) {
        const store = stores.pop()!
        store.close()
    }
})

describe('Telemetry', () => {
    it('counts session and lifetime metrics separately', () => {
        const store = freshStore()
        const telemetry = new Telemetry(store)

        telemetry.count('rooms_created')
        telemetry.count('rooms_created')
        telemetry.count('presence_frames', 5)

        const snap = telemetry.snapshot()
        expect(snap.lifetime.rooms_created).toBe(2)
        expect(snap.session.presence_frames).toBe(5)
        expect(snap.lifetime.presence_frames).toBeUndefined()
        expect(snap.uptimeSeconds).toBeGreaterThanOrEqual(0)
    })

    it('persists lifetime counters across a restart', () => {
        const store = freshStore()
        const first = new Telemetry(store)
        first.count('ops_applied', 3)
        first.count('rooms_created')
        first.flush()

        const second = new Telemetry(store)
        const snap = second.snapshot()
        expect(snap.lifetime.ops_applied).toBe(3)
        expect(snap.lifetime.rooms_created).toBe(1)
        expect(second.snapshot().session.ops_applied).toBeUndefined()
    })

    it('flush writes only the dirty keys', () => {
        const store = freshStore()
        const telemetry = new Telemetry(store)
        telemetry.flush()
        expect(store.loadStats()).toEqual({})

        telemetry.count('resyncs_sent', 2)
        telemetry.flush()
        expect(store.loadStats()).toEqual({ resyncs_sent: 2 })
    })
})
