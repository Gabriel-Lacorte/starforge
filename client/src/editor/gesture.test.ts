import { describe, expect, it } from 'vitest'
import {
    createLayer,
    createSprite,
    getPixel,
    insertLayer,
    rgba,
    setLayerProp,
    type Sprite,
} from '@starforge/core'
import { DocumentSession } from '../document/session'
import { GestureController } from './gesture'
import { EditorStore } from './store'

const NO_MODS = { shift: false, alt: false, ctrl: false }

function setup(): {
    sprite: Sprite
    frame: string
    base: string
    top: string
    store: EditorStore
    session: DocumentSession
    gestures: GestureController
} {
    const sprite = createSprite({ width: 16, height: 16 })

    const base = sprite.layers[0]!.id
    insertLayer(sprite, createLayer('top'), base)
    const top = sprite.layers[1]!.id

    const frame = sprite.frames[0]!.id
    const store = new EditorStore(top)
    const session = new DocumentSession(sprite)

    const gestures = new GestureController({
        sprite,
        target: () => ({ layer: store.state.activeLayer, frame }),
        session,
        renderer: {
            invalidate: () => {
                /* no compositor here */
            },
        },
        overlay: {
            setCells: () => {
                /* no overlay canvas in tests */
            },
            clear: () => {
                /* no overlay canvas in tests */
            },
        },
        store,
        requestRender: () => {
            /* no render loop in tests */
        },
    })

    return { sprite, frame, base, top, store, session, gestures }
}

describe('GestureController vs Active layer', () => {
    it('a locked active layer refuses the gesture, nothing starts, nothing is written', () => {
        const { sprite, frame, top, session, gestures } = setup()
        setLayerProp(sprite, top, 'locked', true)

        gestures.begin('pencil', 3, 3, NO_MODS)
        expect(gestures.active).toBe(false)
        gestures.move(5, 3, NO_MODS)
        gestures.finish(5, 3, NO_MODS)

        expect(sprite.layers[1]!.cels.size).toBe(0)
        expect(getPixel(sprite, top, frame, 3, 3)).toBe(0)
        expect(session.canUndo).toBe(false)
    })

    it('freezes the target at begin, switching the active layer mid-stroke never splits it', () => {
        const { sprite, frame, base, top, store, session, gestures } = setup()

        gestures.begin('pencil', 0, 0, NO_MODS)
        store.patch({ activeLayer: base })
        gestures.move(4, 0, NO_MODS)
        gestures.finish(4, 0, NO_MODS)

        for (let x = 0; x <= 4; x++) {
            expect(getPixel(sprite, top, frame, x, 0)).toBe(store.state.color)
            expect(getPixel(sprite, base, frame, x, 0)).toBe(0)
        }
        session.undo()
        expect(getPixel(sprite, top, frame, 0, 0)).toBe(0)
    })

    it('the NEXT gesture reads the switched active layer', () => {
        const { sprite, frame, base, store, gestures } = setup()
        store.patch({ activeLayer: base, color: rgba(255, 0, 0) })
        gestures.begin('pencil', 2, 2, NO_MODS)
        gestures.finish(2, 2, NO_MODS)
        expect(getPixel(sprite, base, frame, 2, 2)).toBe(rgba(255, 0, 0))
    })
})
