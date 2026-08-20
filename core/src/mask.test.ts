import { describe, expect, it } from 'vitest'
import { rgba } from './color'
import { createSprite, type Sprite } from './doc'
import { plotEllipse, plotRect } from './geom'
import {
    allMask,
    combineMasks,
    ellipseMask,
    emptyMask,
    invertMask,
    isEmptyMask,
    isSelected,
    maskOutline,
    polygonMask,
    rectMask,
    translateMask,
    wandMask,
    type SelectionMask,
} from './mask'
import { writePixel } from './ops'

const RED = rgba(255, 0, 0)
const BLUE = rgba(0, 0, 255)

function count(mask: SelectionMask): number {
    return mask.cells.reduce<number>((total, cell) => total + cell, 0)
}

function doc(): { sprite: Sprite; layer: string; frame: string } {
    const sprite = createSprite({ width: 16, height: 16 })
    return { sprite, layer: sprite.layers[0]!.id, frame: sprite.frames[0]!.id }
}

describe('mask shapes', () => {
    it('starts empty, with no bounds to report', () => {
        const mask = emptyMask(16, 16)

        expect(isEmptyMask(mask)).toBe(true)
        expect(mask.bounds).toBeNull()
        expect(count(mask)).toBe(0)
    })

    it('selects everything, and its bounds are the document', () => {
        const mask = allMask(16, 16)

        expect(count(mask)).toBe(256)
        expect(mask.bounds).toEqual({ x: 0, y: 0, w: 16, h: 16 })
    })

    it('takes a rectangle in any drag direction and clips it to the document', () => {
        const forward = rectMask(16, 16, 2, 3, 5, 7)
        expect(forward.bounds).toEqual({ x: 2, y: 3, w: 4, h: 5 })
        expect(count(forward)).toBe(20)

        expect(rectMask(16, 16, 5, 7, 2, 3).cells).toEqual(forward.cells)
        expect(rectMask(16, 16, -4, -4, 1, 1).bounds).toEqual({ x: 0, y: 0, w: 2, h: 2 })
    })

    it('selects exactly the cells the rectangle tool would paint', () => {
        const drawn = new Set<number>()
        plotRect(2, 3, 11, 9, true, (x, y) => drawn.add(y * 16 + x))

        const mask = rectMask(16, 16, 2, 3, 11, 9)
        for (let cell = 0; cell < mask.cells.length; cell++) {
            expect(mask.cells[cell] === 1).toBe(drawn.has(cell))
        }
    })

    it('selects exactly the cells the ellipse tool would paint', () => {
        const drawn = new Set<number>()
        plotEllipse(1, 2, 12, 10, true, (x, y) => drawn.add(y * 16 + x))

        const mask = ellipseMask(16, 16, 1, 2, 12, 10)
        for (let cell = 0; cell < mask.cells.length; cell++) {
            expect(mask.cells[cell] === 1).toBe(drawn.has(cell))
        }
    })

    it('fills a polygon by its interior, not its outline', () => {
        const triangle = polygonMask(16, 16, [
            { x: 2, y: 2 },
            { x: 12, y: 2 },
            { x: 2, y: 12 },
        ])

        expect(isSelected(triangle, 3, 3)).toBe(true)
        expect(isSelected(triangle, 10, 10)).toBe(false)

        /* every selected centre sits inside the two legs and under the hypotenuse x + y = 14 */
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                if (!isSelected(triangle, x, y)) continue
                expect(x).toBeGreaterThanOrEqual(2)
                expect(y).toBeGreaterThanOrEqual(2)
                expect(x + y).toBeLessThan(14)
            }
        }
    })

    it('selects a concave polygon without bleeding across the notch', () => {
        /* a c opening to the right, the gap between the arms must stay unselected */
        const shape = polygonMask(16, 16, [
            { x: 2, y: 2 },
            { x: 12, y: 2 },
            { x: 12, y: 5 },
            { x: 5, y: 5 },
            { x: 5, y: 10 },
            { x: 12, y: 10 },
            { x: 12, y: 13 },
            { x: 2, y: 13 },
        ])

        expect(isSelected(shape, 8, 3)).toBe(true)
        expect(isSelected(shape, 8, 7)).toBe(false)
        expect(isSelected(shape, 8, 11)).toBe(true)
    })

    it('selects nothing from a degenerate polygon', () => {
        expect(isEmptyMask(polygonMask(16, 16, []))).toBe(true)
        expect(isEmptyMask(polygonMask(16, 16, [{ x: 1, y: 1 }]))).toBe(true)
        expect(
            isEmptyMask(
                polygonMask(16, 16, [
                    { x: 1, y: 1 },
                    { x: 9, y: 9 },
                ]),
            ),
        ).toBe(true)
    })
})

