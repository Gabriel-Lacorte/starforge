import { describe, expect, it } from 'vitest'
import { rgba, TRANSPARENT, type RGBA } from './color'
import { createFrame, createLayer, createSprite, getLayer, type Sprite } from './doc'
import { documentFingerprint } from './hash'
import { insertLayer } from './layers'
import {
    applyOperation,
    OperationError,
    pixelPatchFrom,
    type DocumentOperation,
    type PixelPatchOperation,
} from './operation'
import { getPixel, writePixel } from './ops'
import { Command } from './undo'

const RED = rgba(255, 0, 0)
const BLUE = rgba(0, 0, 255)

function pinned(id: string): Sprite {
    const sprite = createSprite({ width: 16, height: 16, id })
    sprite.meta.createdAt = sprite.meta.updatedAt = '2026-08-12T00:00:00.000Z'
    sprite.layers[0] = createLayer('Layer 1', `${id}-layer`)
    sprite.frames[0] = createFrame(undefined, `${id}-frame`)

    return sprite
}

function doc(): { sprite: Sprite; layer: string; frame: string } {
    const sprite = pinned('sprite-under-test')
    return { sprite, layer: sprite.layers[0]!.id, frame: sprite.frames[0]!.id }
}

function patch(
    layer: string,
    frame: string,
    cells: readonly (readonly [number, number, RGBA])[],
): PixelPatchOperation {
    return {
        kind: 'pixel.patch',
        layer,
        frame,
        xs: Uint16Array.from(cells, ([x]) => x),
        ys: Uint16Array.from(cells, ([, y]) => y),
        colors: Uint32Array.from(cells, ([, , color]) => color),
    }
}

function code(run: () => unknown): string {
    try {
        run()
    } catch (error) {
        if (error instanceof OperationError) return error.code
        throw error
    }

    throw new Error('expected the operation to be rejected')
}

describe('applyOperation: pixel.patch', () => {
    it('writes the cells, reports the dirty rect and hands back the inverse', () => {
        const { sprite, layer, frame } = doc()
        const result = applyOperation(
            sprite,
            patch(layer, frame, [
                [2, 3, RED],
                [5, 9, BLUE],
            ]),
        )

        expect(result.change).toEqual({
            kind: 'pixels',
            layer,
            frame,
            rect: { x: 2, y: 3, w: 4, h: 7 },
        })
        expect(result.skipped).toBe(0)
        expect(getPixel(sprite, layer, frame, 2, 3)).toBe(RED)

        applyOperation(sprite, result.inverse)
        expect(getPixel(sprite, layer, frame, 2, 3)).toBe(TRANSPARENT)
        expect(getPixel(sprite, layer, frame, 5, 9)).toBe(TRANSPARENT)
    })

    it('counts cells the document refuses instead of failing the whole patch', () => {
        const { sprite, layer, frame } = doc()
        writePixel(sprite, layer, frame, 1, 1, RED)

        const result = applyOperation(
            sprite,
            patch(layer, frame, [
                [1, 1, RED],
                [99, 1, BLUE],
                [4, 4, BLUE],
            ]),
        )

        expect(result.skipped).toBe(2)
        expect(getPixel(sprite, layer, frame, 4, 4)).toBe(BLUE)
    })

    it('is idempotent: applying the same patch twice leaves the same document', () => {
        const { sprite, layer, frame } = doc()
        const operation = patch(layer, frame, [
            [0, 0, RED],
            [1, 0, BLUE],
        ])

        applyOperation(sprite, operation)
        const once = documentFingerprint(sprite)
        applyOperation(sprite, operation)

        expect(documentFingerprint(sprite)).toBe(once)
    })

    it('rejects a malformed, empty, misplaced or locked patch without touching pixels', () => {
        const { sprite, layer, frame } = doc()
        const before = documentFingerprint(sprite)

        expect(
            code(() =>
                applyOperation(sprite, {
                    ...patch(layer, frame, [[0, 0, RED]]),
                    ys: new Uint16Array(2),
                }),
            ),
        ).toBe('PAYLOAD')
        expect(code(() => applyOperation(sprite, patch(layer, frame, [])))).toBe('PAYLOAD')
        expect(code(() => applyOperation(sprite, patch(layer, frame, [[900, 900, RED]])))).toBe(
            'PAYLOAD',
        )
        expect(code(() => applyOperation(sprite, patch('ghost', frame, [[0, 0, RED]])))).toBe(
            'TARGET',
        )
        expect(code(() => applyOperation(sprite, patch(layer, 'ghost', [[0, 0, RED]])))).toBe(
            'TARGET',
        )

        const lock = (value: boolean): void => {
            applyOperation(sprite, { kind: 'layer.set', layer, prop: 'locked', value })
        }
        lock(true)
        expect(code(() => applyOperation(sprite, patch(layer, frame, [[0, 0, RED]])))).toBe(
            'PRECONDITION',
        )
        lock(false)

        expect(documentFingerprint(sprite)).toBe(before)
    })

    it('packs a gesture into a patch that shares its coordinates with the inverse', () => {
        const { sprite, layer, frame } = doc()
        const command = new Command('pencil')
        for (const [x, y] of [
            [4, 4],
            [6, 2],
        ]) {
            command.record(writePixel(sprite, layer, frame, x!, y!, RED)!)
        }

        const packed = pixelPatchFrom(command.writes())!
        expect(packed.operation.xs).toBe(packed.inverse.xs)
        expect(packed.change).toEqual({
            kind: 'pixels',
            layer,
            frame,
            rect: { x: 4, y: 2, w: 3, h: 3 },
        })

        applyOperation(sprite, packed.inverse)
        expect(getPixel(sprite, layer, frame, 4, 4)).toBe(TRANSPARENT)
    })

    it('packs nothing from an empty gesture', () => {
        expect(pixelPatchFrom([])).toBeNull()
    })
})

