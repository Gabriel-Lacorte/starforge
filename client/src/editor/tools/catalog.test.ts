import { describe, expect, it } from 'vitest'
import {
    TRANSPARENT,
    applyInk,
    createSprite,
    getPixel,
    openCursor,
    rgba,
    writePixel,
    type RGBA,
    type Sprite,
} from '@starforge/core'
import { TOOL_ICON } from '../ui/icons'
import type { ToolId } from '../store'
import { TOOL_CATALOG, toolBadge } from './catalog'
import {
    captureSettings,
    inkFor,
    toolCapabilities,
    type ToolDefinition,
    type ToolSettings,
} from './definition'
import { makeTool, toolDefinition } from './registry'
import type { ToolHost } from './tool'
import { ONION_SHOWN } from '../../render/onion'

const ALL_TOOLS: ToolId[] = [
    'select',
    'selectEllipse',
    'lasso',
    'wand',
    'eyedropper',
    'pencil',
    'eraser',
    'line',
    'rect',
    'ellipse',
    'bucket',
]
const NO_MODS = { shift: false, alt: false, ctrl: false }
const RED = rgba(255, 0, 0)

const SETTINGS: ToolSettings = {
    color: RED,
    inkOpacity: 255,
    brushSize: 1,
    pixelPerfect: true,
    lockAlpha: false,
    shapeFill: false,
    symmetryH: false,
    symmetryV: false,
    fillTolerance: 0,
    fillContiguous: true,
    seed: 0,
}

function paintingHost(
    sprite: Sprite,
    settings: ToolSettings = SETTINGS,
    previews: RGBA[] = [],
): ToolHost {
    const layer = sprite.layers[0]!.id
    const frame = sprite.frames[0]!.id
    const cursor = openCursor(sprite, layer, frame)

    return {
        sprite,
        layer,
        frame,
        settings,
        selection: null,
        write: (x, y, context) => {
            cursor.set(x, y, applyInk(cursor.get(x, y), context))
        },
        absorb: () => {
            /* no undo stack here */
        },
        preview: (_cells, color) => previews.push(color),
        clearPreview: () => {
            /* no overlay canvas in tests */
        },
    }
}

describe('TOOL_CATALOG', () => {
    it('lists every tool exactly once, and each has an icon', () => {
        const ids = TOOL_CATALOG.map((t) => t.id)
        expect([...ids].sort()).toEqual([...ALL_TOOLS].sort())
        expect(new Set(ids).size).toBe(ids.length)
        for (const id of ids) expect(TOOL_ICON[id]).toBeTypeOf('function')
    })

    it('derives the badge from the shortcut, so rect and ellipse both show U', () => {
        const badgeOf = (id: ToolId) => toolBadge(toolDefinition(id))
        expect(badgeOf('select')).toBe('M')
        expect(badgeOf('rect')).toBe('U')
        expect(badgeOf('ellipse')).toBe('U')
    })

    it('models the shape slot as a shared shortcut (rect and ellipse both u)', () => {
        const withU = TOOL_CATALOG.filter((t) => t.shortcut === 'u').map((t) => t.id)
        expect(withU).toEqual(['rect', 'ellipse'])
    })

    it('derives the context bar from what each definition reads', () => {
        const capabilities = (id: ToolId) => toolCapabilities(toolDefinition(id))
        expect(capabilities('select')).toEqual([])
        expect(capabilities('selectEllipse')).toEqual([])
        expect(capabilities('lasso')).toEqual([])
        expect(capabilities('eyedropper')).toEqual([])
        expect(capabilities('wand')).toEqual(['flood'])
        expect(capabilities('pencil')).toEqual([
            'brush',
            'opacity',
            'pixelPerfect',
            'lockAlpha',
            'symmetry',
        ])
        expect(capabilities('line')).toEqual(['brush', 'opacity', 'lockAlpha'])
        expect(capabilities('rect')).toEqual(['brush', 'opacity', 'lockAlpha', 'shapeFill'])
        expect(capabilities('ellipse')).toEqual(['brush', 'opacity', 'lockAlpha', 'shapeFill'])
        expect(capabilities('bucket')).toEqual(['opacity', 'lockAlpha', 'flood'])

        expect(capabilities('eraser')).toEqual(['brush', 'opacity', 'pixelPerfect', 'symmetry'])
    })

    it('gives the eraser erase ink and every other pixel tool source-over', () => {
        expect(toolDefinition('eraser').ink).toBe('erase')
        for (const id of ['pencil', 'line', 'rect', 'ellipse', 'bucket'] as const) {
            expect(toolDefinition(id).ink).toBe('source-over')
        }
    })

    it('previews the tools that rubber-band and writes the rest as they go', () => {
        const trace = (id: ToolId) => toolDefinition(id).trace
        expect([trace('line'), trace('rect'), trace('ellipse')]).toEqual([
            'preview',
            'preview',
            'preview',
        ])
        expect([trace('pencil'), trace('eraser'), trace('bucket')]).toEqual([
            'direct',
            'direct',
            'direct',
        ])
    })

    it('refuses a tool the catalog does not define, and the marquee has no tracer', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        expect(() => toolDefinition('nope' as ToolId)).toThrow(/unknown tool/)
        for (const id of ['select', 'selectEllipse', 'lasso', 'wand'] as const) {
            expect(() => makeTool(toolDefinition(id), paintingHost(sprite))).toThrow(
                /selection controller/,
            )
        }
        expect(() => makeTool(toolDefinition('eyedropper'), paintingHost(sprite))).toThrow(
            /input layer/,
        )
    })
})

