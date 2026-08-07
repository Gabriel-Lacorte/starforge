import { describe, expect, it } from 'vitest'
import { createSprite, getPixel, rgba, writePixel, type Sprite } from '@starforge/core'
import { DocumentSession } from '../document/session'
import { SelectionController } from './selectionController'

const RED = rgba(255, 0, 0)
const GREEN = rgba(0, 255, 0)

function setup(): {
    sprite: Sprite
    layer: string
    frame: string
    session: DocumentSession
    sel: SelectionController
    changes: number
} {
    const sprite = createSprite({ width: 16, height: 16 })
    const layer = sprite.layers[0]!.id
    const frame = sprite.frames[0]!.id
    const session = new DocumentSession(sprite)
    let changes = 0
    const sel = new SelectionController({
        sprite,
        layer,
        frame,
        session,
        onChange: () => changes++,
    })
    return { sprite, layer, frame, session, sel, changes }
}

function snapshot(sprite: Sprite, layer: string, frame: string): number[] {
    const cel = sprite.layers.find((l) => l.id === layer)!.cels.get(frame)
    return cel ? [...cel.pixels] : []
}

describe('SelectionController', () => {
    it('creates a normalized marquee from a drag', () => {
        const { sel } = setup()
        sel.beginMarquee(5, 4)
        sel.updateMarquee(2, 8)
        sel.endMarquee(2, 8)
        expect(sel.active).toBe(true)
        expect(sel.rect).toEqual({ x: 2, y: 4, w: 4, h: 5 })
        expect(sel.floating).toBe(false)
    })

    it('reports whether a point is inside the current selection', () => {
        const { sel } = setup()
        sel.beginMarquee(3, 3)
        sel.endMarquee(6, 6)
        expect(sel.contains(4, 4)).toBe(true)
        expect(sel.contains(6, 6)).toBe(true)
        expect(sel.contains(7, 6)).toBe(false)
        expect(sel.contains(2, 2)).toBe(false)
    })

    it('moving lifts the region (source clears) and commit stamps it, as one undo step', () => {
        const { sprite, layer, frame, session, sel } = setup()
        writePixel(sprite, layer, frame, 3, 3, RED)
        writePixel(sprite, layer, frame, 4, 3, GREEN)
        const base = snapshot(sprite, layer, frame)

        sel.beginMarquee(3, 3)
        sel.endMarquee(4, 3)

        sel.beginMove(3, 3)
        sel.moveTo(5, 4)

        expect(sel.floating).toBe(true)
        expect(getPixel(sprite, layer, frame, 3, 3)).toBe(0)

        sel.commit()
        expect(getPixel(sprite, layer, frame, 5, 4)).toBe(RED)
        expect(getPixel(sprite, layer, frame, 6, 4)).toBe(GREEN)
        expect(getPixel(sprite, layer, frame, 3, 3)).toBe(0)
        expect(sel.active).toBe(false)

        session.undo()
        expect(snapshot(sprite, layer, frame)).toEqual(base)
        session.redo()
        expect(getPixel(sprite, layer, frame, 5, 4)).toBe(RED)
    })

    it('nudging by arrow keys lifts once and accumulates the offset', () => {
        const { sprite, layer, frame, sel } = setup()
        writePixel(sprite, layer, frame, 2, 2, RED)
        sel.beginMarquee(2, 2)
        sel.endMarquee(2, 2)
        sel.nudge(1, 0)
        sel.nudge(1, 0)
        sel.nudge(0, 1)
        expect(sel.floating).toBe(true)
        sel.commit()
        expect(getPixel(sprite, layer, frame, 4, 3)).toBe(RED)
        expect(getPixel(sprite, layer, frame, 2, 2)).toBe(0)
    })

    it('cancel after a lift restores the source and records no undo step', () => {
        const { sprite, layer, frame, session, sel } = setup()
        writePixel(sprite, layer, frame, 3, 3, RED)
        const base = snapshot(sprite, layer, frame)
        sel.beginMarquee(3, 3)
        sel.endMarquee(3, 3)
        sel.beginMove(3, 3)
        sel.moveTo(7, 7)
        expect(getPixel(sprite, layer, frame, 3, 3)).toBe(0)

        sel.cancel()
        expect(snapshot(sprite, layer, frame)).toEqual(base)
        expect(sel.active).toBe(false)
        expect(session.canUndo).toBe(false)
    })

    it('committing without ever moving is a no-op (no undo step)', () => {
        const { sprite, layer, frame, session, sel } = setup()
        writePixel(sprite, layer, frame, 3, 3, RED)
        sel.beginMarquee(3, 3)
        sel.endMarquee(5, 5)
        sel.commit()
        expect(session.canUndo).toBe(false)
        expect(getPixel(sprite, layer, frame, 3, 3)).toBe(RED)
    })

    it('a marquee that lands entirely off-canvas leaves no selection', () => {
        const { sel } = setup()
        sel.beginMarquee(-8, -8)
        sel.endMarquee(-2, -2)
        expect(sel.active).toBe(false)
    })
})
