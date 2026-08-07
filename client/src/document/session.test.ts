import { describe, expect, it } from 'vitest'
import { Command, createSprite, getPixel, rgba, writePixel, type Sprite } from '@starforge/core'
import { DocumentSession, type Change } from './session'

const RED = rgba(255, 0, 0)
const BLUE = rgba(0, 0, 255)

function doc(): { session: DocumentSession; sprite: Sprite; layer: string; frame: string } {
    const sprite = createSprite({ width: 16, height: 16 })
    const session = new DocumentSession(sprite, 'author-a')
    return { session, sprite, layer: sprite.layers[0]!.id, frame: sprite.frames[0]!.id }
}

function paint(
    sprite: Sprite,
    layer: string,
    frame: string,
    cells: [number, number][],
    color: number,
): Command {
    const command = new Command('stroke')
    for (const [x, y] of cells) {
        const w = writePixel(sprite, layer, frame, x, y, color)
        if (w) command.record(w)
    }
    return command
}

describe('DocumentSession', () => {
    it('exposes the document and the session author', () => {
        const { session, sprite } = doc()
        expect(session.doc).toBe(sprite)
        expect(session.author).toBe('author-a')
    })

    it('mints an author when none is given', () => {
        const a = new DocumentSession(createSprite({ width: 16, height: 16 }))
        const b = new DocumentSession(createSprite({ width: 16, height: 16 }))
        expect(a.author).toMatch(/[0-9a-f-]{36}/)
        expect(a.author).not.toBe(b.author)
    })

    it('emits a pixels change with the gesture rect on commit', () => {
        const { session, sprite, layer, frame } = doc()
        const changes: Change[] = []
        session.subscribe((c) => changes.push(c))
        session.commit(
            paint(
                sprite,
                layer,
                frame,
                [
                    [2, 3],
                    [5, 9],
                ],
                RED,
            ),
        )
        expect(changes).toEqual([
            { kind: 'pixels', layer, frame, rect: { x: 2, y: 3, w: 4, h: 7 } },
        ])
    })

    it('does not emit or record an empty gesture', () => {
        const { session } = doc()
        const changes: Change[] = []
        session.subscribe((c) => changes.push(c))
        session.commit(new Command('nothing'))
        expect(changes).toEqual([])
        expect(session.canUndo).toBe(false)
    })

    it('undo reverts pixels and emits a change; redo replays them', () => {
        const { session, sprite, layer, frame } = doc()
        session.commit(paint(sprite, layer, frame, [[4, 4]], RED))
        const changes: Change[] = []
        session.subscribe((c) => changes.push(c))

        session.undo()
        expect(getPixel(sprite, layer, frame, 4, 4)).toBe(0)
        expect(session.canRedo).toBe(true)

        session.redo()
        expect(getPixel(sprite, layer, frame, 4, 4)).toBe(RED)
        expect(changes).toEqual([
            { kind: 'pixels', layer, frame, rect: { x: 4, y: 4, w: 1, h: 1 } },
            { kind: 'pixels', layer, frame, rect: { x: 4, y: 4, w: 1, h: 1 } },
        ])
    })

    it('undo and redo are inert (no change emitted) at the ends of history', () => {
        const { session } = doc()
        const changes: Change[] = []
        session.subscribe((c) => changes.push(c))
        session.undo()
        session.redo()
        expect(changes).toEqual([])
    })

    it('stops notifying after unsubscribe', () => {
        const { session, sprite, layer, frame } = doc()
        let count = 0
        const off = session.subscribe(() => count++)
        session.commit(paint(sprite, layer, frame, [[1, 1]], RED))
        off()
        session.commit(paint(sprite, layer, frame, [[2, 2]], BLUE))
        expect(count).toBe(1)
    })
})
