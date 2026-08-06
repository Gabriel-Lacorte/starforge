import { describe, expect, it } from 'vitest'
import { TRANSPARENT, rgba } from './color'
import { createSprite, getCel, type Sprite } from './doc'
import { applyWrite, getPixel, invertWrite, writePixel } from './ops'

const RED = rgba(255, 0, 0)
const BLUE = rgba(0, 0, 255)

function sprite16(): { sprite: Sprite; layer: string; frame: string } {
    const sprite = createSprite({ width: 16, height: 16 })
    return { sprite, layer: sprite.layers[0]!.id, frame: sprite.frames[0]!.id }
}

describe('getPixel', () => {
    it('is TRANSPARENT where no cel exists and outside the sprite', () => {
        const { sprite, layer, frame } = sprite16()
        expect(getPixel(sprite, layer, frame, 5, 5)).toBe(TRANSPARENT)
        expect(getPixel(sprite, layer, frame, -1, 0)).toBe(TRANSPARENT)
        expect(getPixel(sprite, layer, frame, 16, 0)).toBe(TRANSPARENT)
    })
})

describe('writePixel', () => {
    it('round trips through getPixel', () => {
        const { sprite, layer, frame } = sprite16()
        const write = writePixel(sprite, layer, frame, 3, 7, RED)
        expect(write).toEqual({ layer, frame, x: 3, y: 7, before: TRANSPARENT, after: RED })
        expect(getPixel(sprite, layer, frame, 3, 7)).toBe(RED)
    })

    it('creates the cel sparsely, on the first effective write only', () => {
        const { sprite, layer, frame } = sprite16()
        expect(getCel(sprite, layer, frame)).toBeUndefined()
        writePixel(sprite, layer, frame, 0, 0, RED)
        expect(getCel(sprite, layer, frame)).toBeDefined()
    })

    it('rejects out-of-bounds writes without touching the sprite', () => {
        const { sprite, layer, frame } = sprite16()
        for (const [x, y] of [
            [-1, 0],
            [0, -1],
            [16, 0],
            [0, 16],
            [1.5, 0],
        ] as const) {
            expect(writePixel(sprite, layer, frame, x, y, RED)).toBeNull()
        }
        expect(getCel(sprite, layer, frame)).toBeUndefined()
    })

    it('treats no-change writes as no-ops (no cel, no record)', () => {
        const { sprite, layer, frame } = sprite16()
        expect(writePixel(sprite, layer, frame, 2, 2, TRANSPARENT)).toBeNull()
        expect(getCel(sprite, layer, frame)).toBeUndefined()
        writePixel(sprite, layer, frame, 2, 2, RED)
        expect(writePixel(sprite, layer, frame, 2, 2, RED)).toBeNull()
    })

    it('captures before across successive writes and bumps the cel version', () => {
        const { sprite, layer, frame } = sprite16()
        writePixel(sprite, layer, frame, 1, 1, RED)
        const second = writePixel(sprite, layer, frame, 1, 1, BLUE)
        expect(second).toMatchObject({ before: RED, after: BLUE })
        expect(getCel(sprite, layer, frame)?.version).toBe(2)
    })

    it('throws on unknown layer or frame', () => {
        const { sprite, layer, frame } = sprite16()
        expect(() => writePixel(sprite, 'nope', frame, 0, 0, RED)).toThrow(/unknown layer/)
        expect(() => writePixel(sprite, layer, 'nope', 0, 0, RED)).toThrow(/unknown frame/)
    })
})

describe('invertWrite / applyWrite', () => {
    it('undoes and redoes a write', () => {
        const { sprite, layer, frame } = sprite16()
        writePixel(sprite, layer, frame, 4, 4, RED)
        const write = writePixel(sprite, layer, frame, 4, 4, BLUE)!

        applyWrite(sprite, invertWrite(write))
        expect(getPixel(sprite, layer, frame, 4, 4)).toBe(RED)

        applyWrite(sprite, write)
        expect(getPixel(sprite, layer, frame, 4, 4)).toBe(BLUE)
    })

    it('is idempotent', () => {
        const { sprite, layer, frame } = sprite16()
        const write = writePixel(sprite, layer, frame, 5, 5, RED)!
        applyWrite(sprite, write)
        applyWrite(sprite, write)
        expect(getPixel(sprite, layer, frame, 5, 5)).toBe(RED)
    })
})