describe('applyOperation: layers', () => {
    it('add and its inverse restore the original stack', () => {
        const { sprite, layer } = doc()
        const before = documentFingerprint(sprite)
        const added = createLayer('Ink', 'ink-id')

        const result = applyOperation(sprite, { kind: 'layer.add', layer: added, after: layer })
        expect(sprite.layers.map((l) => l.name)).toEqual(['Layer 1', 'Ink'])
        expect(result.change).toEqual({ kind: 'structure' })

        applyOperation(sprite, result.inverse)
        expect(documentFingerprint(sprite)).toBe(before)
    })

    it('remove reports the vacated index and its inverse puts the same object back', () => {
        const { sprite, layer } = doc()
        insertLayer(sprite, createLayer('Ink', 'ink-id'), layer)
        const ink = sprite.layers[1]!

        const result = applyOperation(sprite, { kind: 'layer.remove', layer: 'ink-id' })
        expect(result.change).toEqual({ kind: 'structure', removedLayerIndex: 1 })

        applyOperation(sprite, result.inverse)
        expect(sprite.layers[1]).toBe(ink)
    })

    it('move remembers where the layer came from', () => {
        const { sprite, layer } = doc()
        insertLayer(sprite, createLayer('Ink', 'ink-id'), layer)
        const order = () => sprite.layers.map((l) => l.name)

        const result = applyOperation(sprite, { kind: 'layer.move', layer, after: 'ink-id' })
        expect(order()).toEqual(['Ink', 'Layer 1'])

        applyOperation(sprite, result.inverse)
        expect(order()).toEqual(['Layer 1', 'Ink'])
    })

    it('set carries the previous value in its inverse', () => {
        const { sprite, layer } = doc()
        const result = applyOperation(sprite, {
            kind: 'layer.set',
            layer,
            prop: 'blendMode',
            value: 'multiply',
        })

        expect(getLayer(sprite, layer).blendMode).toBe('multiply')
        applyOperation(sprite, result.inverse)
        expect(getLayer(sprite, layer).blendMode).toBe('normal')
    })

    it('refuses structural operations that would break a document invariant', () => {
        const { sprite, layer } = doc()
        insertLayer(sprite, createLayer('Ink', 'ink-id'), layer)
        const before = documentFingerprint(sprite)

        expect(code(() => applyOperation(sprite, { kind: 'layer.remove', layer: 'ghost' }))).toBe(
            'TARGET',
        )
        expect(
            code(() =>
                applyOperation(sprite, {
                    kind: 'layer.add',
                    layer: sprite.layers[0]!,
                    after: null,
                }),
            ),
        ).toBe('PRECONDITION')
        expect(
            code(() => applyOperation(sprite, { kind: 'layer.move', layer, after: layer })),
        ).toBe('PRECONDITION')
        expect(
            code(() =>
                applyOperation(sprite, { kind: 'layer.move', layer: 'ink-id', after: layer }),
            ),
        ).toBe('PRECONDITION')
        expect(
            code(() =>
                applyOperation(sprite, { kind: 'layer.set', layer, prop: 'opacity', value: 300 }),
            ),
        ).toBe('PAYLOAD')
        expect(
            code(() =>
                applyOperation(sprite, {
                    kind: 'layer.set',
                    layer,
                    prop: 'name',
                    value: '  padded  ',
                }),
            ),
        ).toBe('PAYLOAD')
        expect(
            code(() => applyOperation(sprite, { kind: 'nope' } as unknown as DocumentOperation)),
        ).toBe('PAYLOAD')

        expect(documentFingerprint(sprite)).toBe(before)
    })

    it('keeps the last layer', () => {
        const { sprite, layer } = doc()
        expect(code(() => applyOperation(sprite, { kind: 'layer.remove', layer }))).toBe(
            'PRECONDITION',
        )
    })
})

