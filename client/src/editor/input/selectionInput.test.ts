import { createSprite } from '@starforge/core'
import { describe, expect, it } from 'vitest'
import { DocumentSession } from '../../document/session'
import { SelectionController } from '../selection/selectionController'
import { EditorStore } from '../store'
import { SelectionInput } from './selectionInput'

function setup() {
    const sprite = createSprite({ width: 16, height: 16 })
    const layer = sprite.layers[0]!.id
    const frame = sprite.frames[0]!.id
    const session = new DocumentSession(sprite)
    const selection = new SelectionController({
        sprite,
        target: () => ({ layer, frame }),
        session,
        onChange: () => undefined,
    })
    const store = new EditorStore()
    const canvas = { setPointerCapture: () => undefined } as unknown as HTMLCanvasElement
    const input = new SelectionInput({
        canvas,
        viewport: {} as never,
        selection,
        store,
    })

    const pointer = (overrides: Partial<PointerEvent> = {}) =>
        ({ pointerId: 1, shiftKey: false, altKey: false, ...overrides }) as PointerEvent

    return { input, selection, store, pointer }
}

describe('SelectionInput modes', () => {
    it('uses the stored mode when a touch pointer has no keyboard modifiers', () => {
        const { input, selection, store, pointer } = setup()
        selection.beginMarquee(0, 0)
        selection.endMarquee(0, 0)
        store.patch({ selectionMode: 'add' })

        input.pointerDown(pointer(), { x: 3, y: 3 })
        input.pointerUp(pointer(), { x: 3, y: 3 })

        expect(selection.contains(0, 0)).toBe(true)
        expect(selection.contains(3, 3)).toBe(true)
        input.dispose()
    })

    it('lets Option temporarily override the stored mode with subtract', () => {
        const { input, selection, store, pointer } = setup()
        selection.beginMarquee(0, 0)
        selection.endMarquee(2, 2)
        store.patch({ selectionMode: 'add' })

        const option = pointer({ altKey: true })
        input.pointerDown(option, { x: 1, y: 1 })
        input.pointerUp(option, { x: 1, y: 1 })

        expect(selection.contains(0, 0)).toBe(true)
        expect(selection.contains(1, 1)).toBe(false)
        input.dispose()
    })

    it('clears the active selection on Delete and ignores it when empty', () => {
        const { input, selection } = setup()
        const del = (overrides: Partial<KeyboardEvent> = {}) =>
            ({
                key: 'Delete',
                ctrlKey: false,
                metaKey: false,
                altKey: false,
                shiftKey: false,
                preventDefault: () => undefined,
                ...overrides,
            }) as KeyboardEvent
        expect(input.keyDown(del())).toBe(false)

        selection.beginMarquee(0, 0)
        selection.endMarquee(2, 2)
        expect(selection.active).toBe(true)
        expect(input.keyDown(del())).toBe(true)
        expect(selection.active).toBe(false)
        input.dispose()
    })
})