describe('magic wand', () => {
    it('selects the region the bucket would have filled', () => {
        const { sprite, layer, frame } = doc()
        for (let y = 0; y < 16; y++) writePixel(sprite, layer, frame, 8, y, BLUE)

        const left = wandMask(sprite, layer, frame, 0, 0, { tolerance: 0, contiguous: true })
        expect(isSelected(left, 7, 0)).toBe(true)
        expect(isSelected(left, 8, 0)).toBe(false)
        expect(isSelected(left, 9, 0)).toBe(false)
    })

    it('reaches every matching cell when it is not asked to stay contiguous', () => {
        const { sprite, layer, frame } = doc()
        for (let y = 0; y < 16; y++) writePixel(sprite, layer, frame, 8, y, BLUE)

        const both = wandMask(sprite, layer, frame, 0, 0, { tolerance: 0, contiguous: false })
        expect(isSelected(both, 9, 0)).toBe(true)
    })

    it('widens with tolerance, exactly as the bucket does', () => {
        const { sprite, layer, frame } = doc()
        writePixel(sprite, layer, frame, 0, 0, RED)
        writePixel(sprite, layer, frame, 1, 0, rgba(250, 4, 4))

        expect(isSelected(wandMask(sprite, layer, frame, 0, 0, tol(0)), 1, 0)).toBe(false)
        expect(isSelected(wandMask(sprite, layer, frame, 0, 0, tol(8)), 1, 0)).toBe(true)
    })

    it('selects the whole empty cel when there is nothing painted yet', () => {
        const { sprite, layer, frame } = doc()

        expect(count(wandMask(sprite, layer, frame, 0, 0, tol(0)))).toBe(256)
    })

    it('refuses a tolerance the bucket would refuse', () => {
        const { sprite, layer, frame } = doc()
        for (const tolerance of [-1, 256, 1.5]) {
            expect(() =>
                wandMask(sprite, layer, frame, 0, 0, { tolerance, contiguous: true }),
            ).toThrow(RangeError)
        }
    })
})

describe('mask combination', () => {
    const base = () => rectMask(16, 16, 0, 0, 7, 7)
    const overlap = () => rectMask(16, 16, 4, 4, 11, 11)

    it('replace keeps only what arrived', () => {
        const combined = combineMasks(base(), overlap(), 'replace')
        expect(combined.bounds).toEqual({ x: 4, y: 4, w: 8, h: 8 })
    })

    it('add unions the two and grows the bounds', () => {
        const combined = combineMasks(base(), overlap(), 'add')

        expect(isSelected(combined, 0, 0)).toBe(true)
        expect(isSelected(combined, 11, 11)).toBe(true)
        expect(combined.bounds).toEqual({ x: 0, y: 0, w: 12, h: 12 })
    })

    it('subtract cuts the overlap out and tightens the bounds', () => {
        const combined = combineMasks(base(), overlap(), 'subtract')

        expect(isSelected(combined, 0, 0)).toBe(true)
        expect(isSelected(combined, 5, 5)).toBe(false)
        expect(combined.bounds).toEqual({ x: 0, y: 0, w: 8, h: 8 })
    })

    it('intersect keeps only the overlap', () => {
        const combined = combineMasks(base(), overlap(), 'intersect')

        expect(combined.bounds).toEqual({ x: 4, y: 4, w: 4, h: 4 })
        expect(count(combined)).toBe(16)
    })

    it('reports no bounds when a combination selects nothing', () => {
        const apart = combineMasks(base(), rectMask(16, 16, 10, 10, 12, 12), 'intersect')

        expect(isEmptyMask(apart)).toBe(true)
        expect(apart.bounds).toBeNull()
    })

    it('refuses to combine masks that belong to different documents', () => {
        expect(() => combineMasks(emptyMask(16, 16), emptyMask(32, 32), 'add')).toThrow(
            /different documents/,
        )
    })

    it('inverts, and inverting twice is the identity', () => {
        const mask = base()
        const flipped = invertMask(mask)

        expect(isSelected(flipped, 0, 0)).toBe(false)
        expect(isSelected(flipped, 15, 15)).toBe(true)
        expect(count(flipped)).toBe(256 - 64)
        expect(invertMask(flipped).cells).toEqual(mask.cells)
    })

    it('inverting nothing selects everything, and back', () => {
        expect(count(invertMask(emptyMask(16, 16)))).toBe(256)
        expect(isEmptyMask(invertMask(allMask(16, 16)))).toBe(true)
    })
})

describe('mask translation', () => {
    it('slides the selection and its bounds with it', () => {
        const moved = translateMask(rectMask(16, 16, 1, 1, 3, 3), 4, 2)

        expect(moved.bounds).toEqual({ x: 5, y: 3, w: 3, h: 3 })
        expect(isSelected(moved, 5, 3)).toBe(true)
        expect(isSelected(moved, 1, 1)).toBe(false)
    })

    it('drops whatever slides off the document', () => {
        const moved = translateMask(rectMask(16, 16, 0, 0, 3, 3), -2, 0)

        expect(moved.bounds).toEqual({ x: 0, y: 0, w: 2, h: 4 })
    })

    it('returns the same mask when nothing moves', () => {
        const mask = rectMask(16, 16, 1, 1, 3, 3)
        expect(translateMask(mask, 0, 0)).toBe(mask)
    })
})

describe('mask outline', () => {
    it('traces the perimeter of a block and nothing inside it', () => {
        const edges = maskOutline(rectMask(16, 16, 2, 2, 3, 3))

        expect(edges).toHaveLength(8)
        expect(edges.every((edge) => edge.x1 >= 2 && edge.x1 <= 4)).toBe(true)
    })

    it('grows with the perimeter, not with the area', () => {
        const small = maskOutline(rectMask(16, 16, 0, 0, 3, 3))
        const large = maskOutline(rectMask(16, 16, 0, 0, 7, 7))

        expect(small).toHaveLength(16)
        expect(large).toHaveLength(32)
    })

    it('traces both borders of a selection with a hole in it', () => {
        const ring = combineMasks(
            rectMask(16, 16, 0, 0, 5, 5),
            rectMask(16, 16, 2, 2, 3, 3),
            'subtract',
        )

        expect(maskOutline(ring)).toHaveLength(24 + 8)
    })

    it('has nothing to trace when nothing is selected', () => {
        expect(maskOutline(emptyMask(16, 16))).toHaveLength(0)
    })
})

function tol(tolerance: number) {
    return { tolerance, contiguous: true }
}