describe('applyOperation: palette', () => {
    it('adds a color at an index and takes it back out', () => {
        const { sprite } = doc()
        const before = documentFingerprint(sprite)
        const size = sprite.palette.colors.length

        const result = applyOperation(sprite, { kind: 'palette.add', color: '#abcdef', index: 0 })
        expect(sprite.palette.colors[0]).toBe('#abcdef')
        expect(sprite.palette.colors).toHaveLength(size + 1)

        applyOperation(sprite, result.inverse)
        expect(documentFingerprint(sprite)).toBe(before)
    })

    it('appends at the end of the list', () => {
        const { sprite } = doc()
        const index = sprite.palette.colors.length
        applyOperation(sprite, { kind: 'palette.add', color: '#0011223f', index })

        expect(sprite.palette.colors.at(-1)).toBe('#0011223f')
    })

    it('refuses a non-canonical color, an index off the list and a missing entry', () => {
        const { sprite } = doc()
        const before = documentFingerprint(sprite)
        const size = sprite.palette.colors.length

        for (const color of ['#ABCDEF', 'abcdef', '#abc', '#abcdefgh']) {
            expect(
                code(() => applyOperation(sprite, { kind: 'palette.add', color, index: 0 })),
            ).toBe('PAYLOAD')
        }
        expect(
            code(() =>
                applyOperation(sprite, { kind: 'palette.add', color: '#abcdef', index: size + 1 }),
            ),
        ).toBe('PAYLOAD')
        expect(code(() => applyOperation(sprite, { kind: 'palette.remove', index: size }))).toBe(
            'TARGET',
        )

        expect(documentFingerprint(sprite)).toBe(before)
    })
})

