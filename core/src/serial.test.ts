import { describe, expect, it } from 'vitest'
import { createLayer, createSprite, getCel, type Sprite } from './doc'
import { insertLayer, setLayerProp } from './layers'
import { rgba } from './color'
import { writePixel } from './ops'
import { SNAPSHOT_VERSION, decodeSprite, encodeSprite, type SpriteSnapshot } from './serial'

const RED = rgba(255, 0, 0)
const BLUE = rgba(0, 0, 255)
const HALF = rgba(20, 40, 60, 128)

function painted(): Sprite {
    const sprite = createSprite({ width: 16, height: 16, title: 'painted' })
    const frame = sprite.frames[0]!.id
    const base = sprite.layers[0]!.id

    const top = createLayer('Top')
    insertLayer(sprite, top, base)
    setLayerProp(sprite, top.id, 'opacity', 128)
    setLayerProp(sprite, top.id, 'blendMode', 'multiply')
    setLayerProp(sprite, top.id, 'visible', false)
    setLayerProp(sprite, top.id, 'locked', true)

    for (let x = 0; x < 16; x++) writePixel(sprite, base, frame, x, 3, RED)
    writePixel(sprite, base, frame, 0, 0, BLUE)
    writePixel(sprite, top.id, frame, 8, 8, HALF)

    return sprite
}

function roundtrip(sprite: Sprite): Sprite {
    return decodeSprite(JSON.parse(JSON.stringify(encodeSprite(sprite))))
}

function corrupt(mutate: (snapshot: SpriteSnapshot) => void): () => Sprite {
    const snapshot = encodeSprite(painted())
    mutate(snapshot)
    return () => decodeSprite(JSON.parse(JSON.stringify(snapshot)))
}

describe('encodeSprite / decodeSprite', () => {
    it('restores identity, size, palette and meta', () => {
        const before = painted()
        const after = roundtrip(before)

        expect(after.id).toBe(before.id)
        expect(after.width).toBe(before.width)
        expect(after.height).toBe(before.height)
        expect(after.palette).toEqual(before.palette)
        expect(after.meta).toEqual(before.meta)
    })

    it('restores layer order and every layer property', () => {
        const before = painted()
        const after = roundtrip(before)

        expect(after.layers.map((l) => l.id)).toEqual(before.layers.map((l) => l.id))
        expect(after.layers.map((l) => l.name)).toEqual(before.layers.map((l) => l.name))

        const top = after.layers[1]!
        expect(top.opacity).toBe(128)
        expect(top.blendMode).toBe('multiply')
        expect(top.visible).toBe(false)
        expect(top.locked).toBe(true)
    })

    it('restores every pixel of every cel', () => {
        const before = painted()
        const after = roundtrip(before)
        const frame = before.frames[0]!.id

        for (const layer of before.layers) {
            const source = getCel(before, layer.id, frame)
            const copy = getCel(after, layer.id, frame)
            expect(copy?.pixels).toEqual(source?.pixels)
        }
    })

    it('keeps the cel grid sparse, a layer never drawn on stays empty', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        insertLayer(sprite, createLayer('Empty'), sprite.layers[0]!.id)

        const after = roundtrip(sprite)
        expect(after.layers[1]!.cels.size).toBe(0)
    })

    it('survives a cel where every pixel differs from its neighbour', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        const layer = sprite.layers[0]!.id
        const frame = sprite.frames[0]!.id

        let seed = 1
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                seed = (seed * 1103515245 + 12345) & 0x7fffffff
                writePixel(sprite, layer, frame, x, y, (seed | 0xff) >>> 0)
            }
        }

        const after = roundtrip(sprite)
        expect(getCel(after, layer, frame)!.pixels).toEqual(getCel(sprite, layer, frame)!.pixels)
    })

    it('run-length encodes flat areas instead of storing raw bytes', () => {
        const sprite = createSprite({ width: 64, height: 64 })
        const layer = sprite.layers[0]!.id
        const frame = sprite.frames[0]!.id
        for (let y = 0; y < 64; y++) {
            for (let x = 0; x < 64; x++) writePixel(sprite, layer, frame, x, y, RED)
        }

        const encoded = encodeSprite(sprite).layers[0]!.cels[0]!.pixels
        expect(encoded.length).toBeLessThan(64)
        expect(getCel(roundtrip(sprite), layer, frame)!.pixels).toEqual(
            getCel(sprite, layer, frame)!.pixels,
        )
    })

    it('decodes a cel back to the full sprite size even when only one pixel was set', () => {
        const sprite = createSprite({ width: 32, height: 24 })
        writePixel(sprite, sprite.layers[0]!.id, sprite.frames[0]!.id, 31, 23, BLUE)

        const cel = getCel(roundtrip(sprite), sprite.layers[0]!.id, sprite.frames[0]!.id)
        expect(cel!.pixels.length).toBe(32 * 24 * 4)
    })
})

describe('decodeSprite rejects', () => {
    it('a snapshot from another version', () => {
        expect(corrupt((s) => (s.v = SNAPSHOT_VERSION + 1))).toThrow(/unsupported version/)
    })

    it('anything that is not an object', () => {
        expect(() => decodeSprite(null)).toThrow(/not an object/)
        expect(() => decodeSprite('[]')).toThrow(/not an object/)
    })

    it('a size outside the sprite limits', () => {
        expect(corrupt((s) => (s.width = 4))).toThrow(/width/)
        expect(corrupt((s) => (s.height = 4096))).toThrow(/height/)
    })

    it('a document with no layers or no frames', () => {
        expect(corrupt((s) => (s.layers = []))).toThrow(/no layers/)
        expect(corrupt((s) => (s.frames = []))).toThrow(/no frames/)
    })

    it('duplicate layer ids', () => {
        expect(
            corrupt((s) => {
                s.layers[1]!.id = s.layers[0]!.id
            }),
        ).toThrow(/duplicate layer id/)
    })

    it('an unknown blend mode', () => {
        expect(corrupt((s) => (s.layers[0]!.blendMode = 'glow'))).toThrow(/blend mode/)
    })

    it('an opacity that is not a byte', () => {
        expect(corrupt((s) => (s.layers[0]!.opacity = 300))).toThrow(/layer opacity/)
    })

    it('a cel pinned to a frame that does not exist', () => {
        expect(corrupt((s) => (s.layers[0]!.cels[0]!.frame = 'ghost'))).toThrow(/unknown frame/)
    })

    it('pixel data that does not fill the cel', () => {
        expect(corrupt((s) => (s.layers[0]!.cels[0]!.pixels = 'AQIDBAU='))).toThrow(/wrong size/)
    })

    it('pixel data that overflows the cel', () => {
        expect(corrupt((s) => (s.layers[0]!.cels[0]!.pixels = '6Af/AAD/'))).toThrow(
            /overflows the cel/,
        )
    })

    it('base64 that is not base64', () => {
        expect(corrupt((s) => (s.layers[0]!.cels[0]!.pixels = 'not base64!!'))).toThrow(
            /base64 character/,
        )
    })
})
