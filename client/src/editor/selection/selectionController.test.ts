import { describe, expect, it } from 'vitest'
import { createSprite, getPixel, rgba, writePixel, type Sprite } from '@starforge/core'
import { DocumentSession } from '../../document/session'
import { SelectionController } from './selectionController'

const RED = rgba(255, 0, 0)
const GREEN = rgba(0, 255, 0)

function setup(): {
    sprite: Sprite
    layer: string
    frame: string
    session: DocumentSession
    sel: SelectionController
    changes: () => number
} {
    const sprite = createSprite({ width: 16, height: 16 })
    const layer = sprite.layers[0]!.id
    const frame = sprite.frames[0]!.id
    const session = new DocumentSession(sprite)
    let changes = 0
    const sel = new SelectionController({
        sprite,
        target: () => ({ layer, frame }),
        session,
        onChange: () => changes++,
    })
    return { sprite, layer, frame, session, sel, changes: () => changes }
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
        expect(sel.mask?.bounds).toEqual({ x: 2, y: 4, w: 4, h: 5 })
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
        expect(sel.active).toBe(true)
        expect(sel.contains(6, 4)).toBe(true)
        expect(sel.contains(3, 3)).toBe(false)
        expect(sel.floating).toBe(false)

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

describe('SelectionController: boolean modes', () => {
    it('adds a second marquee to the first', () => {
        const { sel } = setup()
        sel.beginMarquee(1, 1)
        sel.endMarquee(3, 3)
        sel.beginMarquee(6, 6, 'add')
        sel.endMarquee(8, 8)

        expect(sel.contains(2, 2)).toBe(true)
        expect(sel.contains(7, 7)).toBe(true)
        expect(sel.mask?.bounds).toEqual({ x: 1, y: 1, w: 8, h: 8 })
    })

    it('subtracts a bite out of the first', () => {
        const { sel } = setup()
        sel.beginMarquee(1, 1)
        sel.endMarquee(6, 6)
        sel.beginMarquee(4, 4, 'subtract')
        sel.endMarquee(8, 8)

        expect(sel.contains(2, 2)).toBe(true)
        expect(sel.contains(5, 5)).toBe(false)
    })

    it('intersects down to the overlap', () => {
        const { sel } = setup()
        sel.beginMarquee(1, 1)
        sel.endMarquee(6, 6)
        sel.beginMarquee(4, 4, 'intersect')
        sel.endMarquee(8, 8)

        expect(sel.mask?.bounds).toEqual({ x: 4, y: 4, w: 3, h: 3 })
    })

    it('keeps the drag reversible: dragging back undoes what it added', () => {
        const { sel } = setup()
        sel.beginMarquee(1, 1)
        sel.endMarquee(3, 3)

        sel.beginMarquee(6, 6, 'add')
        sel.updateMarquee(8, 8)
        sel.updateMarquee(6, 6)

        expect(sel.contains(7, 7)).toBe(false)
        expect(sel.mask?.bounds).toEqual({ x: 1, y: 1, w: 6, h: 6 })
    })

    it('select all, invert and deselect walk the whole document', () => {
        const { sel } = setup()

        sel.selectAll()
        expect(sel.contains(0, 0)).toBe(true)
        expect(sel.contains(15, 15)).toBe(true)

        sel.beginMarquee(0, 0)
        sel.endMarquee(3, 3)
        sel.invert()
        expect(sel.contains(0, 0)).toBe(false)
        expect(sel.contains(15, 15)).toBe(true)

        sel.deselect()
        expect(sel.active).toBe(false)
    })

    it('moves only the selected pixels, not the box around them', () => {
        const { sprite, layer, frame, sel } = setup()
        writePixel(sprite, layer, frame, 2, 2, RED)
        writePixel(sprite, layer, frame, 4, 2, RED)

        sel.beginMarquee(2, 2)
        sel.endMarquee(2, 2)
        sel.beginMove(2, 2)
        sel.moveTo(4, 4)
        sel.commit()

        expect(getPixel(sprite, layer, frame, 2, 2)).toBe(0)
        expect(getPixel(sprite, layer, frame, 4, 4)).toBe(RED)
        expect(getPixel(sprite, layer, frame, 4, 2)).toBe(RED)
    })
})

describe('SelectionController: marquee shapes', () => {
    it('an ellipse marquee selects the ellipse, not its box', () => {
        const { sel } = setup()
        sel.beginMarquee(2, 2, 'replace', 'ellipse')
        sel.endMarquee(11, 11)

        expect(sel.contains(6, 6)).toBe(true)
        expect(sel.contains(2, 2)).toBe(false)
        expect(sel.mask?.bounds).toEqual({ x: 2, y: 2, w: 10, h: 10 })
    })

    it('a lasso follows the traced path and closes it', () => {
        const { sel } = setup()
        sel.beginMarquee(2, 2, 'replace', 'lasso')
        sel.updateMarquee(12, 2)
        sel.updateMarquee(12, 12)
        sel.endMarquee(2, 12)

        expect(sel.contains(7, 7)).toBe(true)
        expect(sel.contains(14, 14)).toBe(false)
    })

    it('the wand selects the region the bucket would fill, and combines like any other shape', () => {
        const { sprite, layer, frame, sel } = setup()
        for (let y = 0; y < 16; y++) writePixel(sprite, layer, frame, 8, y, GREEN)

        sel.wandAt(0, 0, 'replace', { tolerance: 0, contiguous: true })
        expect(sel.contains(7, 0)).toBe(true)
        expect(sel.contains(9, 0)).toBe(false)

        sel.wandAt(9, 0, 'add', { tolerance: 0, contiguous: true })
        expect(sel.contains(7, 0)).toBe(true)
        expect(sel.contains(9, 0)).toBe(true)
        expect(sel.contains(8, 0)).toBe(false)
    })

    it('survives a lasso with far more points than it keeps', () => {
        const { sel } = setup()
        sel.beginMarquee(1, 1, 'replace', 'lasso')
        for (let step = 0; step < 1500; step++) {
            sel.updateMarquee(1 + (step % 13), 1 + ((step * 5) % 13))
        }

        expect(() => sel.endMarquee(1, 1)).not.toThrow()
        const bounds = sel.mask?.bounds
        if (bounds) {
            expect(bounds.x).toBeGreaterThanOrEqual(0)
            expect(bounds.x + bounds.w).toBeLessThanOrEqual(16)
        }
    })
})
