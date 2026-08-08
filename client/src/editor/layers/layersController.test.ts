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
import { DocumentSession, type Change } from '../../document/session'
import { LayersController } from './layersController'
import { EditorStore } from '../store'

const RED = rgba(255, 0, 0)

function setup(): {
    sprite: Sprite
    frame: string
    base: string
    mid: string
    top: string
    store: EditorStore
    session: DocumentSession
    layers: LayersController
    changes: Change[]
} {
    const sprite = createSprite({ width: 16, height: 16 })
    sprite.layers[0]!.name = 'base'

    const base = sprite.layers[0]!.id
    insertLayer(sprite, createLayer('mid'), base)
    const mid = sprite.layers[1]!.id
    insertLayer(sprite, createLayer('top'), mid)
    const top = sprite.layers[2]!.id

    const frame = sprite.frames[0]!.id
    const store = new EditorStore(mid)
    const session = new DocumentSession(sprite)
    const layers = new LayersController(sprite, session, store)

    const changes: Change[] = []
    session.subscribe((c) => changes.push(c))

    return { sprite, frame, base, mid, top, store, session, layers, changes }
}

const names = (sprite: Sprite) => sprite.layers.map((l) => l.name)

describe('LayersController: structure', () => {
    it('add inserts directly above the active layer, and the new one becomes active', () => {
        const { sprite, store, session, layers } = setup()
        layers.add()
        expect(names(sprite)).toEqual(['base', 'mid', 'Layer 1', 'top'])
        expect(store.state.activeLayer).toBe(sprite.layers[2]!.id)

        session.undo()
        expect(names(sprite)).toEqual(['base', 'mid', 'top'])
    })

    it('never reuses a "Layer N" name, even after deleting one', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        const store = new EditorStore(sprite.layers[0]!.id)
        const layers = new LayersController(sprite, new DocumentSession(sprite), store)

        layers.add()
        layers.add()
        expect(names(sprite)).toEqual(['Layer 1', 'Layer 2', 'Layer 3'])

        layers.remove(sprite.layers[2]!.id)
        layers.add()
        expect(names(sprite)).toEqual(['Layer 1', 'Layer 2', 'Layer 3'])
        expect(new Set(names(sprite)).size).toBe(sprite.layers.length)
    })

    it('remove + undo restores the same layer object (and cel) at the same index', () => {
        const { sprite, frame, mid, session, layers } = setup()
        writePixel(sprite, mid, frame, 2, 2, RED)
        const layerObj = sprite.layers[1]!
        const celObj = layerObj.cels.get(frame)!

        layers.remove(mid)
        expect(names(sprite)).toEqual(['base', 'top'])

        session.undo()
        expect(names(sprite)).toEqual(['base', 'mid', 'top'])
        expect(sprite.layers[1]).toBe(layerObj)
        expect(sprite.layers[1]!.cels.get(frame)).toBe(celObj)
        expect(getPixel(sprite, mid, frame, 2, 2)).toBe(RED)
    })

    it('refuses to remove the last layer', () => {
        const { sprite, session, layers } = setup()
        layers.remove(sprite.layers[2]!.id)
        layers.remove(sprite.layers[1]!.id)
        layers.remove(sprite.layers[0]!.id)
        expect(sprite.layers).toHaveLength(1)
        expect(session.canUndo).toBe(true)
    })

    it('duplicate copies above the source, becomes active, and undo removes the copy', () => {
        const { sprite, frame, mid, store, session, layers } = setup()
        writePixel(sprite, mid, frame, 1, 1, RED)
        layers.duplicate(mid)
        expect(names(sprite)).toEqual(['base', 'mid', 'mid copy', 'top'])
        const copy = sprite.layers[2]!
        expect(store.state.activeLayer).toBe(copy.id)
        expect(getPixel(sprite, copy.id, frame, 1, 1)).toBe(RED)
        writePixel(sprite, copy.id, frame, 3, 3, RED)
        expect(getPixel(sprite, mid, frame, 3, 3)).toBe(0)

        session.undo()
        expect(names(sprite)).toEqual(['base', 'mid', 'top'])
    })

    it('moveUp/moveDown step one position and undo restores the order', () => {
        const { sprite, mid, session, layers } = setup()
        layers.moveUp(mid)
        expect(names(sprite)).toEqual(['base', 'top', 'mid'])
        layers.moveDown(mid)
        expect(names(sprite)).toEqual(['base', 'mid', 'top'])
        layers.moveDown(mid)
        expect(names(sprite)).toEqual(['mid', 'base', 'top'])

        session.undo()
        session.undo()
        session.undo()
        expect(names(sprite)).toEqual(['base', 'mid', 'top'])
        layers.moveUp(sprite.layers[2]!.id)
        layers.moveDown(sprite.layers[0]!.id)
        expect(session.canUndo).toBe(false)
    })
})

