import { describe, expect, it } from 'vitest'
import { TRANSPARENT, rgba } from './color'
import { createSprite, getCel, type Sprite } from './doc'
import { openCursor } from './cursor'
import { getPixel, type CellWrite } from './ops'

const RED = rgba(255, 0, 0)
const BLUE = rgba(0, 0, 255)

function sprite16(): { sprite: Sprite; layer: string; frame: string } {
    const sprite = createSprite({ width: 16, height: 16 })
    return { sprite, layer: sprite.layers[0]!.id, frame: sprite.frames[0]!.id }
}

describe('openCursor', () => {
    it('exposes the sprite dimensions', () => {
        const { sprite, layer, frame } = sprite16()
        const cursor = openCursor(sprite, layer, frame)
        expect(cursor.width).toBe(16)
        expect(cursor.height).toBe(16)
    })

    it('throws once, up front, on an unknown layer or frame', () => {
        const { sprite, layer, frame } = sprite16()
        expect(() => openCursor(sprite, 'nope', frame)).toThrow(/unknown layer/)
        expect(() => openCursor(sprite, layer, 'nope')).toThrow(/unknown frame/)
    })

    it('reads TRANSPARENT before any cel exists and outside the sprite', () => {
        const { sprite, layer, frame } = sprite16()
        const cursor = openCursor(sprite, layer, frame)
        expect(cursor.get(5, 5)).toBe(TRANSPARENT)
        expect(cursor.get(-1, 0)).toBe(TRANSPARENT)
        expect(cursor.get(16, 0)).toBe(TRANSPARENT)
    })

    it('creates the cel lazily on the first effective write, then reads it back', () => {
        const { sprite, layer, frame } = sprite16()
        const cursor = openCursor(sprite, layer, frame)
        expect(getCel(sprite, layer, frame)).toBeUndefined()
        cursor.set(3, 7, RED)
        expect(getCel(sprite, layer, frame)).toBeDefined()
        expect(cursor.get(3, 7)).toBe(RED)
        expect(getPixel(sprite, layer, frame, 3, 7)).toBe(RED)
    })

    it('emits one CellWrite per effective set, with before/after and the bumped version', () => {
        const { sprite, layer, frame } = sprite16()
        const writes: CellWrite[] = []
        const cursor = openCursor(sprite, layer, frame, (w) => writes.push(w))
        cursor.set(1, 1, RED)
        cursor.set(1, 1, BLUE)
        expect(writes).toEqual([
            { layer, frame, x: 1, y: 1, before: TRANSPARENT, after: RED },
            { layer, frame, x: 1, y: 1, before: RED, after: BLUE },
        ])
        expect(getCel(sprite, layer, frame)!.version).toBe(2)
    })

    it('suppresses out-of-bounds and no-change sets, no cel, no emission', () => {
        const { sprite, layer, frame } = sprite16()
        const writes: CellWrite[] = []
        const cursor = openCursor(sprite, layer, frame, (w) => writes.push(w))
        for (const [x, y] of [
            [-1, 0],
            [0, -1],
            [16, 0],
            [0, 16],
            [1.5, 0],
        ] as const) {
            cursor.set(x, y, RED)
        }
        cursor.set(2, 2, TRANSPARENT)
        expect(writes).toEqual([])
        expect(getCel(sprite, layer, frame)).toBeUndefined()
    })
})
