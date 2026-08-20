import { describe, expect, it } from 'vitest'
import { rgba } from './color'
import { createLayer, createSprite, type Sprite } from './doc'
import { insertLayer } from './layers'
import { getPixel, writePixel } from './ops'
import { resizeCanvas, restoreCels, scaleCanvas, snapshotCels } from './resize'
import { decodeSprite, encodeSprite } from './serial'

const RED = rgba(255, 0, 0)
const BLUE = rgba(0, 0, 255)

function doc(size = 32): { sprite: Sprite; layer: string; frame: string } {
    const sprite = createSprite({ width: size, height: size })
    return { sprite, layer: sprite.layers[0]!.id, frame: sprite.frames[0]!.id }
}

function celBytes(sprite: Sprite): number[] {
    return sprite.layers.flatMap((layer) =>
        [...layer.cels.values()].map((cel) => cel.pixels.length),
    )
}

describe('resizeCanvas', () => {
    it('rewrites every cel of every layer to the new size', () => {
        const { sprite, layer, frame } = doc()
        insertLayer(sprite, createLayer('ink'), layer)
        const ink = sprite.layers[1]!.id
        writePixel(sprite, layer, frame, 1, 1, RED)
        writePixel(sprite, ink, frame, 2, 2, BLUE)

        resizeCanvas(sprite, { width: 20, height: 24 }, 0, 0)

        expect([sprite.width, sprite.height]).toEqual([20, 24])
        expect(celBytes(sprite)).toEqual([20 * 24 * 4, 20 * 24 * 4])
        expect(getPixel(sprite, layer, frame, 1, 1)).toBe(RED)
        expect(getPixel(sprite, ink, frame, 2, 2)).toBe(BLUE)
    })

    it('keeps the art still while the canvas grows around it', () => {
        const { sprite, layer, frame } = doc(16)
        writePixel(sprite, layer, frame, 0, 0, RED)

        resizeCanvas(sprite, { width: 32, height: 32 }, 8, 8)

        expect(getPixel(sprite, layer, frame, 8, 8)).toBe(RED)
        expect(getPixel(sprite, layer, frame, 0, 0)).toBe(0)
    })

    it('crops with a negative offset, dropping what falls outside', () => {
        const { sprite, layer, frame } = doc()
        writePixel(sprite, layer, frame, 4, 4, RED)
        writePixel(sprite, layer, frame, 20, 20, BLUE)

        resizeCanvas(sprite, { width: 16, height: 16 }, -4, -4)

        expect(getPixel(sprite, layer, frame, 0, 0)).toBe(RED)
        expect([...(sprite.layers[0]!.cels.get(frame)?.pixels ?? [])].some((b) => b === 255)).toBe(
            true,
        )
        expect(getPixel(sprite, layer, frame, 15, 15)).toBe(0)
    })

    it('produces a document the codec still round-trips', () => {
        const { sprite, layer, frame } = doc()
        writePixel(sprite, layer, frame, 3, 3, RED)
        resizeCanvas(sprite, { width: 40, height: 17 }, 2, 1)

        const reopened = decodeSprite(encodeSprite(sprite))

        expect([reopened.width, reopened.height]).toEqual([40, 17])
        expect(getPixel(reopened, layer, frame, 5, 4)).toBe(RED)
    })

    it('refuses a size the document model does not allow, before touching anything', () => {
        const { sprite, layer, frame } = doc()
        writePixel(sprite, layer, frame, 1, 1, RED)

        for (const size of [
            { width: 8, height: 32 },
            { width: 32, height: 4096 },
        ]) {
            expect(() => resizeCanvas(sprite, size, 0, 0)).toThrow(RangeError)
        }
        expect([sprite.width, sprite.height]).toEqual([32, 32])
        expect(getPixel(sprite, layer, frame, 1, 1)).toBe(RED)
    })
})

describe('scaleCanvas', () => {
    it('doubles every pixel into a block, with no colour invented', () => {
        const { sprite, layer, frame } = doc(16)
        writePixel(sprite, layer, frame, 0, 0, RED)

        scaleCanvas(sprite, { width: 32, height: 32 })

        for (const [x, y] of [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
        ]) {
            expect(getPixel(sprite, layer, frame, x!, y!)).toBe(RED)
        }
        expect(getPixel(sprite, layer, frame, 2, 0)).toBe(0)
    })

    it('keeps alpha exactly, rather than blending neighbours', () => {
        const { sprite, layer, frame } = doc(16)
        const faint = rgba(9, 8, 7, 3)
        writePixel(sprite, layer, frame, 5, 5, faint)

        scaleCanvas(sprite, { width: 48, height: 48 })

        expect(getPixel(sprite, layer, frame, 15, 15)).toBe(faint)
    })

    it('shrinking drops pixels rather than averaging them', () => {
        const { sprite, layer, frame } = doc(32)
        for (let x = 0; x < 32; x++) writePixel(sprite, layer, frame, x, 0, x % 2 ? RED : BLUE)

        scaleCanvas(sprite, { width: 16, height: 16 })

        const seen = new Set<number>()
        for (let x = 0; x < 16; x++) seen.add(getPixel(sprite, layer, frame, x, 0))
        for (const colour of seen) expect([RED, BLUE, 0]).toContain(colour)
    })
})

describe('snapshot and restore', () => {
    it('puts back the exact document a size change destroyed', () => {
        const { sprite, layer, frame } = doc()
        insertLayer(sprite, createLayer('ink'), layer)
        writePixel(sprite, layer, frame, 20, 20, RED)
        writePixel(sprite, sprite.layers[1]!.id, frame, 30, 30, BLUE)

        const kept = { width: sprite.width, height: sprite.height, cels: snapshotCels(sprite) }
        resizeCanvas(sprite, { width: 16, height: 16 }, 0, 0)
        expect(getPixel(sprite, layer, frame, 20, 20)).toBe(0)

        restoreCels(sprite, kept, kept.cels)

        expect([sprite.width, sprite.height]).toEqual([32, 32])
        expect(getPixel(sprite, layer, frame, 20, 20)).toBe(RED)
        expect(getPixel(sprite, sprite.layers[1]!.id, frame, 30, 30)).toBe(BLUE)
    })

    it('holds copies, so editing on after the snapshot cannot rewrite the past', () => {
        const { sprite, layer, frame } = doc()
        writePixel(sprite, layer, frame, 2, 2, RED)
        const kept = snapshotCels(sprite)

        writePixel(sprite, layer, frame, 2, 2, BLUE)
        restoreCels(sprite, { width: 32, height: 32 }, kept)

        expect(getPixel(sprite, layer, frame, 2, 2)).toBe(RED)
    })

    it('leaves no cel behind at the wrong size', () => {
        const { sprite, layer, frame } = doc()
        writePixel(sprite, layer, frame, 2, 2, RED)
        const kept = snapshotCels(sprite)

        resizeCanvas(sprite, { width: 64, height: 64 }, 0, 0)
        restoreCels(sprite, { width: 32, height: 32 }, kept)

        expect(celBytes(sprite).every((bytes) => bytes === 32 * 32 * 4)).toBe(true)
    })

    it('refuses a snapshot that does not fit the size it claims', () => {
        const { sprite, layer, frame } = doc()
        writePixel(sprite, layer, frame, 2, 2, RED)
        const kept = snapshotCels(sprite)

        expect(() => restoreCels(sprite, { width: 16, height: 16 }, kept)).toThrow(RangeError)
        expect([sprite.width, sprite.height]).toEqual([32, 32])
    })
})
