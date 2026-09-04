import { describe, expect, it } from 'vitest'
import {
    Command,
    createFrame,
    createLayer,
    createSprite,
    getPixel,
    insertLayer,
    rgba,
    writePixel,
    type DocumentOperation,
    type Sprite,
} from '@starforge/core'
import { DocumentSession, type ChangeSet } from './session'

const RED = rgba(255, 0, 0)
const BLUE = rgba(0, 0, 255)

function doc(): { session: DocumentSession; sprite: Sprite; layer: string; frame: string } {
    const sprite = createSprite({ width: 16, height: 16 })
    const session = new DocumentSession(sprite, { author: 'author-a' })
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
        const changes: ChangeSet[] = []
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
        const changes: ChangeSet[] = []
        session.subscribe((c) => changes.push(c))
        session.commit(new Command('nothing'))
        expect(changes).toEqual([])
        expect(session.canUndo).toBe(false)
    })

    it('undo reverts pixels and emits a change; redo replays them', () => {
        const { session, sprite, layer, frame } = doc()
        session.commit(paint(sprite, layer, frame, [[4, 4]], RED))
        const changes: ChangeSet[] = []
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
        const changes: ChangeSet[] = []
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

    it('reports local and remote operations until the operation listener unsubscribes', () => {
        const { session, layer } = doc()
        const seen: { operation: DocumentOperation; origin: 'local' | 'remote' }[] = []
        const off = session.onOperation((operation, origin) => {
            seen.push({ operation, origin })
        })
        const local: DocumentOperation = {
            kind: 'layer.set',
            layer,
            prop: 'opacity',
            value: 128,
        }
        const remote: DocumentOperation = { kind: 'document.rename', title: 'From orbit' }

        session.apply('dim layer', local)
        session.applyRemote(remote)
        off()
        session.apply('show layer', { kind: 'layer.set', layer, prop: 'opacity', value: 255 })

        expect(seen).toEqual([
            { operation: local, origin: 'local' },
            { operation: remote, origin: 'remote' },
        ])
    })
})

describe('DocumentSession rename', () => {
    it('normalizes the title and records one undo step', () => {
        const { session, sprite } = doc()
        session.rename('   Moon    Café   ')

        expect(sprite.meta.title).toBe('Moon Café')
        session.undo()
        expect(sprite.meta.title).toBe('Untitled')
    })

    it('ignores a title that is blank or already the one in use', () => {
        const { session, sprite } = doc()
        session.rename('    ')
        session.rename(sprite.meta.title)

        expect(session.canUndo).toBe(false)
    })

    it('caps a title that would otherwise bloat the document', () => {
        const { session, sprite } = doc()
        session.rename('y'.repeat(500))

        expect(sprite.meta.title).toHaveLength(64)
    })
})

describe('DocumentSession target', () => {
    it('starts on the requested target and falls back to the top layer and first frame', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        insertLayer(sprite, createLayer('Ink'), sprite.layers[0]!.id)
        const top = sprite.layers[1]!.id

        expect(new DocumentSession(sprite).target.state).toEqual({
            layer: top,
            frame: sprite.frames[0]!.id,
        })
        expect(
            new DocumentSession(sprite, { target: { layer: 'ghost', frame: 'ghost' } }).target
                .state,
        ).toEqual({ layer: top, frame: sprite.frames[0]!.id })
    })

    it('has no target for a document that broke its own invariant, instead of throwing', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        sprite.layers.length = 0

        expect(new DocumentSession(sprite).target.state).toEqual({ layer: '', frame: '' })
    })

    it('keeps two frames apart: each one paints and undoes on its own cels', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        sprite.frames.push(createFrame())
        const layer = sprite.layers[0]!.id
        const [first, second] = sprite.frames.map((frame) => frame.id) as [string, string]
        const session = new DocumentSession(sprite)

        session.commit(paint(sprite, layer, first, [[1, 1]], RED))
        session.setTarget({ frame: second })
        expect(session.target.state.frame).toBe(second)

        session.commit(paint(sprite, layer, second, [[1, 1]], BLUE))
        expect(getPixel(sprite, layer, first, 1, 1)).toBe(RED)
        expect(getPixel(sprite, layer, second, 1, 1)).toBe(BLUE)

        session.undo()
        expect(getPixel(sprite, layer, second, 1, 1)).toBe(0)
        expect(getPixel(sprite, layer, first, 1, 1)).toBe(RED)
    })

    it('ignores a target the document does not have', () => {
        const { session, layer, frame } = doc()
        session.setTarget({ layer: 'ghost' })
        session.setTarget({ frame: 'ghost' })
        expect(session.target.state).toEqual({ layer, frame })
    })

    it('settles work in flight only when the target really moves', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        insertLayer(sprite, createLayer('Ink'), sprite.layers[0]!.id)
        const session = new DocumentSession(sprite)
        let settled = 0
        session.setBeforeChange(() => settled++)

        session.setTarget({ layer: session.target.state.layer })
        session.setTarget({ layer: 'ghost' })
        expect(settled).toBe(0)

        session.setTarget({ layer: sprite.layers[0]!.id })
        expect(settled).toBe(1)
    })

    it('hands the target to the layer that took the removed slot', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        insertLayer(sprite, createLayer('Ink'), sprite.layers[0]!.id)
        insertLayer(sprite, createLayer('Line'), sprite.layers[1]!.id)
        const session = new DocumentSession(sprite, { target: { layer: sprite.layers[1]!.id } })

        session.apply('remove layer', { kind: 'layer.remove', layer: sprite.layers[1]!.id })
        expect(session.target.state.layer).toBe(sprite.layers[1]!.id)

        session.apply('remove layer', { kind: 'layer.remove', layer: sprite.layers[1]!.id })
        expect(session.target.state.layer).toBe(sprite.layers[0]!.id)
    })

    it('takes the target back when undo revokes the layer it moved to', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        const session = new DocumentSession(sprite)
        const added = createLayer('Ink')

        session.apply('add layer', { kind: 'layer.add', layer: added, after: sprite.layers[0]!.id })
        session.setTarget({ layer: added.id })

        session.undo()
        expect(sprite.layers.some((layer) => layer.id === session.target.state.layer)).toBe(true)
    })
})
