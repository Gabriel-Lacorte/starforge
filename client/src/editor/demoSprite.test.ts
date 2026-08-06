import { describe, expect, it } from 'vitest'
import { createDemoSprite } from './demoSprite'

describe('createDemoSprite', () => {
    it('creates a sprite with the expected dimensions', () => {
        const sprite = createDemoSprite()

        expect(sprite.width).toBe(64)
        expect(sprite.height).toBe(64)
        expect(sprite.layers).toHaveLength(1)
        expect(sprite.frames).toHaveLength(1)
    })
})
