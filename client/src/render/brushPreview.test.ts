import { describe, expect, it } from 'vitest'
import {
    BACKDROP_LUMA,
    brushCursorFor,
    compositeLuma,
    cursorContrast,
    CURSOR_MID_HI,
    CURSOR_MID_LO,
    CURSOR_TRAIL_EASE,
    easeCursor,
    stampEdges,
} from './brushPreview'

describe('brushCursorFor', () => {
    it('sizes the cursor by the tool that stamps', () => {
        const settings = { tool: 'pencil' as const, brushSize: 5, eraserSize: 2 }
        expect(brushCursorFor(settings, { x: 3, y: 4 })).toEqual({
            x: 3,
            y: 4,
            size: 5,
            shape: 'brush',
        })

        const eraser = { ...settings, tool: 'eraser' as const }
        expect(brushCursorFor(eraser, { x: 0, y: 0 })).toEqual({
            x: 0,
            y: 0,
            size: 2,
            shape: 'brush',
        })
    })

    it('collapses to a single cell for tools that act on one pixel', () => {
        for (const tool of ['eyedropper', 'bucket'] as const) {
            expect(brushCursorFor({ tool, brushSize: 9, eraserSize: 9 }, { x: 1, y: 2 })).toEqual({
                x: 1,
                y: 2,
                size: 1,
                shape: 'cell',
            })
        }
    })

    it('promises nothing for marquee tools, which neither stamp nor sample', () => {
        for (const tool of ['select', 'selectEllipse', 'lasso', 'wand'] as const) {
            expect(brushCursorFor({ tool, brushSize: 9, eraserSize: 9 }, { x: 1, y: 2 })).toBeNull()
        }
    })

    it('shows the brush footprint for shape tools, whose strokes use it', () => {
        for (const tool of ['line', 'rect', 'ellipse'] as const) {
            const cursor = brushCursorFor({ tool, brushSize: 4, eraserSize: 1 }, { x: 0, y: 0 })
            expect(cursor).toEqual({ x: 0, y: 0, size: 4, shape: 'brush' })
        }
    })
})

describe('easeCursor', () => {
    it('closes a fraction of the gap each step and settles near the target', () => {
        let pos = { x: 0, y: 0 }
        const target = { x: 10, y: 0 }
        let steps = 0

        for (;;) {
            const next = easeCursor(pos, target)
            if (!next) break
            pos = next
            steps++
            if (steps > 100) throw new Error('the cursor never settled')
        }

        expect(steps).toBeGreaterThan(1)
        expect(pos.x).toBeGreaterThan(10 - 0.2)
        expect(pos.x).toBeLessThanOrEqual(10)
    })

    it('returns null exactly at the target', () => {
        expect(easeCursor({ x: 4, y: 5 }, { x: 4, y: 5 })).toBeNull()
    })

    it('snaps a settled axis while the other still eases', () => {
        const next = easeCursor({ x: 10, y: 0 }, { x: 10, y: 6 })
        expect(next).toEqual({ x: 10, y: 6 * CURSOR_TRAIL_EASE })
    })
})

describe('stampEdges', () => {
    it('outlines a single cell as a closed square', () => {
        expect(stampEdges(1)).toEqual([
            { x1: 0, y1: 0, x2: 1, y2: 0 },
            { x1: 0, y1: 1, x2: 1, y2: 1 },
            { x1: 0, y1: 0, x2: 0, y2: 1 },
            { x1: 1, y1: 0, x2: 1, y2: 1 },
        ])
    })

    it('traces only edges that face an empty cell', () => {
        const edges = stampEdges(4)
        const has = (x1: number, y1: number, x2: number, y2: number) =>
            edges.some((e) => e.x1 === x1 && e.y1 === y1 && e.x2 === x2 && e.y2 === y2)

        expect(has(0, -1, 1, -1)).toBe(true)
        expect(has(-1, -1, 0, -1)).toBe(false)
        expect(has(0, -1, 0, 0)).toBe(true)

        expect(has(0, 0, 1, 0)).toBe(false)
    })
})

describe('cursorContrast', () => {
    it('leaves the extremes to the difference blend alone', () => {
        expect(cursorContrast(0)).toBeNull()
        expect(cursorContrast(CURSOR_MID_LO - 1)).toBeNull()
        expect(cursorContrast(CURSOR_MID_HI + 1)).toBeNull()
        expect(cursorContrast(255)).toBeNull()
    })

    it('pushes the mid band toward the extreme that contrasts more', () => {
        expect(cursorContrast(100)).toBe('#ffffff')
        expect(cursorContrast(128)).toBe('#ffffff')
        expect(cursorContrast(150)).toBe('#000000')
    })

    it('blends the ink against the transparency checker backdrop', () => {
        expect(compositeLuma({ r: 0, g: 0, b: 0, a: 0 })).toBe(BACKDROP_LUMA)
        expect(compositeLuma({ r: 255, g: 255, b: 255, a: 255 })).toBeCloseTo(255, 6)
        const half = compositeLuma({ r: 0, g: 0, b: 0, a: 128 })
        expect(half).toBeCloseTo(BACKDROP_LUMA * (1 - 128 / 255), 6)
    })
})
