import { describe, expect, it } from 'vitest'
import {
    createLayer,
    createSprite,
    getPixel,
    insertLayer,
    rectMask,
    rgba,
    setLayerProp,
    type SelectionMask,
    type Sprite,
} from '@starforge/core'
import { DocumentSession } from '../document/session'
import { GestureController } from './gesture'
import { LayersController } from './layers/layersController'
import { EditorStore } from './store'

const NO_MODS = { shift: false, alt: false, ctrl: false }

function setup(
    width = 16,
    height = width,
    selection: SelectionMask | null = null,
): {
    sprite: Sprite
    frame: string
    base: string
    top: string
    store: EditorStore
    session: DocumentSession
    gestures: GestureController
} {
    const sprite = createSprite({ width, height })

    const base = sprite.layers[0]!.id
    insertLayer(sprite, createLayer('top'), base)
    const top = sprite.layers[1]!.id

    const frame = sprite.frames[0]!.id
    const store = new EditorStore()
    const session = new DocumentSession(sprite, { target: { layer: top, frame } })

    const gestures = new GestureController({
        sprite,
        target: () => session.target.state,
        selection: () => selection,
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
        session.setTarget({ layer: base })
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
        const { sprite, frame, base, store, session, gestures } = setup()
        session.setTarget({ layer: base })
        store.patch({ color: rgba(255, 0, 0) })
        gestures.begin('pencil', 2, 2, NO_MODS)
        gestures.finish(2, 2, NO_MODS)
        expect(getPixel(sprite, base, frame, 2, 2)).toBe(rgba(255, 0, 0))
    })
})

describe('GestureController vs the layers panel', () => {
    it('picking a layer in the panel moves where the next stroke lands', () => {
        const { sprite, frame, base, top, store, session, gestures } = setup()
        const layers = new LayersController(sprite, session)

        layers.setActive(base)
        expect(layers.active).toBe(base)

        gestures.begin('pencil', 6, 6, NO_MODS)
        gestures.finish(6, 6, NO_MODS)

        expect(getPixel(sprite, base, frame, 6, 6)).toBe(store.state.color)
        expect(getPixel(sprite, top, frame, 6, 6)).toBe(0)
    })
})

describe('GestureController vs the selection', () => {
    it('keeps the bucket inside the selection', () => {
        const mask = rectMask(16, 16, 4, 4, 7, 7)
        const { sprite, frame, top, store, gestures } = setup(16, 16, mask)
        const color = store.state.color

        gestures.begin('bucket', 5, 5, NO_MODS)
        gestures.finish(5, 5, NO_MODS)

        for (let y = 4; y <= 7; y++) {
            for (let x = 4; x <= 7; x++) {
                expect(getPixel(sprite, top, frame, x, y), `inside (${x},${y})`).toBe(color)
            }
        }
        for (const [x, y] of [
            [3, 5],
            [8, 5],
            [5, 3],
            [5, 8],
            [0, 0],
            [15, 15],
        ] as const) {
            expect(getPixel(sprite, top, frame, x, y), `outside (${x},${y})`).toBe(0)
        }
    })

    it('refuses a bucket started outside the selection', () => {
        const mask = rectMask(16, 16, 4, 4, 7, 7)
        const { sprite, frame, top, session, gestures } = setup(16, 16, mask)

        gestures.begin('bucket', 12, 12, NO_MODS)
        gestures.finish(12, 12, NO_MODS)

        expect(getPixel(sprite, top, frame, 12, 12)).toBe(0)
        expect(getPixel(sprite, top, frame, 5, 5)).toBe(0)
        expect(session.canUndo).toBe(false)
    })

    it('undoes a fenced bucket as one entry', () => {
        const mask = rectMask(16, 16, 4, 4, 7, 7)
        const { sprite, frame, top, session, gestures } = setup(16, 16, mask)

        gestures.begin('bucket', 5, 5, NO_MODS)
        gestures.finish(5, 5, NO_MODS)
        expect(session.canUndo).toBe(true)

        session.undo()
        expect(getPixel(sprite, top, frame, 5, 5)).toBe(0)
        expect(session.canUndo).toBe(false)
    })
})

describe('GestureController symmetry', () => {
    it('horizontal symmetry mirrors a point across the vertical axis', () => {
        const { sprite, frame, top, store, session, gestures } = setup(16, 16)
        store.patch({ symmetryH: true })
        const color = store.state.color

        gestures.begin('pencil', 3, 5, NO_MODS)
        gestures.finish(3, 5, NO_MODS)

        expect(getPixel(sprite, top, frame, 3, 5)).toBe(color)
        expect(getPixel(sprite, top, frame, 12, 5)).toBe(color)
        expect(getPixel(sprite, top, frame, 13, 5)).toBe(0)

        expect(session.canUndo).toBe(true)
        session.undo()
        expect(getPixel(sprite, top, frame, 3, 5)).toBe(0)
        expect(getPixel(sprite, top, frame, 12, 5)).toBe(0)
        expect(session.canUndo).toBe(false)
    })

    it('vertical symmetry mirrors across the horizontal axis', () => {
        const { sprite, frame, top, store, gestures } = setup(16, 16)
        store.patch({ symmetryV: true })
        const color = store.state.color

        gestures.begin('pencil', 5, 3, NO_MODS)
        gestures.finish(5, 3, NO_MODS)

        expect(getPixel(sprite, top, frame, 5, 3)).toBe(color)
        expect(getPixel(sprite, top, frame, 5, 12)).toBe(color)
        expect(getPixel(sprite, top, frame, 5, 13)).toBe(0)
    })

    it('both axes on paint all four reflections of one point', () => {
        const { sprite, frame, top, store, gestures } = setup(16, 16)
        store.patch({ symmetryH: true, symmetryV: true })
        const color = store.state.color

        gestures.begin('pencil', 3, 5, NO_MODS)
        gestures.finish(3, 5, NO_MODS)

        for (const [x, y] of [
            [3, 5],
            [12, 5],
            [3, 10],
            [12, 10],
        ] as const) {
            expect(getPixel(sprite, top, frame, x, y), `(${x},${y})`).toBe(color)
        }
    })

    it('shares the center column on an odd canvas, mirrors onto itself, once', () => {
        const size = 17
        const { sprite, frame, top, store, gestures } = setup(size, size)
        store.patch({ symmetryH: true })
        const color = store.state.color
        const center = (size - 1) / 2

        gestures.begin('pencil', center, 0, NO_MODS)
        for (let y = 1; y < size; y++) gestures.move(center, y, NO_MODS)
        gestures.finish(center, size - 1, NO_MODS)

        for (let y = 0; y < size; y++) {
            expect(getPixel(sprite, top, frame, center, y)).toBe(color)
            expect(getPixel(sprite, top, frame, center - 1, y)).toBe(0)
            expect(getPixel(sprite, top, frame, center + 1, y)).toBe(0)
        }
        expect(sprite.layers[1]!.cels.get(frame)!.version).toBe(size)
    })

    it('leaves shapes literal, symmetry is a free-stroke tool only (D10)', () => {
        const { sprite, frame, top, store, gestures } = setup(16, 16)
        store.patch({ symmetryH: true })
        const color = store.state.color

        gestures.begin('rect', 2, 2, NO_MODS)
        gestures.finish(5, 5, NO_MODS)

        expect(getPixel(sprite, top, frame, 2, 2)).toBe(color)
        expect(getPixel(sprite, top, frame, 13, 2)).toBe(0)
    })
})
