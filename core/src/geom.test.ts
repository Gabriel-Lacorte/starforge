import { describe, expect, it } from 'vitest'
import { brushCells, plotEllipse, plotLine, plotRect } from './geom'

function makeRng(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0
        return s / 0x100000000
    }
}

function collect(run: (plot: (x: number, y: number) => void) => void): {
    set: Set<string>
    calls: number
} {
    const set = new Set<string>()
    let calls = 0
    run((x, y) => {
        calls++
        set.add(`${x},${y}`)
    })
    return { set, calls }
}

function lineSet(x0: number, y0: number, x1: number, y1: number): Set<string> {
    return collect((plot) => {
        plotLine(x0, y0, x1, y1, plot)
    }).set
}

describe('plotLine', () => {
    it('draws horizontal, vertical and diagonal lines exactly', () => {
        expect([...lineSet(2, 5, 6, 5)].sort()).toEqual(['2,5', '3,5', '4,5', '5,5', '6,5'])
        expect([...lineSet(1, -1, 1, 2)].sort()).toEqual(['1,-1', '1,0', '1,1', '1,2'])
        expect([...lineSet(0, 0, 3, 3)].sort()).toEqual(['0,0', '1,1', '2,2', '3,3'])
        expect([...lineSet(4, 4, 4, 4)]).toEqual(['4,4'])
    })

    it('always plots both endpoints, never repeats a cell, and leaves no gaps', () => {
        const rng = makeRng(0xf00d)
        for (let i = 0; i < 250; i++) {
            const [x0, y0, x1, y1] = [0, 0, 0, 0].map(() => Math.floor(rng() * 65) - 32)
            const points: [number, number][] = []
            plotLine(x0!, y0!, x1!, y1!, (x, y) => points.push([x, y]))

            expect(points[0]).toEqual([x0, y0])
            expect(points[points.length - 1]).toEqual([x1, y1])
            expect(new Set(points.map(([x, y]) => `${x},${y}`)).size).toBe(points.length)
            for (let k = 1; k < points.length; k++) {
                const dx = Math.abs(points[k]![0] - points[k - 1]![0])
                const dy = Math.abs(points[k]![1] - points[k - 1]![1])
                expect(Math.max(dx, dy)).toBe(1)
            }
        }
    })

    it('is direction-independent as a set of cells', () => {
        const rng = makeRng(0xbeef)
        for (let i = 0; i < 250; i++) {
            const [x0, y0, x1, y1] = [0, 0, 0, 0].map(() => Math.floor(rng() * 65) - 32)
            expect(lineSet(x0!, y0!, x1!, y1!)).toEqual(lineSet(x1!, y1!, x0!, y0!))
        }
    })
})

function rectSet(x0: number, y0: number, x1: number, y1: number, filled: boolean): Set<string> {
    return collect((plot) => {
        plotRect(x0, y0, x1, y1, filled, plot)
    }).set
}

describe('plotRect', () => {
    it('normalizes a drag from any corner pair to the same cells', () => {
        const corners: [number, number, number, number][] = [
            [1, 2, 4, 6],
            [4, 6, 1, 2],
            [4, 2, 1, 6],
            [1, 6, 4, 2],
        ]
        for (const filled of [false, true]) {
            const sets = corners.map(([a, b, c, d]) => rectSet(a, b, c, d, filled))
            for (const set of sets) expect(set).toEqual(sets[0])
        }
    })

    it('fill covers the whole box; outline is exactly the border cells', () => {
        const fill = rectSet(1, 1, 4, 3, true)
        expect(fill.size).toBe(4 * 3)
        const outline = rectSet(1, 1, 4, 3, false)
        for (const cell of outline) expect(fill.has(cell)).toBe(true)
        expect(outline.size).toBe(4 * 3 - 2 * 1)
        expect(outline.has('2,2')).toBe(false)
        expect(outline.has('1,1')).toBe(true)
        expect(outline.has('4,3')).toBe(true)
    })

    it('degenerates to a line when width or height is 1, without double-plotting', () => {
        for (const filled of [false, true]) {
            expect(rectSet(2, 5, 6, 5, filled)).toEqual(lineSet(2, 5, 6, 5))
            expect(rectSet(3, -1, 3, 3, filled)).toEqual(lineSet(3, -1, 3, 3))
            const { set, calls } = collect((plot) => {
                plotRect(2, 5, 6, 5, filled, plot)
            })
            expect(calls).toBe(set.size)
        }
    })
})

function ellipseSet(x0: number, y0: number, x1: number, y1: number, filled: boolean): Set<string> {
    return collect((plot) => {
        plotEllipse(x0, y0, x1, y1, filled, plot)
    }).set
}

function bruteCircle(size: number): Set<string> {
    const set = new Set<string>()
    const c = size / 2
    const r2 = (size / 2) ** 2
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if ((x + 0.5 - c) ** 2 + (y + 0.5 - c) ** 2 <= r2) set.add(`${x},${y}`)
        }
    }
    return set
}

