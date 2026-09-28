import { describe, expect, it } from 'vitest'
import { brushSizeStops, maxBrushSize, sizeStopIndex } from './definition'

describe('maxBrushSize', () => {
    it('caps a stamp at a quarter of the smaller side', () => {
        expect(maxBrushSize({ width: 8, height: 8 })).toBe(2)
        expect(maxBrushSize({ width: 16, height: 16 })).toBe(4)
        expect(maxBrushSize({ width: 64, height: 64 })).toBe(16)
        expect(maxBrushSize({ width: 16, height: 48 })).toBe(4)
    })

    it('never passes the global stamp maximum', () => {
        expect(maxBrushSize({ width: 1024, height: 1024 })).toBeLessThanOrEqual(64)
    })
})

describe('brushSizeStops', () => {
    it('gives every small size its own stop, then coarsens', () => {
        expect(brushSizeStops(4)).toEqual([1, 2, 3, 4])
        expect(brushSizeStops(8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
        expect(brushSizeStops(16)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16])
    })

    it('always reaches the cap', () => {
        expect(brushSizeStops(2)).toEqual([1, 2])
        expect(brushSizeStops(9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    })
})

describe('sizeStopIndex', () => {
    const stops = brushSizeStops(16)

    it('lands below or on the size', () => {
        expect(sizeStopIndex(stops, 1)).toBe(0)
        expect(sizeStopIndex(stops, 7)).toBe(6)
        expect(sizeStopIndex(stops, 9)).toBe(7)
        expect(sizeStopIndex(stops, 99)).toBe(stops.length - 1)
    })
})
