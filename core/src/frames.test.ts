import { describe, expect, it } from 'vitest'
import { rgba } from './color'
import { createFrame, createLayer, createSprite, type Sprite } from './doc'
import { copyFrameCels, insertFrame, moveFrame, removeFrame, setFrameDuration } from './frames'
import { insertLayer } from './layers'
import { getPixel, writePixel } from './ops'

const RED = rgba(255, 0, 0)
const BLUE = rgba(0, 0, 255)
const GREEN = rgba(0, 255, 0)

function reel(): { sprite: Sprite; layer: string; ids: [string, string, string] } {
    const sprite = createSprite({ width: 16, height: 16 })
    const layer = sprite.layers[0]!.id
    const first = sprite.frames[0]!.id

    insertFrame(sprite, createFrame(100, 'second'), first)
    insertFrame(sprite, createFrame(100, 'third'), 'second')

    writePixel(sprite, layer, first, 0, 0, RED)
    writePixel(sprite, layer, 'second', 1, 1, BLUE)
    writePixel(sprite, layer, 'third', 2, 2, GREEN)

    return { sprite, layer, ids: [first, 'second', 'third'] }
}

const order = (sprite: Sprite) => sprite.frames.map((frame) => frame.id)

describe('frames follow their id, never their position', () => {
    it('keeps every frame with its own art after a reorder', () => {
        const { sprite, layer, ids } = reel()
        const [first, second, third] = ids

        moveFrame(sprite, third, null)
        expect(order(sprite)).toEqual([third, first, second])

        expect(getPixel(sprite, layer, first, 0, 0)).toBe(RED)
        expect(getPixel(sprite, layer, second, 1, 1)).toBe(BLUE)
        expect(getPixel(sprite, layer, third, 2, 2)).toBe(GREEN)
    })

    it('does not touch a single cel when a frame moves', () => {
        const { sprite, layer, ids } = reel()
        const cels = sprite.layers.find((candidate) => candidate.id === layer)!.cels
        const before = new Map([...cels].map(([id, cel]) => [id, cel]))

        moveFrame(sprite, ids[0], ids[2])

        for (const [id, cel] of before) expect(cels.get(id)).toBe(cel)
    })

    it('removes only the cels of the frame that left', () => {
        const { sprite, layer, ids } = reel()
        const [first, second, third] = ids

        const removed = removeFrame(sprite, second)!
        expect(order(sprite)).toEqual([first, third])
        expect(removed.cels).toHaveLength(1)
        expect(getPixel(sprite, layer, first, 0, 0)).toBe(RED)
        expect(getPixel(sprite, layer, third, 2, 2)).toBe(GREEN)
    })

    it('puts a removed frame back where it was, with its art', () => {
        const { sprite, layer, ids } = reel()
        const removed = removeFrame(sprite, ids[1])!

        insertFrame(sprite, removed.frame, removed.after, removed.cels)

        expect(order(sprite)).toEqual(ids)
        expect(getPixel(sprite, layer, ids[1], 1, 1)).toBe(BLUE)
    })

    it('keeps the last frame, so a document always has one', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        expect(removeFrame(sprite, sprite.frames[0]!.id)).toBeNull()
        expect(sprite.frames).toHaveLength(1)
    })
})

describe('frame duration', () => {
    it('changes and reports what it replaced', () => {
        const { sprite, ids } = reel()

        expect(setFrameDuration(sprite, ids[0], 250)).toBe(100)
        expect(sprite.frames[0]!.duration).toBe(250)
        expect(setFrameDuration(sprite, ids[0], 250)).toBeNull()
    })

    it('refuses a duration outside what the document allows', () => {
        const { sprite, ids } = reel()
        for (const duration of [0, -5, 60_001, 1.5]) {
            expect(() => setFrameDuration(sprite, ids[0], duration)).toThrow(RangeError)
        }
        expect(sprite.frames[0]!.duration).toBe(100)
    })
})

describe('duplicating a frame', () => {
    it('copies the pixels, so painting on one does not paint on the other', () => {
        const { sprite, layer, ids } = reel()
        const copies = copyFrameCels(sprite, ids[0])

        insertFrame(sprite, createFrame(100, 'copy'), ids[0], copies)
        expect(getPixel(sprite, layer, 'copy', 0, 0)).toBe(RED)

        writePixel(sprite, layer, 'copy', 5, 5, BLUE)
        expect(getPixel(sprite, layer, ids[0], 5, 5)).toBe(0)
    })

    it('copies every layer that had art on that frame', () => {
        const { sprite, layer, ids } = reel()
        insertLayer(sprite, createLayer('ink', 'ink'), layer)
        writePixel(sprite, 'ink', ids[0], 7, 7, GREEN)

        insertFrame(sprite, createFrame(100, 'copy'), ids[0], copyFrameCels(sprite, ids[0]))

        expect(getPixel(sprite, layer, 'copy', 0, 0)).toBe(RED)
        expect(getPixel(sprite, 'ink', 'copy', 7, 7)).toBe(GREEN)
    })

    it('adds an empty frame when no cels are handed over', () => {
        const { sprite, layer, ids } = reel()
        insertFrame(sprite, createFrame(100, 'blank'), ids[0])

        expect(getPixel(sprite, layer, 'blank', 0, 0)).toBe(0)
        expect(sprite.layers[0]!.cels.has('blank')).toBe(false)
    })
})

describe('frame guards', () => {
    it('refuses a duplicate id, an unknown target and a move onto itself', () => {
        const { sprite, ids } = reel()

        expect(() => insertFrame(sprite, createFrame(100, ids[0]), null)).toThrow(/already present/)
        expect(() => moveFrame(sprite, ids[0], 'ghost')).toThrow(/unknown frame/)
        expect(() => moveFrame(sprite, ids[0], ids[0])).toThrow(/after itself/)
        expect(order(sprite)).toEqual(ids)
    })

    it('reports a move that would change nothing', () => {
        const { sprite, ids } = reel()

        expect(moveFrame(sprite, ids[1], ids[0])).toBeNull()
        expect(moveFrame(sprite, ids[0], null)).toBeNull()
    })
})
