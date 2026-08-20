import { describe, expect, it } from 'vitest'
import { rgba } from './color'
import { isSelected, rectMask, type SelectionMask } from './mask'
import {
    mirrorCells,
    transformMask,
    transformPlacement,
    transformRegion,
    type TransformKind,
} from './transform'

const WIDE = Uint32Array.from([1, 2, 3, 4, 5, 6])

function grid(region: { pixels: Uint32Array; width: number }): number[][] {
    const rows: number[][] = []
    for (let at = 0; at < region.pixels.length; at += region.width) {
        rows.push([...region.pixels.slice(at, at + region.width)])
    }
    return rows
}

describe('transformRegion', () => {
    it('mirrors across the vertical axis', () => {
        expect(grid(transformRegion(WIDE, 3, 2, 'flip-h'))).toEqual([
            [3, 2, 1],
            [6, 5, 4],
        ])
    })

    it('mirrors across the horizontal axis', () => {
        expect(grid(transformRegion(WIDE, 3, 2, 'flip-v'))).toEqual([
            [4, 5, 6],
            [1, 2, 3],
        ])
    })

    it('turns a quarter clockwise, transposing the box', () => {
        const turned = transformRegion(WIDE, 3, 2, 'rotate-cw')

        expect([turned.width, turned.height]).toEqual([2, 3])
        expect(grid(turned)).toEqual([
            [4, 1],
            [5, 2],
            [6, 3],
        ])
    })

    it('turns a quarter the other way', () => {
        expect(grid(transformRegion(WIDE, 3, 2, 'rotate-ccw'))).toEqual([
            [3, 6],
            [2, 5],
            [1, 4],
        ])
    })

    it('turns a half without transposing', () => {
        expect(grid(transformRegion(WIDE, 3, 2, 'rotate-180'))).toEqual([
            [6, 5, 4],
            [3, 2, 1],
        ])
    })

    it('carries every value across untouched, alpha included', () => {
        const region = Uint32Array.from([rgba(1, 2, 3, 0), rgba(9, 8, 7, 128)])
        const moved = transformRegion(region, 2, 1, 'flip-h')

        expect([...moved.pixels].sort()).toEqual([...region].sort())
    })

    it('is its own inverse for a mirror, and four turns come home', () => {
        for (const kind of ['flip-h', 'flip-v', 'rotate-180'] as const) {
            const there = transformRegion(WIDE, 3, 2, kind)
            expect([
                ...transformRegion(there.pixels, there.width, there.height, kind).pixels,
            ]).toEqual([...WIDE])
        }

        let turned = transformRegion(WIDE, 3, 2, 'rotate-cw')
        for (let quarter = 0; quarter < 3; quarter++) {
            turned = transformRegion(turned.pixels, turned.width, turned.height, 'rotate-cw')
        }
        expect([...turned.pixels]).toEqual([...WIDE])
    })

    it('refuses a region whose size does not match its own dimensions', () => {
        expect(() => transformRegion(WIDE, 4, 2, 'flip-h')).toThrow(RangeError)
    })
})

describe('transformPlacement', () => {
    it('leaves a mirror exactly where it was', () => {
        const bounds = { x: 3, y: 4, w: 6, h: 2 }
        for (const kind of ['flip-h', 'flip-v', 'rotate-180'] as const) {
            expect(transformPlacement(bounds, kind)).toEqual(bounds)
        }
    })

    it('re-centres a quarter turn on the box it replaced', () => {
        expect(transformPlacement({ x: 2, y: 2, w: 6, h: 2 }, 'rotate-cw')).toEqual({
            x: 4,
            y: 0,
            w: 2,
            h: 6,
        })
    })

    it('leaves a square turn in place', () => {
        const square = { x: 1, y: 1, w: 4, h: 4 }
        expect(transformPlacement(square, 'rotate-cw')).toEqual(square)
    })
})

describe('transformMask', () => {
    const corner = (): SelectionMask => rectMask(16, 16, 2, 2, 5, 3)

    it('moves the selection the same way it moves the pixels', () => {
        const flipped = transformMask(corner(), 'flip-h')

        expect(flipped.bounds).toEqual({ x: 2, y: 2, w: 4, h: 2 })
        expect(isSelected(flipped, 2, 2)).toBe(true)
    })

    it('transposes and re-centres a quarter turn', () => {
        expect(transformMask(corner(), 'rotate-cw').bounds).toEqual({ x: 3, y: 1, w: 2, h: 4 })
    })

    it('drops whatever a turn pushes off the document', () => {
        const edge = rectMask(16, 16, 0, 7, 15, 8)
        const turned = transformMask(edge, 'rotate-cw')

        expect(turned.bounds?.h).toBeLessThanOrEqual(16)
    })

    it('has nothing to move when nothing is selected', () => {
        const empty = rectMask(16, 16, 2, 2, 2, 2)
        const kinds: TransformKind[] = ['flip-h', 'rotate-cw']
        for (const kind of kinds) expect(transformMask(empty, kind).bounds).not.toBeNull()
    })
})

describe('mirrorCells', () => {
    it('adds nothing when symmetry is off', () => {
        expect(mirrorCells(2, 3, 16, 16, false, false)).toEqual([[2, 3]])
    })

    it('mirrors across the document centre', () => {
        expect(mirrorCells(2, 3, 16, 16, true, false)).toEqual([
            [2, 3],
            [13, 3],
        ])
        expect(mirrorCells(2, 3, 16, 16, false, true)).toEqual([
            [2, 3],
            [2, 12],
        ])
        expect(mirrorCells(2, 3, 16, 16, true, true)).toEqual([
            [2, 3],
            [13, 3],
            [2, 12],
            [13, 12],
        ])
    })

    it('does not paint a cell twice when it sits on the axis', () => {
        expect(mirrorCells(2, 2, 5, 5, true, true)).toEqual([[2, 2]])
        expect(mirrorCells(1, 2, 5, 5, true, true)).toEqual([
            [1, 2],
            [3, 2],
        ])
    })
})
