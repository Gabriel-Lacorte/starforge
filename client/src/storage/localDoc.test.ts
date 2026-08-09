import { describe, expect, it } from 'vitest'
import {
    createLayer,
    createSprite,
    getPixel,
    insertLayer,
    rgba,
    writePixel,
    type Sprite,
} from '@starforge/core'
import { clearDocument, loadDocument, saveDocument, type StorageLike } from './localDoc'

const RED = rgba(255, 0, 0)

class FakeStorage implements StorageLike {
    readonly items = new Map<string, string>()
    failOnSet = false

    getItem(key: string): string | null {
        return this.items.get(key) ?? null
    }

    setItem(key: string, value: string): void {
        if (this.failOnSet) throw new Error('QuotaExceededError')
        this.items.set(key, value)
    }

    removeItem(key: string): void {
        this.items.delete(key)
    }
}

function drawing(): Sprite {
    const sprite = createSprite({ width: 16, height: 16, title: 'saved' })
    insertLayer(sprite, createLayer('Top'), sprite.layers[0]!.id)
    writePixel(sprite, sprite.layers[0]!.id, sprite.frames[0]!.id, 4, 5, RED)
    return sprite
}

describe('localDoc', () => {
    it('returns nothing when nothing was ever saved', () => {
        expect(loadDocument(new FakeStorage())).toBeNull()
    })

    it('returns nothing when storage is unavailable', () => {
        expect(loadDocument(null)).toBeNull()
        expect(saveDocument({ sprite: drawing(), activeLayer: 'x' }, null)).toBe(false)
    })

    it('round-trips a document through storage', () => {
        const storage = new FakeStorage()
        const sprite = drawing()
        const activeLayer = sprite.layers[1]!.id

        expect(saveDocument({ sprite, activeLayer }, storage)).toBe(true)

        const loaded = loadDocument(storage)
        expect(loaded?.activeLayer).toBe(activeLayer)
        expect(loaded?.sprite.meta.title).toBe('saved')
        expect(loaded?.sprite.layers.map((l) => l.name)).toEqual(['Layer 1', 'Top'])
        expect(
            getPixel(
                loaded!.sprite,
                loaded!.sprite.layers[0]!.id,
                loaded!.sprite.frames[0]!.id,
                4,
                5,
            ),
        ).toBe(RED)
    })

    it('falls back to the top layer when the saved active layer is gone', () => {
        const storage = new FakeStorage()
        saveDocument({ sprite: drawing(), activeLayer: 'deleted-layer' }, storage)

        const loaded = loadDocument(storage)
        expect(loaded?.activeLayer).toBe(loaded?.sprite.layers[1]!.id)
    })

    it('reports failure instead of throwing when the quota is exceeded', () => {
        const storage = new FakeStorage()
        storage.failOnSet = true

        expect(saveDocument({ sprite: drawing(), activeLayer: 'x' }, storage)).toBe(false)
    })

    it('drops a snapshot it cannot read, so the next save starts clean', () => {
        const storage = new FakeStorage()
        saveDocument({ sprite: drawing(), activeLayer: 'x' }, storage)
        storage.items.set('starforge.document', '{"sprite":{"v":99}}')

        expect(loadDocument(storage)).toBeNull()
        expect(storage.items.size).toBe(0)
    })

    it('survives storage holding something that is not JSON', () => {
        const storage = new FakeStorage()
        storage.items.set('starforge.document', 'half a doc')

        expect(loadDocument(storage)).toBeNull()
    })

    it('clears the saved document', () => {
        const storage = new FakeStorage()
        saveDocument({ sprite: drawing(), activeLayer: 'x' }, storage)
        clearDocument(storage)

        expect(loadDocument(storage)).toBeNull()
    })
})
