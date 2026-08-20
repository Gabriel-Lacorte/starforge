import { describe, expect, it } from 'vitest'
import { rgba } from './color'
import { createFrame, createLayer, createSprite, type Sprite } from './doc'
import { documentFingerprint } from './hash'
import { insertLayer, setLayerProp } from './layers'
import { writePixel } from './ops'
import { decodeSprite, encodeSprite } from './serial'

const RED = rgba(255, 0, 0)

function doc(id = 'fingerprint'): Sprite {
    const sprite = createSprite({ width: 16, height: 16, id })
    sprite.meta.createdAt = sprite.meta.updatedAt = '2026-08-12T00:00:00.000Z'
    sprite.layers[0] = createLayer('Layer 1', 'layer')
    sprite.frames[0] = createFrame(undefined, 'frame')

    return sprite
}

describe('documentFingerprint', () => {
    it('is stable for the same content and 16 hex digits wide', () => {
        const fingerprint = documentFingerprint(doc())

        expect(fingerprint).toMatch(/^[0-9a-f]{16}$/)
        expect(documentFingerprint(doc())).toBe(fingerprint)
    })

    it('survives a snapshot roundtrip', () => {
        const sprite = doc()
        const layer = sprite.layers[0]!.id
        writePixel(sprite, layer, sprite.frames[0]!.id, 3, 4, RED)
        insertLayer(sprite, createLayer('Ink'), layer)

        expect(documentFingerprint(decodeSprite(encodeSprite(sprite)))).toBe(
            documentFingerprint(sprite),
        )
    })

    it('ignores mutation counters and cels that erased back to nothing', () => {
        const sprite = doc()
        const layer = sprite.layers[0]!.id
        const frame = sprite.frames[0]!.id
        const untouched = documentFingerprint(sprite)

        writePixel(sprite, layer, frame, 5, 5, RED)
        expect(documentFingerprint(sprite)).not.toBe(untouched)

        writePixel(sprite, layer, frame, 5, 5, 0)
        sprite.revision += 7
        expect(documentFingerprint(sprite)).toBe(untouched)
    })

    it('separates documents that differ only in pixels, order or layer properties', () => {
        const base = doc()
        const layer = base.layers[0]!.id
        const frame = base.frames[0]!.id
        writePixel(base, layer, frame, 1, 1, RED)
        const reference = documentFingerprint(base)

        const moved = doc()
        writePixel(moved, moved.layers[0]!.id, moved.frames[0]!.id, 1, 2, RED)
        expect(documentFingerprint(moved)).not.toBe(reference)

        const hidden = doc()
        writePixel(hidden, hidden.layers[0]!.id, hidden.frames[0]!.id, 1, 1, RED)
        setLayerProp(hidden, hidden.layers[0]!.id, 'visible', false)
        expect(documentFingerprint(hidden)).not.toBe(reference)

        const stacked = doc()
        writePixel(stacked, stacked.layers[0]!.id, stacked.frames[0]!.id, 1, 1, RED)
        insertLayer(stacked, createLayer('Ink'), null)
        expect(documentFingerprint(stacked)).not.toBe(reference)
    })

    it('does not confuse a value moving between adjacent fields', () => {
        const left = doc('ab')
        left.meta.title = 'c'
        const right = doc('a')
        right.meta.title = 'bc'

        expect(documentFingerprint(left)).not.toBe(documentFingerprint(right))
    })
})