describe('applyOperation: palette editing', () => {
    it('moves a colour and remembers where it came from', () => {
        const { sprite } = doc()
        const order = () => sprite.palette.colors.slice(0, 3)
        const first = order()

        const result = applyOperation(sprite, { kind: 'palette.move', from: 0, to: 2 })
        expect(order()).toEqual([first[1], first[2], first[0]])

        applyOperation(sprite, result.inverse)
        expect(order()).toEqual(first)
    })

    it('replaces one swatch and puts the old colour back', () => {
        const { sprite } = doc()
        const previous = sprite.palette.colors[1]!

        const result = applyOperation(sprite, { kind: 'palette.set', index: 1, color: '#abcdef' })
        expect(sprite.palette.colors[1]).toBe('#abcdef')

        applyOperation(sprite, result.inverse)
        expect(sprite.palette.colors[1]).toBe(previous)
    })

    it('renames the palette reversibly', () => {
        const { sprite } = doc()
        const previous = sprite.palette.name

        const result = applyOperation(sprite, { kind: 'palette.rename', name: 'Cave' })
        expect(sprite.palette.name).toBe('Cave')

        applyOperation(sprite, result.inverse)
        expect(sprite.palette.name).toBe(previous)
    })

    it('swaps the whole palette in one step, which is one step to undo', () => {
        const { sprite } = doc()
        const before = documentFingerprint(sprite)

        const result = applyOperation(sprite, {
            kind: 'palette.replace',
            name: 'Two',
            colors: ['#000000', '#ffffff'],
        })
        expect(sprite.palette).toEqual({ name: 'Two', colors: ['#000000', '#ffffff'] })

        applyOperation(sprite, result.inverse)
        expect(documentFingerprint(sprite)).toBe(before)
    })

    it('copies the incoming colours instead of adopting the caller array', () => {
        const { sprite } = doc()
        const colors = ['#000000', '#ffffff']
        applyOperation(sprite, { kind: 'palette.replace', name: 'Two', colors })

        colors.push('#ff0000')
        expect(sprite.palette.colors).toHaveLength(2)
    })

    it('refuses edits that address nothing, change nothing or carry junk', () => {
        const { sprite } = doc()
        const before = documentFingerprint(sprite)
        const size = sprite.palette.colors.length

        expect(
            code(() => applyOperation(sprite, { kind: 'palette.move', from: 0, to: size })),
        ).toBe('TARGET')
        expect(code(() => applyOperation(sprite, { kind: 'palette.move', from: 1, to: 1 }))).toBe(
            'PRECONDITION',
        )
        expect(
            code(() =>
                applyOperation(sprite, { kind: 'palette.set', index: -1, color: '#abcdef' }),
            ),
        ).toBe('TARGET')
        expect(
            code(() => applyOperation(sprite, { kind: 'palette.set', index: 0, color: 'nope' })),
        ).toBe('PAYLOAD')
        expect(
            code(() =>
                applyOperation(sprite, {
                    kind: 'palette.set',
                    index: 0,
                    color: sprite.palette.colors[0]!,
                }),
            ),
        ).toBe('PRECONDITION')
        expect(
            code(() => applyOperation(sprite, { kind: 'palette.rename', name: '  padded  ' })),
        ).toBe('PAYLOAD')
        expect(
            code(() =>
                applyOperation(sprite, { kind: 'palette.rename', name: sprite.palette.name }),
            ),
        ).toBe('PRECONDITION')
        expect(
            code(() => applyOperation(sprite, { kind: 'palette.replace', name: 'x', colors: [] })),
        ).toBe('PAYLOAD')
        expect(
            code(() =>
                applyOperation(sprite, { kind: 'palette.replace', name: 'x', colors: ['bad'] }),
            ),
        ).toBe('PAYLOAD')

        expect(documentFingerprint(sprite)).toBe(before)
    })
})

describe('applyOperation: document', () => {
    it('renames the document reversibly', () => {
        const { sprite } = doc()
        const previous = sprite.meta.title

        const result = applyOperation(sprite, { kind: 'document.rename', title: 'Moon Café' })
        expect(sprite.meta.title).toBe('Moon Café')

        applyOperation(sprite, result.inverse)
        expect(sprite.meta.title).toBe(previous)
    })

    it('refuses an empty, unnormalized or unchanged title', () => {
        const { sprite } = doc()
        const before = documentFingerprint(sprite)

        expect(code(() => applyOperation(sprite, { kind: 'document.rename', title: '' }))).toBe(
            'PAYLOAD',
        )
        expect(
            code(() => applyOperation(sprite, { kind: 'document.rename', title: '  x  ' })),
        ).toBe('PAYLOAD')
        expect(
            code(() =>
                applyOperation(sprite, { kind: 'document.rename', title: sprite.meta.title }),
            ),
        ).toBe('PRECONDITION')

        expect(documentFingerprint(sprite)).toBe(before)
    })
})

