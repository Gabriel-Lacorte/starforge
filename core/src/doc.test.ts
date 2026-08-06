import { describe, expect, it } from 'vitest'
import {
    DEFAULT_FRAME_DURATION,
    DEFAULT_PALETTE,
    SPRITE_MAX_SIZE,
    SPRITE_MIN_SIZE,
    createFrame,
    createLayer,
    createSprite,
    getCel,
    getFrame,
    getLayer,
} from './doc'

describe('createSprite', () => {
    it('starts with one layer, one frame and no cels', () => {
        const sprite = createSprite({ width: 32, height: 64, title: 'test' })
        expect(sprite.width).toBe(32)
        expect(sprite.height).toBe(64)
        expect(sprite.layers).toHaveLength(1)
        expect(sprite.frames).toHaveLength(1)
        expect(sprite.layers[0]?.cels.size).toBe(0)
        expect(sprite.frames[0]?.duration).toBe(DEFAULT_FRAME_DURATION)
        expect(sprite.meta.title).toBe('test')
    })

    it('clones the default palette per sprite', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        expect(sprite.palette.colors).toEqual(DEFAULT_PALETTE.colors)
        sprite.palette.colors[0] = '#123456'
        expect(DEFAULT_PALETTE.colors[0]).toBe('#0b0b12')
    })

    it('rejects sizes outside the supported range', () => {
        expect(() => createSprite({ width: SPRITE_MIN_SIZE - 1, height: 16 })).toThrow(RangeError)
        expect(() => createSprite({ width: 16, height: SPRITE_MAX_SIZE + 1 })).toThrow(RangeError)
        expect(() => createSprite({ width: 16.5, height: 16 })).toThrow(RangeError)
        expect(() =>
            createSprite({ width: SPRITE_MIN_SIZE, height: SPRITE_MAX_SIZE }),
        ).not.toThrow()
    })
})

describe('factories', () => {
    it('honor provided ids', () => {
        const sprite = createSprite({ width: 16, height: 16, id: 'sprite-1' })
        expect(sprite.id).toBe('sprite-1')
        expect(createLayer('bg', 'layer-1').id).toBe('layer-1')
        expect(createFrame(80, 'frame-1')).toEqual({ id: 'frame-1', duration: 80 })
    })

    it('default to unique generated ids', () => {
        expect(createLayer('a').id).not.toBe(createLayer('a').id)
    })
})

describe('lookups', () => {
    it('throw on unknown ids', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        expect(() => getLayer(sprite, 'nope')).toThrow(/unknown layer/)
        expect(() => getFrame(sprite, 'nope')).toThrow(/unknown frame/)
        expect(() => getCel(sprite, sprite.layers[0]!.id, 'nope')).toThrow(/unknown frame/)
    })
})
