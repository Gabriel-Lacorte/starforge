import { describe, expect, it } from 'vitest'
import { rgba } from './color'
import { createLayer, createSprite, type Sprite } from './doc'
import { openCursor } from './cursor'
import { getPixel, writePixel, type CellWrite } from './ops'
import {
    cloneLayer,
    insertLayer,
    moveLayer,
    removeLayer,
    restoreLayer,
    setLayerProp,
} from './layers'

const RED = rgba(255, 0, 0)

function spriteWith(...names: string[]): Sprite {
    const sprite = createSprite({ width: 16, height: 16 })
    sprite.layers[0]!.name = names[0]!
    for (const name of names.slice(1)) {
        insertLayer(sprite, createLayer(name), sprite.layers[sprite.layers.length - 1]!.id)
    }
    return sprite
}

const order = (sprite: Sprite) => sprite.layers.map((l) => l.name)
const byName = (sprite: Sprite, name: string) => sprite.layers.find((l) => l.name === name)!

describe('insertLayer', () => {
    it('inserts directly above `after`, and at the bottom for null', () => {
        const sprite = spriteWith('a', 'c')
        insertLayer(sprite, createLayer('b'), byName(sprite, 'a').id)
        insertLayer(sprite, createLayer('zero'), null)
        expect(order(sprite)).toEqual(['zero', 'a', 'b', 'c'])
    })

    it('bumps the revision once per insert and rejects a duplicate id', () => {
        const sprite = spriteWith('a')
        const before = sprite.revision
        const layer = createLayer('b')
        insertLayer(sprite, layer, byName(sprite, 'a').id)
        expect(sprite.revision).toBe(before + 1)
        expect(() => insertLayer(sprite, layer, null)).toThrow(/already present/)
    })
})

describe('removeLayer / restoreLayer', () => {
    it('detaches the same object with its index; restore puts it back exactly', () => {
        const sprite = spriteWith('a', 'b', 'c')
        const target = byName(sprite, 'b')
        const removed = removeLayer(sprite, target.id)!
        expect(removed.layer).toBe(target)
        expect(removed.index).toBe(1)
        expect(order(sprite)).toEqual(['a', 'c'])

        restoreLayer(sprite, removed.layer, removed.index)
        expect(order(sprite)).toEqual(['a', 'b', 'c'])
        expect(sprite.layers[1]).toBe(target)
    })

    it('refuses to remove the last layer, null, no revision bump', () => {
        const sprite = spriteWith('only')
        const before = sprite.revision
        expect(removeLayer(sprite, sprite.layers[0]!.id)).toBeNull()
        expect(sprite.revision).toBe(before)
        expect(sprite.layers).toHaveLength(1)
    })

    it('throws on an unknown id and on a restore that collides or falls outside', () => {
        const sprite = spriteWith('a', 'b')
        expect(() => removeLayer(sprite, 'ghost')).toThrow(/unknown layer/)
        expect(() => restoreLayer(sprite, sprite.layers[0]!, 0)).toThrow(/already present/)
        expect(() => restoreLayer(sprite, createLayer('x'), 5)).toThrow(/out of range/)
    })
})

describe('moveLayer', () => {
    it('moves to the top and back to the bottom, reporting the previous position', () => {
        const sprite = spriteWith('a', 'b', 'c')
        const a = byName(sprite, 'a')

        const up = moveLayer(sprite, a.id, byName(sprite, 'c').id)
        expect(order(sprite)).toEqual(['b', 'c', 'a'])
        expect(up).toEqual({ after: null })

        const back = moveLayer(sprite, a.id, null)
        expect(order(sprite)).toEqual(['a', 'b', 'c'])
        expect(back).toEqual({ after: byName(sprite, 'c').id })
    })

    it('returns the layer just below as the inverse `after`', () => {
        const sprite = spriteWith('a', 'b', 'c')
        const result = moveLayer(sprite, byName(sprite, 'c').id, null)
        expect(order(sprite)).toEqual(['c', 'a', 'b'])
        expect(result).toEqual({ after: byName(sprite, 'b').id })
    })

    it('is a no-op (null, no bump) when the move lands where it already is', () => {
        const sprite = spriteWith('a', 'b')
        const before = sprite.revision
        expect(moveLayer(sprite, byName(sprite, 'b').id, byName(sprite, 'a').id)).toBeNull()
        expect(moveLayer(sprite, byName(sprite, 'a').id, null)).toBeNull()
        expect(order(sprite)).toEqual(['a', 'b'])
        expect(sprite.revision).toBe(before)
    })

    it('rejects moving a layer above itself or above an unknown id', () => {
        const sprite = spriteWith('a', 'b')
        const a = byName(sprite, 'a')
        expect(() => moveLayer(sprite, a.id, a.id)).toThrow(/above itself/)
        expect(() => moveLayer(sprite, a.id, 'ghost')).toThrow(/unknown layer/)
    })
})

