import { describe, expect, it } from 'vitest'
import {
    Command,
    cloneLayer,
    createSprite,
    getCel,
    layerSet,
    pixelPatchFrom,
    rgba,
    writePixel,
    type Sprite,
} from '@starforge/core'
import { OperationEntry, UndoStack } from './undoStack'

const RED = rgba(255, 0, 0)
const GREEN = rgba(0, 255, 0)

function makeRng(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0
        return s / 0x100000000
    }
}

function sprite32(): { sprite: Sprite; layer: string; frame: string } {
    const sprite = createSprite({ width: 32, height: 32 })
    return { sprite, layer: sprite.layers[0]!.id, frame: sprite.frames[0]!.id }
}

function strokeAt(
    sprite: Sprite,
    layer: string,
    frame: string,
    cells: [number, number][],
    color: number,
): Command {
    const command = new Command('stroke')
    for (const [x, y] of cells) {
        const write = writePixel(sprite, layer, frame, x, y, color)
        if (write) command.record(write)
    }
    return command
}

function entryFor(command: Command): OperationEntry | null {
    const patch = pixelPatchFrom(command.writes())
    return patch ? new OperationEntry(command.label, patch.operation, patch.inverse) : null
}

function pushStroke(stack: UndoStack, command: Command): OperationEntry | null {
    const entry = entryFor(command)
    if (entry) stack.push(entry)
    return entry
}

