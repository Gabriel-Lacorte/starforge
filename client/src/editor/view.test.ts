import { describe, expect, it } from 'vitest'
import {
    ZOOM_LEVELS,
    createView,
    fitSprite,
    panBy,
    screenToSprite,
    spriteToScreen,
    stepZoom,
    zoomAt,
    type View,
} from './view'

function viewAt(panX: number, panY: number, zoom: View['zoom']): View {
    return { panX, panY, zoom }
}

describe('screenToSprite', () => {
    it('floors into cells, including left/above the sprite', () => {
        const view = viewAt(100, 50, 8)
        expect(screenToSprite(view, 100, 50)).toEqual({ x: 0, y: 0 })
        expect(screenToSprite(view, 107.9, 57.9)).toEqual({ x: 0, y: 0 })
        expect(screenToSprite(view, 108, 58)).toEqual({ x: 1, y: 1 })
        expect(screenToSprite(view, 99, 49)).toEqual({ x: -1, y: -1 })
    })

    it('inverts spriteToScreen anywhere inside the cell', () => {
        const view = viewAt(-37.25, 12.5, 4)
        for (const [x, y] of [
            [0, 0],
            [5, 9],
            [63, 1],
        ] as const) {
            const screen = spriteToScreen(view, x, y)
            expect(screenToSprite(view, screen.x + 3.99, screen.y + 0.01)).toEqual({ x, y })
        }
    })
})

describe('zoomAt', () => {
    it('keeps the sprite point under the cursor fixed', () => {
        const cases: { view: View; cx: number; cy: number; to: View['zoom'] }[] = [
            { view: viewAt(0, 0, 1), cx: 400, cy: 300, to: 2 },
            { view: viewAt(-120.5, 33.25, 8), cx: 512, cy: 384, to: 4 },
            { view: viewAt(250, -80, 16), cx: 10, cy: 990, to: 32 },
            { view: viewAt(7, 7, 4), cx: 0, cy: 0, to: 8 },
        ]
        for (const { view, cx, cy, to } of cases) {
            const anchor = { x: (cx - view.panX) / view.zoom, y: (cy - view.panY) / view.zoom }
            zoomAt(view, to, cx, cy)
            expect((cx - view.panX) / view.zoom).toBeCloseTo(anchor.x, 9)
            expect((cy - view.panY) / view.zoom).toBeCloseTo(anchor.y, 9)
        }
    })
})

describe('stepZoom', () => {
    it('walks the zoom ladder and clamps at both ends', () => {
        const view = viewAt(0, 0, 1)
        stepZoom(view, -1, 0, 0)
        expect(view.zoom).toBe(1)

        for (const expected of [2, 4, 8, 16, 32]) {
            stepZoom(view, 1, 0, 0)
            expect(view.zoom).toBe(expected)
        }
        stepZoom(view, 1, 0, 0)
        expect(view.zoom).toBe(32)
    })

    it('anchors each step at the cursor', () => {
        const view = viewAt(-3.75, 41, 4)
        const anchor = screenToSprite(view, 200, 200)
        stepZoom(view, 1, 200, 200)
        expect(screenToSprite(view, 200, 200)).toEqual(anchor)
    })
})

describe('panBy', () => {
    it('accumulates fractional deltas', () => {
        const view = viewAt(0, 0, 8)
        panBy(view, 0.25, -1.5)
        panBy(view, 0.25, -1.5)
        expect(view.panX).toBeCloseTo(0.5)
        expect(view.panY).toBeCloseTo(-3)
    })
})

describe('fitSprite', () => {
    it('picks the largest level that fits and centers the sprite', () => {
        const view = createView()
        fitSprite(view, 64, 64, 600, 600)
        expect(view.zoom).toBe(8)
        expect(view.panX).toBe((600 - 512) / 2)
        expect(view.panY).toBe((600 - 512) / 2)
    })

    it('falls back to 1× when the sprite overflows the viewport', () => {
        const view = createView()
        fitSprite(view, 1024, 1024, 500, 500)
        expect(view.zoom).toBe(1)
    })

    it('never exceeds the top zoom level', () => {
        const view = createView()
        fitSprite(view, 16, 16, 4096, 4096)
        expect(view.zoom).toBe(ZOOM_LEVELS[ZOOM_LEVELS.length - 1])
    })
})