describe('LayersController — props', () => {
    it('setProp + undo restores the previous value; two setProps are two undo steps', () => {
        const { sprite, mid, session, layers } = setup()
        layers.setBlendMode(mid, 'multiply')
        layers.setBlendMode(mid, 'screen')
        expect(sprite.layers[1]!.blendMode).toBe('screen')

        session.undo()
        expect(sprite.layers[1]!.blendMode).toBe('multiply')
        session.undo()
        expect(sprite.layers[1]!.blendMode).toBe('normal')
    })

    it('opacity previews mutate live without history; commit records ONE step to drag start', () => {
        const { sprite, mid, session, layers, changes } = setup()
        layers.previewOpacity(mid, 200)
        layers.previewOpacity(mid, 120)
        expect(sprite.layers[1]!.opacity).toBe(120)
        expect(session.canUndo).toBe(false)
        expect(changes.filter((c) => c.kind === 'structure')).toHaveLength(2)

        layers.commitOpacity(mid, 255, 120)
        expect(session.canUndo).toBe(true)
        session.undo()
        expect(sprite.layers[1]!.opacity).toBe(255)
        session.redo()
        expect(sprite.layers[1]!.opacity).toBe(120)
    })

    it('rename trims and records; empty or unchanged names are dropped', () => {
        const { sprite, mid, session, layers } = setup()
        layers.rename(mid, '  Inks  ')
        expect(sprite.layers[1]!.name).toBe('Inks')
        layers.rename(mid, '   ')
        layers.rename(mid, 'Inks')
        session.undo()
        expect(sprite.layers[1]!.name).toBe('mid')
        expect(session.canUndo).toBe(false)
    })
})

describe('LayersController: active layer', () => {
    it('removing the active layer moves active to the one above (same slot)', () => {
        const { mid, top, store, layers } = setup()
        expect(store.state.activeLayer).toBe(mid)
        layers.remove(mid)
        expect(store.state.activeLayer).toBe(top)
    })

    it('removing the active TOP layer falls to the new top', () => {
        const { sprite, top, store, layers } = setup()
        layers.setActive(top)
        layers.remove(top)
        expect(store.state.activeLayer).toBe(sprite.layers[1]!.id)
    })

    it('an undo that revokes the active layer also reconciles it', () => {
        const { sprite, store, session, layers } = setup()
        layers.add()
        const added = store.state.activeLayer
        session.undo()
        expect(sprite.layers.some((l) => l.id === added)).toBe(false)
        expect(sprite.layers.some((l) => l.id === store.state.activeLayer)).toBe(true)
    })

    it('runs the beforeStructural guard for the ops that can strand a float', () => {
        const { mid, layers } = setup()
        let guards = 0
        layers.setBeforeStructural(() => guards++)
        layers.add()
        layers.duplicate(mid)
        layers.toggleLocked(mid)
        layers.setActive(mid)
        layers.toggleVisible(mid)
        layers.rename(mid, 'x')
        expect(guards).toBe(4)
    })

    it('emits structure changes carrying the removed index', () => {
        const { mid, layers, changes } = setup()
        layers.remove(mid)
        expect(changes).toEqual([{ kind: 'structure', removedLayerIndex: 1 }])
    })
})