describe('UndoStack', () => {
    it('undo applies before colors, redo re-applies after, with the gesture rect', () => {
        const { sprite, layer, frame } = sprite32()
        const stack = new UndoStack()
        pushStroke(
            stack,
            strokeAt(
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

        const undone = stack.undo(sprite)
        expect(undone).toEqual({ kind: 'pixels', layer, frame, rect: { x: 2, y: 3, w: 4, h: 7 } })
        const cel = getCel(sprite, layer, frame)!
        expect([...cel.pixels].every((b) => b === 0)).toBe(true)

        expect(stack.redo(sprite)).toEqual({
            kind: 'pixels',
            layer,
            frame,
            rect: { x: 2, y: 3, w: 4, h: 7 },
        })
        expect(cel.pixels[(3 * 32 + 2) * 4]).toBe(255)
    })

    it('ignores empty gestures, an empty command never becomes an entry', () => {
        const { sprite } = sprite32()
        const stack = new UndoStack()
        expect(entryFor(new Command('nothing'))).toBeNull()
        expect(stack.undo(sprite)).toBeNull()
        expect(stack.redo(sprite)).toBeNull()
    })

    it('a new entry clears the redo stack', () => {
        const { sprite, layer, frame } = sprite32()
        const stack = new UndoStack()
        pushStroke(stack, strokeAt(sprite, layer, frame, [[0, 0]], RED))
        stack.undo(sprite)
        expect(stack.canRedo).toBe(true)
        pushStroke(stack, strokeAt(sprite, layer, frame, [[1, 1]], GREEN))
        expect(stack.canRedo).toBe(false)
        expect(stack.redo(sprite)).toBeNull()
    })

    it('drops the oldest entries beyond the entry cap', () => {
        const { sprite, layer, frame } = sprite32()
        const stack = new UndoStack({ maxEntries: 3 })
        for (let i = 0; i < 5; i++) {
            pushStroke(stack, strokeAt(sprite, layer, frame, [[i, 0]], RED))
        }
        let undos = 0
        while (stack.undo(sprite)) undos++
        expect(undos).toBe(3)
        expect(getCel(sprite, layer, frame)!.pixels[0]).toBe(255)
        expect(getCel(sprite, layer, frame)!.pixels[4]).toBe(255)
        expect(getCel(sprite, layer, frame)!.pixels[2 * 4]).toBe(0)
    })

    it('drops the oldest entries beyond the byte budget', () => {
        const { sprite, layer, frame } = sprite32()
        const cells = (y: number): [number, number][] =>
            Array.from({ length: 10 }, (_, x) => [x, y])
        const one = entryFor(strokeAt(sprite, layer, frame, cells(0), RED))!
        const stack = new UndoStack({ maxBytes: one.bytes * 2 })
        pushStroke(stack, strokeAt(sprite, layer, frame, cells(1), RED))
        pushStroke(stack, strokeAt(sprite, layer, frame, cells(2), RED))
        pushStroke(stack, strokeAt(sprite, layer, frame, cells(3), RED))
        let undos = 0
        while (stack.undo(sprite)) undos++
        expect(undos).toBe(2)
        expect(getCel(sprite, layer, frame)!.pixels[(32 + 5) * 4]).toBe(255)
    })

    it('charges the budget for the pixels a detached layer keeps alive', () => {
        const { sprite, layer, frame } = sprite32()
        writePixel(sprite, layer, frame, 0, 0, RED)
        const copy = cloneLayer(sprite, layer)

        const bare = new OperationEntry(
            'layer visible',
            layerSet(layer, 'visible', false),
            layerSet(layer, 'visible', true),
        )
        const heavy = new OperationEntry(
            'duplicate layer',
            { kind: 'layer.add', layer: copy, after: layer },
            { kind: 'layer.remove', layer: copy.id },
        )

        expect(heavy.bytes - bare.bytes).toBe(32 * 32 * 4)
    })

    it('keeps counting the memory still held for redo', () => {
        const { sprite, layer, frame } = sprite32()
        const stack = new UndoStack()
        const entries = [0, 1, 2].map((y) =>
            pushStroke(
                stack,
                strokeAt(
                    sprite,
                    layer,
                    frame,
                    [
                        [0, y],
                        [1, y],
                    ],
                    RED,
                ),
            ),
        )
        const total = entries.reduce((sum, entry) => sum + entry!.bytes, 0)
        expect(stack.bytes).toBe(total)

        while (stack.undo(sprite));
        expect(stack.bytes).toBe(total)
    })

    it('frees the redo memory when a new entry drops that future', () => {
        const { sprite, layer, frame } = sprite32()
        const stack = new UndoStack()
        for (const y of [0, 1, 2])
            pushStroke(
                stack,
                strokeAt(
                    sprite,
                    layer,
                    frame,
                    [
                        [0, y],
                        [1, y],
                    ],
                    RED,
                ),
            )
        while (stack.undo(sprite));

        const fresh = pushStroke(stack, strokeAt(sprite, layer, frame, [[5, 5]], GREEN))!
        expect(stack.canRedo).toBe(false)
        expect(stack.bytes).toBe(fresh.bytes)
    })

    it('200 random gestures, then undo-all, restores the base image bit-exactly', () => {
        const rng = makeRng(0xdeadbeef)
        const { sprite, layer, frame } = sprite32()
        const colors = [0, RED, GREEN, rgba(0, 0, 255), rgba(255, 255, 0, 128)]

        for (let i = 0; i < 200; i++) {
            writePixel(sprite, layer, frame, Math.floor(rng() * 32), Math.floor(rng() * 32), RED)
        }
        const base = getCel(sprite, layer, frame)!.pixels.slice()

        const stack = new UndoStack({ maxEntries: 400 })
        let pushed = 0
        for (let i = 0; i < 200; i++) {
            const command = new Command(`gesture ${i}`)
            const n = 1 + Math.floor(rng() * 12)
            for (let k = 0; k < n; k++) {
                const write = writePixel(
                    sprite,
                    layer,
                    frame,
                    Math.floor(rng() * 32),
                    Math.floor(rng() * 32),
                    colors[Math.floor(rng() * colors.length)]!,
                )
                if (write) command.record(write)
            }
            if (pushStroke(stack, command)) pushed++

            if (rng() < 0.15 && stack.undo(sprite)) {
                pushed--
                if (rng() < 0.5) {
                    stack.redo(sprite)
                    pushed++
                }
            }
        }

        const final = getCel(sprite, layer, frame)!.pixels.slice()
        let undone = 0
        while (stack.undo(sprite)) undone++
        expect(undone).toBe(pushed)
        expect(getCel(sprite, layer, frame)!.pixels).toEqual(base)

        while (stack.redo(sprite));
        expect(getCel(sprite, layer, frame)!.pixels).toEqual(final)
    })
})