describe('applyOperation: canvas size', () => {
    const wide = () => {
        const sprite = pinned('canvas')
        sprite.width = sprite.height = 32
        for (const layer of sprite.layers) layer.cels.clear()

        return { sprite, layer: sprite.layers[0]!.id, frame: sprite.frames[0]!.id }
    }

    it('resizes and undoes back to the exact pixels it destroyed', () => {
        const { sprite, layer, frame } = wide()
        writePixel(sprite, layer, frame, 30, 30, RED)
        const before = documentFingerprint(sprite)

        const result = applyOperation(sprite, {
            kind: 'document.resize',
            width: 16,
            height: 16,
            offsetX: 0,
            offsetY: 0,
        })
        expect([sprite.width, sprite.height]).toEqual([16, 16])
        expect(getPixel(sprite, layer, frame, 15, 15)).toBe(TRANSPARENT)

        applyOperation(sprite, result.inverse)
        expect(documentFingerprint(sprite)).toBe(before)
        expect(getPixel(sprite, layer, frame, 30, 30)).toBe(RED)
    })

    it('scales and undoes back', () => {
        const { sprite, layer, frame } = wide()
        writePixel(sprite, layer, frame, 1, 1, BLUE)
        const before = documentFingerprint(sprite)

        const result = applyOperation(sprite, { kind: 'document.scale', width: 64, height: 64 })
        expect(getPixel(sprite, layer, frame, 3, 3)).toBe(BLUE)

        applyOperation(sprite, result.inverse)
        expect(documentFingerprint(sprite)).toBe(before)
    })

    it('refuses a size the document model rejects, leaving the canvas alone', () => {
        const { sprite } = wide()
        const before = documentFingerprint(sprite)

        expect(
            code(() =>
                applyOperation(sprite, {
                    kind: 'document.resize',
                    width: 4,
                    height: 16,
                    offsetX: 0,
                    offsetY: 0,
                }),
            ),
        ).toBe('PAYLOAD')
        expect(
            code(() =>
                applyOperation(sprite, {
                    kind: 'document.resize',
                    width: 32,
                    height: 32,
                    offsetX: 0,
                    offsetY: 0,
                }),
            ),
        ).toBe('PRECONDITION')
        expect(
            code(() => applyOperation(sprite, { kind: 'document.scale', width: 32, height: 32 })),
        ).toBe('PRECONDITION')

        expect(documentFingerprint(sprite)).toBe(before)
    })
})

describe('operation replay', () => {
    it('two documents replaying the same sequence end on the same fingerprint', () => {
        const build = (): { sprite: Sprite; script: DocumentOperation[] } => {
            const sprite = pinned('replay')
            const layer = sprite.layers[0]!.id
            const frame = sprite.frames[0]!.id

            return {
                sprite,
                script: [
                    patch(layer, frame, [
                        [1, 1, RED],
                        [2, 1, RED],
                    ]),
                    { kind: 'layer.add', layer: createLayer('Ink', 'ink'), after: layer },
                    patch('ink', frame, [[3, 3, BLUE]]),
                    { kind: 'layer.set', layer: 'ink', prop: 'opacity', value: 128 },
                    { kind: 'layer.move', layer: 'ink', after: null },
                    { kind: 'layer.set', layer, prop: 'visible', value: false },
                ],
            }
        }

        const a = build()
        const b = build()
        for (const operation of a.script) applyOperation(a.sprite, operation)
        for (const operation of b.script) applyOperation(b.sprite, operation)

        expect(documentFingerprint(a.sprite)).toBe(documentFingerprint(b.sprite))
    })

    it('walking the inverses back returns the starting fingerprint', () => {
        const { sprite, layer, frame } = doc()
        const start = documentFingerprint(sprite)
        const script: DocumentOperation[] = [
            patch(layer, frame, [[7, 7, RED]]),
            { kind: 'layer.add', layer: createLayer('Ink', 'ink'), after: layer },
            patch('ink', frame, [[7, 7, BLUE]]),
            { kind: 'layer.set', layer: 'ink', prop: 'locked', value: true },
            { kind: 'layer.move', layer: 'ink', after: null },
        ]

        const inverses = script.map((operation) => applyOperation(sprite, operation).inverse)
        expect(documentFingerprint(sprite)).not.toBe(start)

        for (const inverse of inverses.reverse()) applyOperation(sprite, inverse)
        expect(documentFingerprint(sprite)).toBe(start)
    })
})