describe('plotEllipse', () => {
    it('normalizes the drag box like plotRect', () => {
        expect(ellipseSet(9, 7, 2, 1, true)).toEqual(ellipseSet(2, 1, 9, 7, true))
        expect(ellipseSet(9, 1, 2, 7, false)).toEqual(ellipseSet(2, 1, 9, 7, false))
    })

    it('has exact 4-fold symmetry in boxes of every parity', () => {
        for (const [w, h] of [
            [7, 5],
            [8, 5],
            [7, 6],
            [8, 6],
            [16, 16],
            [15, 4],
        ] as const) {
            for (const filled of [false, true]) {
                const set = ellipseSet(0, 0, w - 1, h - 1, filled)
                expect(set.size).toBeGreaterThan(0)
                for (const cell of set) {
                    const [x, y] = cell.split(',').map(Number) as [number, number]
                    expect(set.has(`${w - 1 - x},${y}`)).toBe(true)
                    expect(set.has(`${x},${h - 1 - y}`)).toBe(true)
                }
            }
        }
    })

    it('outline is a subset of fill and touches all four box edges', () => {
        for (const [w, h] of [
            [9, 6],
            [12, 12],
            [5, 11],
        ] as const) {
            const fill = ellipseSet(0, 0, w - 1, h - 1, true)
            const outline = ellipseSet(0, 0, w - 1, h - 1, false)
            for (const cell of outline) expect(fill.has(cell)).toBe(true)
            const xs = [...fill].map((c) => Number(c.split(',')[0]))
            const ys = [...fill].map((c) => Number(c.split(',')[1]))
            expect(Math.min(...xs)).toBe(0)
            expect(Math.max(...xs)).toBe(w - 1)
            expect(Math.min(...ys)).toBe(0)
            expect(Math.max(...ys)).toBe(h - 1)
        }
    })

    it('collapses to a straight line when the box is 1 cell wide or tall', () => {
        for (const filled of [false, true]) {
            expect(ellipseSet(2, 5, 8, 5, filled)).toEqual(lineSet(2, 5, 8, 5))
            expect(ellipseSet(4, 0, 4, 9, filled)).toEqual(lineSet(4, 0, 4, 9))
        }
    })

    it('matches a brute-force circle when the box is square', () => {
        for (const size of [1, 2, 3, 4, 5, 8, 13, 32, 64]) {
            expect(ellipseSet(0, 0, size - 1, size - 1, true)).toEqual(bruteCircle(size))
        }
    })

    it('row extents grow monotonically from the poles to the equator', () => {
        for (const [w, h] of [
            [17, 11],
            [16, 10],
            [31, 32],
        ] as const) {
            const fill = ellipseSet(0, 0, w - 1, h - 1, true)
            const widths: number[] = []
            for (let y = 0; y < h; y++) {
                widths.push([...fill].filter((c) => c.endsWith(`,${y}`)).length)
            }
            for (let y = 1; y < Math.floor(h / 2); y++) {
                expect(widths[y]!).toBeGreaterThanOrEqual(widths[y - 1]!)
            }
            expect(widths).toEqual([...widths].reverse())
        }
    })
})

describe('brushCells', () => {
    it('gives the exact known stamps for the small sizes', () => {
        expect(brushCells(1)).toEqual([{ x: 0, y: 0 }])
        const s2 = new Set(brushCells(2).map((p) => `${p.x},${p.y}`))
        expect(s2).toEqual(new Set(['0,0', '1,0', '0,1', '1,1']))
        expect(brushCells(3)).toHaveLength(9)
        expect(brushCells(4)).toHaveLength(12)
        expect(brushCells(5)).toHaveLength(21)
    })

    it('is the filled ellipse of the same box, anchored on the cursor cell', () => {
        for (const size of [1, 2, 3, 6, 9, 16, 33, 64]) {
            const anchor = Math.floor((size - 1) / 2)
            const shifted = new Set(brushCells(size).map((p) => `${p.x + anchor},${p.y + anchor}`))
            expect(shifted).toEqual(ellipseSet(0, 0, size - 1, size - 1, true))
        }
    })

    it('stays inside its own size*size box and includes the anchor cell', () => {
        for (let size = 1; size <= 64; size++) {
            const anchor = Math.floor((size - 1) / 2)
            const cells = brushCells(size)
            expect(cells.some((p) => p.x === 0 && p.y === 0)).toBe(true)
            for (const p of cells) {
                expect(p.x + anchor).toBeGreaterThanOrEqual(0)
                expect(p.x + anchor).toBeLessThan(size)
                expect(p.y + anchor).toBeGreaterThanOrEqual(0)
                expect(p.y + anchor).toBeLessThan(size)
            }
        }
    })
})
