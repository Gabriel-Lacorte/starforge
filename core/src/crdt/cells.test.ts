import { describe, expect, it } from 'vitest'
import { CelStamps } from './cells'
import { packStamp } from './stamp'

describe('CelStamps', () => {
    it('reads the default baseline from an untouched 16 by 16 cel', () => {
        const cel = new CelStamps(16 * 16)

        expect(cel.baseline).toBe(0)
        expect(cel.hasShadow).toBe(false)
        expect(cel.read(0)).toBe(0)
        expect(cel.read(255)).toBe(0)
    })

    it('reads an explicit nonzero baseline before any pixel is accepted', () => {
        const baseline = packStamp(4, 2)
        const cel = new CelStamps(4, baseline)

        expect(cel.baseline).toBe(baseline)
        expect(cel.hasShadow).toBe(false)
        expect(cel.read(2)).toBe(baseline)
    })

    it('allocates sparse state only after accepting a newer stamp', () => {
        const baseline = packStamp(4, 2)
        const newer = packStamp(5, 3)
        const cel = new CelStamps(4, baseline)

        expect(cel.accept(1, newer)).toBe(true)

        expect(cel.hasShadow).toBe(true)
        expect(cel.read(1)).toBe(newer)
        expect(cel.read(0)).toBe(baseline)
    })

    it('rejects equal and stale stamps at a pixel', () => {
        const current = packStamp(5, 3)
        const cel = new CelStamps(2)
        cel.accept(0, current)

        expect(cel.accept(0, current)).toBe(false)
        expect(cel.accept(0, packStamp(4, 255))).toBe(false)
        expect(cel.read(0)).toBe(current)
    })

    it('accepts a later stamp at an already shadowed pixel', () => {
        const earlier = packStamp(5, 3)
        const later = packStamp(6, 1)
        const cel = new CelStamps(2)
        cel.accept(0, earlier)

        expect(cel.accept(0, later)).toBe(true)
        expect(cel.read(0)).toBe(later)
    })

    it('validates size, pixel indexes, and stamps', () => {
        for (const size of [0, -1, 1.5, Number.NaN]) {
            expect(() => new CelStamps(size)).toThrow(RangeError)
        }

        const cel = new CelStamps(2)
        const valid = packStamp(1, 1)
        for (const index of [-1, 2, 0.5, Number.NaN]) {
            expect(() => cel.read(index)).toThrow(RangeError)
            expect(() => cel.accept(index, valid)).toThrow(RangeError)
        }
        for (const stamp of [0, 1.5, Number.NaN]) {
            expect(() => cel.accept(0, stamp)).toThrow(RangeError)
        }
        expect(() => new CelStamps(2, 0)).not.toThrow()
        expect(() => new CelStamps(2, 1.5)).toThrow(RangeError)
    })

    it('resolves a two-pixel patch independently per pixel', () => {
        const oldPatch = packStamp(5, 1)
        const newPatch = packStamp(6, 1)
        const cel = new CelStamps(2)

        cel.accept(0, newPatch)
        cel.accept(1, oldPatch)

        expect(cel.accept(0, oldPatch)).toBe(false)
        expect(cel.accept(1, newPatch)).toBe(true)
        expect(cel.read(0)).toBe(newPatch)
        expect(cel.read(1)).toBe(newPatch)
    })
})