describe('captured settings', () => {
    it('copies the tool knobs and carries the gesture seed', () => {
        const state = {
            tool: 'pencil',
            color: RED,
            background: 0,
            recentColors: [],
            inkOpacity: 128,
            brushSize: 3,
            pixelPerfect: false,
            lockAlpha: true,
            shapeFill: true,
            symmetryH: true,
            symmetryV: false,
            fillTolerance: 12,
            fillContiguous: false,
            onion: ONION_SHOWN,
        } as const

        expect(captureSettings(state, 7)).toEqual({
            color: RED,
            inkOpacity: 128,
            brushSize: 3,
            pixelPerfect: false,
            lockAlpha: true,
            shapeFill: true,
            symmetryH: true,
            symmetryV: false,
            fillTolerance: 12,
            fillContiguous: false,
            seed: 7,
        })
    })

    it('sends the erase ink to full transparency and everything else to the chosen color', () => {
        const settings = { ...SETTINGS, inkOpacity: 200 }
        expect(inkFor(toolDefinition('eraser'), settings)).toEqual({
            mode: 'erase',
            color: 0,
            opacity: 200,
        })
        expect(inkFor(toolDefinition('pencil'), settings)).toEqual({
            mode: 'source-over',
            color: RED,
            opacity: 200,
        })
    })

    it('turns a paint tool to lock-alpha, and leaves the eraser erasing', () => {
        const locked = { ...SETTINGS, lockAlpha: true }
        expect(inkFor(toolDefinition('pencil'), locked).mode).toBe('lock-alpha')
        expect(inkFor(toolDefinition('bucket'), locked).mode).toBe('lock-alpha')
        expect(inkFor(toolDefinition('eraser'), locked).mode).toBe('erase')
    })
})

describe('freehand corners', () => {
    const stroke = (sprite: Sprite, cells: readonly (readonly [number, number])[]) => {
        const tool = makeTool(toolDefinition('pencil'), paintingHost(sprite))
        const [first, ...rest] = cells
        tool.begin(first![0], first![1], NO_MODS)
        for (const [x, y] of rest) tool.move(x, y, NO_MODS)
        tool.end(cells.at(-1)![0], cells.at(-1)![1], NO_MODS)
    }

    it('drops the corner a 1px turn leaves behind, so a diagonal reads as drawn', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        const layer = sprite.layers[0]!.id
        const frame = sprite.frames[0]!.id

        stroke(sprite, [
            [0, 0],
            [1, 0],
            [1, 1],
        ])

        expect(getPixel(sprite, layer, frame, 0, 0)).toBe(RED)
        expect(getPixel(sprite, layer, frame, 1, 1)).toBe(RED)
        expect(getPixel(sprite, layer, frame, 1, 0)).toBe(TRANSPARENT)
    })

    it('keeps the corner when pixel-perfect is off', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        const layer = sprite.layers[0]!.id
        const frame = sprite.frames[0]!.id

        const tool = makeTool(
            toolDefinition('pencil'),
            paintingHost(sprite, { ...SETTINGS, pixelPerfect: false }),
        )
        tool.begin(0, 0, NO_MODS)
        tool.move(1, 0, NO_MODS)
        tool.move(1, 1, NO_MODS)
        tool.end(1, 1, NO_MODS)

        expect(getPixel(sprite, layer, frame, 1, 0)).toBe(RED)
    })

    it('keeps every cell of a straight run, so the trim is not over-eager', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        const layer = sprite.layers[0]!.id
        const frame = sprite.frames[0]!.id

        stroke(sprite, [
            [0, 0],
            [1, 0],
            [2, 0],
        ])

        for (const x of [0, 1, 2]) expect(getPixel(sprite, layer, frame, x, 0)).toBe(RED)
    })
})

