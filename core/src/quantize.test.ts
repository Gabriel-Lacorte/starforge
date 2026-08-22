import { describe, expect, it } from 'vitest'
import { medianCut } from './quantize'

function colorsFrom(seed: number, n: number): number[] {
    let s = seed >>> 0
    const rng = () => {
        s = (s * 1_664_525 + 1_013_904_223) >>> 0
        return s
    }
    const set = new Set<number>()
    while (set.size < n) set.add(rng() & 0xffffff)
    return [...set]
}

describe('medianCut', () => {
    it('reduces a large color set to at most `max` representatives', () => {
        const colors = colorsFrom(1, 1000)
        const { palette, map } = medianCut(colors, 256)
        expect(palette.length).toBeLessThanOrEqual(256)
        expect(map.size).toBe(colors.length)
    })

    it('maps every input color to a valid palette index', () => {
        const colors = colorsFrom(2, 500)
        const { palette, map } = medianCut(colors, 128)
        for (const c of colors) {
            const idx = map.get(c)
            expect(idx).toBeDefined()
            expect(idx!).toBeGreaterThanOrEqual(0)
            expect(idx!).toBeLessThan(palette.length)
        }
    })

    it('is deterministic, same input yields an identical palette and map', () => {
        const colors = colorsFrom(3, 700)
        const a = medianCut(colors, 256)
        const b = medianCut(colors, 256)
        expect(a.palette).toEqual(b.palette)
        expect([...a.map.entries()]).toEqual([...b.map.entries()])
    })

    it('sends a color to the same representative regardless of input order', () => {
        const colors = colorsFrom(4, 600)
        const a = medianCut(colors, 200)
        const b = medianCut([...colors].reverse(), 200)
        for (const c of colors) {
            expect(a.palette[a.map.get(c)!]).toBe(b.palette[b.map.get(c)!])
        }
    })

    it('keeps every color exactly when the set already fits within max', () => {
        const colors = colorsFrom(5, 40)
        const { palette, map } = medianCut(colors, 256)
        expect(palette.length).toBe(colors.length)
        for (const c of colors) expect(palette[map.get(c)!]).toBe(c)
    })

    it('produces integer channels within 0..255', () => {
        const { palette } = medianCut(colorsFrom(6, 800), 64)
        for (const rgb of palette) {
            for (const ch of [(rgb >>> 16) & 0xff, (rgb >>> 8) & 0xff, rgb & 0xff]) {
                expect(Number.isInteger(ch)).toBe(true)
                expect(ch).toBeGreaterThanOrEqual(0)
                expect(ch).toBeLessThanOrEqual(255)
            }
        }
    })

    it('collapses everything to one representative when max is 1', () => {
        const colors = colorsFrom(7, 300)
        const { palette, map } = medianCut(colors, 1)
        expect(palette.length).toBe(1)
        for (const c of colors) expect(map.get(c)).toBe(0)
    })

    it('handles an empty color set', () => {
        const { palette, map } = medianCut([], 256)
        expect(palette).toEqual([])
        expect(map.size).toBe(0)
    })
})
