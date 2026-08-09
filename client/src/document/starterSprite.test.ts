import { describe, expect, it } from 'vitest'
import { getPixel } from '@starforge/core'
import { createStarterSprite } from './starterSprite'

describe('createStarterSprite', () => {
    it('is a 64x64 single-frame document', () => {
        const { sprite } = createStarterSprite()
        expect(sprite.width).toBe(64)
        expect(sprite.height).toBe(64)
        expect(sprite.frames).toHaveLength(1)
    })

    it('ships the layer stack the panel is meant to show off', () => {
        const { sprite } = createStarterSprite()
        expect(sprite.layers.map((l) => [l.name, l.blendMode])).toEqual([
            ['Glow', 'normal'],
            ['Star', 'normal'],
            ['Shading', 'multiply'],
            ['Face', 'normal'],
            ['Sparkles', 'additive'],
        ])
    })

    it('never puts a blend mode where it cannot do anything', () => {
        const { sprite } = createStarterSprite()
        expect(sprite.layers[0]!.blendMode).toBe('normal')
    })

    it('draws something on every layer, no empty rows in the panel', () => {
        const { sprite } = createStarterSprite()
        const frame = sprite.frames[0]!.id
        for (const layer of sprite.layers) {
            expect({ layer: layer.name, painted: layer.cels.has(frame) }).toEqual({
                layer: layer.name,
                painted: true,
            })
        }
    })

    it('opens on a normal layer, so the first stroke is not blended', () => {
        const { sprite, activeLayer } = createStarterSprite()
        const active = sprite.layers.find((l) => l.id === activeLayer)
        expect(active?.name).toBe('Star')
        expect(active?.blendMode).toBe('normal')
        expect(active?.locked).toBe(false)
    })

    it('puts the star body at the centre and leaves the corners clear', () => {
        const { sprite, activeLayer } = createStarterSprite()
        const frame = sprite.frames[0]!.id
        expect(getPixel(sprite, activeLayer, frame, 32, 33)).not.toBe(0)
        expect(getPixel(sprite, activeLayer, frame, 0, 0)).toBe(0)
    })

    it('only uses colours the palette can reproduce', () => {
        const { sprite } = createStarterSprite()
        const frame = sprite.frames[0]!.id
        const palette = new Set(sprite.palette.colors.map((c) => c.toLowerCase()))

        const used = new Set<string>()
        for (const layer of sprite.layers) {
            const cel = layer.cels.get(frame)
            if (!cel) continue
            for (let i = 0; i < cel.pixels.length; i += 4) {
                if (cel.pixels[i + 3] === 0) continue
                const hex = [cel.pixels[i]!, cel.pixels[i + 1]!, cel.pixels[i + 2]!]
                    .map((c) => c.toString(16).padStart(2, '0'))
                    .join('')
                used.add(`#${hex}`)
            }
        }

        expect([...used].filter((c) => !palette.has(c))).toEqual([])
    })
})