describe('lock alpha', () => {
    it('paints inside what is already drawn and leaves the empty cells empty', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        const layer = sprite.layers[0]!.id
        const frame = sprite.frames[0]!.id

        writePixel(sprite, layer, frame, 4, 4, rgba(0, 0, 255))

        const tool = makeTool(
            toolDefinition('pencil'),
            paintingHost(sprite, { ...SETTINGS, lockAlpha: true }),
        )
        tool.begin(0, 4, NO_MODS)
        tool.move(8, 4, NO_MODS)
        tool.end(8, 4, NO_MODS)

        expect(getPixel(sprite, layer, frame, 4, 4)).toBe(RED)
        for (const x of [0, 3, 5, 8]) {
            expect(getPixel(sprite, layer, frame, x, 4)).toBe(TRANSPARENT)
        }
    })
})

describe('tool composition', () => {
    it('runs an ellipse eraser that no catalog entry describes', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        const layer = sprite.layers[0]!.id
        const frame = sprite.frames[0]!.id
        for (let x = 0; x < 16; x++) {
            for (let y = 0; y < 16; y++) writePixel(sprite, layer, frame, x, y, RED)
        }

        const ellipseEraser: ToolDefinition = {
            id: 'ellipse',
            label: 'Ellipse eraser',
            shortcut: 'u',
            geometry: 'ellipse',
            ink: 'erase',
            stamp: 'brush',
            trace: 'preview',
        }
        expect(toolCapabilities(ellipseEraser)).toEqual(['brush', 'opacity', 'shapeFill'])

        const tool = makeTool(ellipseEraser, paintingHost(sprite))
        tool.begin(2, 2, NO_MODS)
        tool.move(10, 8, NO_MODS)
        expect(tool.end(10, 8, NO_MODS)).toBe(true)

        expect(getPixel(sprite, layer, frame, 6, 2)).toBe(0)
        expect(getPixel(sprite, layer, frame, 6, 5)).toBe(RED)
        expect(getPixel(sprite, layer, frame, 15, 15)).toBe(RED)
    })

    it('previews a shape in the colour the commit will actually leave', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        const layer = sprite.layers[0]!.id
        const frame = sprite.frames[0]!.id
        const previews: RGBA[] = []
        const host = paintingHost(sprite, { ...SETTINGS, inkOpacity: 96 }, previews)

        const tool = makeTool(toolDefinition('rect'), host)
        tool.begin(2, 2, NO_MODS)
        tool.move(6, 6, NO_MODS)
        tool.end(6, 6, NO_MODS)

        expect(previews.length).toBeGreaterThan(0)
        expect(getPixel(sprite, layer, frame, 2, 2)).toBe(previews.at(-1))
    })

    it('gives a definition-only flood the tolerance and contiguity it was handed', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        const layer = sprite.layers[0]!.id
        const frame = sprite.frames[0]!.id
        for (let y = 0; y < 16; y++) writePixel(sprite, layer, frame, 8, y, rgba(0, 0, 255))

        const host = paintingHost(sprite, { ...SETTINGS, fillContiguous: true })
        makeTool(toolDefinition('bucket'), host).begin(0, 0, NO_MODS)

        expect(getPixel(sprite, layer, frame, 7, 0)).toBe(RED)
        expect(getPixel(sprite, layer, frame, 9, 0)).toBe(0)
    })
})
