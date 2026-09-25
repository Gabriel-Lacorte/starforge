import { describe, expect, it } from 'vitest'
import { StrokeBroadcast } from './strokeBroadcast'

describe('stroke broadcast', () => {
    it('serves freehand cells as deltas until the stroke ends', () => {
        const broadcast = new StrokeBroadcast(16)
        broadcast.begin(0xff0000ff)
        broadcast.append(2, 3)
        broadcast.append(4, 3)

        expect(broadcast.take()).toEqual({ color: 0xff0000ff, cells: [50, 52], full: false })
        expect(broadcast.take()).toEqual({ color: 0xff0000ff, cells: [], full: false })

        broadcast.append(1, 1)
        expect(broadcast.take()).toEqual({ color: 0xff0000ff, cells: [17], full: false })

        broadcast.end()
        expect(broadcast.take()).toBeNull()
    })

    it('replaces the whole set for shape previews', () => {
        const broadcast = new StrokeBroadcast(16)
        broadcast.begin(0xff0000ff)
        broadcast.replace([10, 11, 12], 0xff0000ff)
        expect(broadcast.take()).toEqual({ color: 0xff0000ff, cells: [10, 11, 12], full: true })

        broadcast.replace([40], 0xff0000ff)
        expect(broadcast.take()).toEqual({ color: 0xff0000ff, cells: [40], full: true })
    })

    it('spreads deltas over frames when a single tick overflows', () => {
        const broadcast = new StrokeBroadcast(256)
        broadcast.begin(1)
        for (let i = 0; i < 1200; i++) broadcast.append(i, 0)

        const first = broadcast.take()!
        expect(first.full).toBe(false)
        expect(first.cells.length).toBe(500)
        const second = broadcast.take()!
        expect(second.cells.length).toBe(500)
        const third = broadcast.take()!
        expect(third.cells.length).toBe(200)
        expect(broadcast.take()!.cells.length).toBe(0)
    })

    it('ignores appends until a stroke begins and resets on width change', () => {
        const broadcast = new StrokeBroadcast(16)
        broadcast.append(0, 0)
        expect(broadcast.take()).toBeNull()

        broadcast.begin(1)
        broadcast.append(0, 1)
        broadcast.setWidth(32)
        expect(broadcast.active).toBe(false)
        expect(broadcast.take()).toBeNull()
    })
})
