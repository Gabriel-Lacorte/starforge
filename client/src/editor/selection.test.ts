import { describe, expect, it } from 'vitest'
import {
    TRANSPARENT,
    createSprite,
    getPixel,
    openCursor,
    rgba,
    writePixel,
    type CellWrite,
    type Sprite,
} from '@starforge/core'
import { liftRegion, normalizeSelection, stampRegion, type SelRect } from './selection'

const RED = rgba(255, 0, 0)
const BLUE = rgba(0, 0, 255)

function sprite16(): { sprite: Sprite; layer: string; frame: string } {
    const sprite = createSprite({ width: 16, height: 16 })
    return { sprite, layer: sprite.layers[0]!.id, frame: sprite.frames[0]!.id }
}

function collect(sprite: Sprite, layer: string, frame: string) {
    const writes: CellWrite[] = []
    const cursor = openCursor(sprite, layer, frame, (w) => writes.push(w))
    return { cursor, writes }
}

describe('normalizeSelection', () => {
    it('orders the two corners and includes both, from any drag direction', () => {
        const forward = normalizeSelection(2, 3, 5, 7, 16, 16)
        expect(forward).toEqual({ x: 2, y: 3, w: 4, h: 5 })
        expect(normalizeSelection(5, 7, 2, 3, 16, 16)).toEqual(forward)
        expect(normalizeSelection(5, 3, 2, 7, 16, 16)).toEqual(forward)
    })

    it('clamps to the sprite bounds', () => {
        expect(normalizeSelection(-4, -2, 5, 6, 16, 16)).toEqual({ x: 0, y: 0, w: 6, h: 7 })
        expect(normalizeSelection(10, 10, 40, 40, 16, 16)).toEqual({ x: 10, y: 10, w: 6, h: 6 })
    })

    it('returns null when the rect is entirely outside the sprite', () => {
        expect(normalizeSelection(-5, -5, -1, -1, 16, 16)).toBeNull()
        expect(normalizeSelection(16, 0, 20, 10, 16, 16)).toBeNull()
    })
})

describe('liftRegion', () => {
    it('captures the region into a buffer and clears the source to transparent', () => {
        const { sprite, layer, frame } = sprite16()
        writePixel(sprite, layer, frame, 3, 3, RED)
        writePixel(sprite, layer, frame, 4, 3, BLUE)
        const rect: SelRect = { x: 3, y: 3, w: 2, h: 1 }

        const { cursor, writes } = collect(sprite, layer, frame)
        const buffer = liftRegion(cursor, rect)

        expect([...buffer]).toEqual([RED, BLUE])
        expect(getPixel(sprite, layer, frame, 3, 3)).toBe(TRANSPARENT)
        expect(getPixel(sprite, layer, frame, 4, 3)).toBe(TRANSPARENT)

        expect(writes).toHaveLength(2)
    })
})

describe('stampRegion', () => {
    it('writes non-transparent buffer cells at the offset, source-over', () => {
        const { sprite, layer, frame } = sprite16()

        const buffer = new Uint32Array([RED, TRANSPARENT])
        const rect: SelRect = { x: 3, y: 3, w: 2, h: 1 }

        writePixel(sprite, layer, frame, 9, 3, BLUE)

        const { cursor } = collect(sprite, layer, frame)
        stampRegion(cursor, buffer, rect, 5, 0)

        expect(getPixel(sprite, layer, frame, 8, 3)).toBe(RED)
        expect(getPixel(sprite, layer, frame, 9, 3)).toBe(BLUE)
    })

    it('drops buffer cells whose offset lands outside the sprite', () => {
        const { sprite, layer, frame } = sprite16()
        const buffer = new Uint32Array([RED, RED])
        const rect: SelRect = { x: 14, y: 0, w: 2, h: 1 }
        const { cursor } = collect(sprite, layer, frame)
        stampRegion(cursor, buffer, rect, 1, 0)
        expect(getPixel(sprite, layer, frame, 15, 0)).toBe(RED)
    })
})