describe('setLayerProp', () => {
    it('sets the value and returns the previous one', () => {
        const sprite = spriteWith('a')
        const id = sprite.layers[0]!.id
        expect(setLayerProp(sprite, id, 'opacity', 128)).toBe(255)
        expect(setLayerProp(sprite, id, 'blendMode', 'multiply')).toBe('normal')
        expect(setLayerProp(sprite, id, 'name', 'renamed')).toBe('a')
        expect(setLayerProp(sprite, id, 'locked', true)).toBe(false)
        expect(setLayerProp(sprite, id, 'visible', false)).toBe(true)
        expect(sprite.layers[0]).toMatchObject({
            opacity: 128,
            blendMode: 'multiply',
            name: 'renamed',
            locked: true,
            visible: false,
        })
    })

    it('is a no-op (null, no bump) when the value is unchanged', () => {
        const sprite = spriteWith('a')
        const before = sprite.revision
        expect(setLayerProp(sprite, sprite.layers[0]!.id, 'opacity', 255)).toBeNull()
        expect(sprite.revision).toBe(before)
    })

    it('validates opacity as an integer in 0..255', () => {
        const sprite = spriteWith('a')
        const id = sprite.layers[0]!.id
        for (const bad of [-1, 256, 1.5, NaN]) {
            expect(() => setLayerProp(sprite, id, 'opacity', bad)).toThrow(RangeError)
        }
    })
})

describe('cloneLayer', () => {
    it('copies props and cels deeply, new buffers, versions restarted', () => {
        const sprite = spriteWith('a')
        const source = sprite.layers[0]!
        const frame = sprite.frames[0]!.id
        writePixel(sprite, source.id, frame, 3, 4, RED)
        source.opacity = 90
        source.blendMode = 'screen'
        source.locked = true

        const copy = cloneLayer(sprite, source.id)
        expect(copy.id).not.toBe(source.id)
        expect(copy).toMatchObject({
            name: 'a copy',
            opacity: 90,
            blendMode: 'screen',
            locked: true,
            visible: true,
        })
        const sourceCel = source.cels.get(frame)!
        const copyCel = copy.cels.get(frame)!
        expect(copyCel).not.toBe(sourceCel)
        expect(copyCel.pixels).not.toBe(sourceCel.pixels)
        expect([...copyCel.pixels]).toEqual([...sourceCel.pixels])
        expect(copyCel.version).toBe(0)

        writePixel(sprite, source.id, frame, 0, 0, RED)
        expect(copyCel.pixels[0]).toBe(0)
    })
})

describe('locked layers at the write door', () => {
    it('drops cursor writes on a locked layer, no cel, no emission; reads still work', () => {
        const sprite = spriteWith('a')
        const layer = sprite.layers[0]!
        const frame = sprite.frames[0]!.id
        writePixel(sprite, layer.id, frame, 1, 1, RED)
        layer.locked = true

        const emitted: CellWrite[] = []
        const cursor = openCursor(sprite, layer.id, frame, (w) => emitted.push(w))
        cursor.set(5, 5, RED)
        expect(emitted).toEqual([])
        expect(getPixel(sprite, layer.id, frame, 5, 5)).toBe(0)
        expect(cursor.get(1, 1)).toBe(RED)
        expect(writePixel(sprite, layer.id, frame, 6, 6, RED)).toBeNull()
    })

    it('honors a lock that lands while the cursor is already open', () => {
        const sprite = spriteWith('a')
        const layer = sprite.layers[0]!
        const cursor = openCursor(sprite, layer.id, sprite.frames[0]!.id)
        cursor.set(0, 0, RED)
        layer.locked = true
        cursor.set(1, 0, RED)
        expect(getPixel(sprite, layer.id, sprite.frames[0]!.id, 0, 0)).toBe(RED)
        expect(getPixel(sprite, layer.id, sprite.frames[0]!.id, 1, 0)).toBe(0)
    })
})

describe('revision', () => {
    it('moves only on structural ops, pixel writes never touch it', () => {
        const sprite = spriteWith('a', 'b')
        const before = sprite.revision
        writePixel(sprite, sprite.layers[0]!.id, sprite.frames[0]!.id, 0, 0, RED)
        expect(sprite.revision).toBe(before)
        setLayerProp(sprite, sprite.layers[0]!.id, 'opacity', 10)
        expect(sprite.revision).toBe(before + 1)
    })
})
