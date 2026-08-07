import { describe, expect, it } from 'vitest'
import { TRANSPARENT, rgba, type RGBA } from './color'
import { createSprite, getCel } from './doc'
import { fillMask, floodFill } from './fill'
import { getPixel, writePixel } from './ops'

const A = rgba(255, 0, 0)
const B = rgba(0, 255, 0)
const C = rgba(0, 0, 255)

function makeRng(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0
        return s / 0x100000000
    }
}

function buffer(w: number, h: number, colorAt: (x: number, y: number) => RGBA): Uint8Array {
    const pixels = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const c = colorAt(x, y) >>> 0
            const o = (y * w + x) * 4
            pixels[o] = c >>> 24
            pixels[o + 1] = (c >>> 16) & 0xff
            pixels[o + 2] = (c >>> 8) & 0xff
            pixels[o + 3] = c & 0xff
        }
    }
    return pixels
}

function maskCells(mask: Uint8Array, w: number): Set<string> {
    const set = new Set<string>()
    mask.forEach((v, i) => {
        if (v) set.add(`${i % w},${(i - (i % w)) / w}`)
    })
    return set
}

describe('scanline', () => {
    it('T=255 selects every cell of any grid and terminates', () => {
        const rng = makeRng(0xace)
        const pixels = buffer(16, 16, () =>
            rgba(rng() * 256, rng() * 256, rng() * 256, rng() * 256),
        )
        const mask = fillMask(16, 16, pixels, 5, 5, 255, true)
        expect(mask.every((v) => v === 1)).toBe(true)
    })

    it('selects a single cell on a checkerboard with T=0', () => {
        const pixels = buffer(16, 16, (x, y) => ((x + y) % 2 === 0 ? A : B))
        const mask = fillMask(16, 16, pixels, 4, 6, 0, true)
        expect(maskCells(mask, 16)).toEqual(new Set(['4,6']))
    })

    it('handles 1*N and N*1 grids, stopping at a wall', () => {
        const row = buffer(9, 1, (x) => (x === 6 ? A : TRANSPARENT))
        expect(maskCells(fillMask(9, 1, row, 2, 0, 0, true), 9)).toEqual(
            new Set(['0,0', '1,0', '2,0', '3,0', '4,0', '5,0']),
        )
        const col = buffer(1, 9, (_x, y) => (y === 6 ? A : TRANSPARENT))
        expect(maskCells(fillMask(1, 9, col, 0, 8, 0, true), 1)).toEqual(new Set(['0,7', '0,8']))
    })

    it('treats a missing cel (null pixels) as an all-transparent grid', () => {
        const mask = fillMask(8, 8, null, 3, 3, 0, true)
        expect(mask.every((v) => v === 1)).toBe(true)
    })

    it('tolerance is per-channel max distance and includes alpha', () => {
        const nearSeed = rgba(100, 100, 100, 255)
        const offByAlpha = rgba(100, 100, 100, 200)
        const pixels = buffer(3, 1, (x) => [nearSeed, offByAlpha, nearSeed][x]!)
        expect(maskCells(fillMask(3, 1, pixels, 0, 0, 54, true), 3)).toEqual(new Set(['0,0']))
        expect(maskCells(fillMask(3, 1, pixels, 0, 0, 55, true), 3)).toEqual(
            new Set(['0,0', '1,0', '2,0']),
        )
    })

    it('global mode selects every matching cell regardless of connectivity', () => {
        const pixels = buffer(8, 8, (x, y) => ((x + y) % 2 === 0 ? A : B))
        const mask = fillMask(8, 8, pixels, 0, 0, 0, false)
        const expected = new Set<string>()
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) if ((x + y) % 2 === 0) expected.add(`${x},${y}`)
        }
        expect(maskCells(mask, 8)).toEqual(expected)
    })

    it('rejects an out-of-bounds or fractional seed', () => {
        const pixels = buffer(4, 4, () => A)
        for (const [sx, sy] of [
            [-1, 0],
            [4, 0],
            [0, 4],
            [1.5, 1],
        ] as const) {
            expect(() => fillMask(4, 4, pixels, sx, sy, 0, true)).toThrow(RangeError)
        }
    })
})

describe('floodFill (sprite level)', () => {
    function sprite16() {
        const sprite = createSprite({ width: 16, height: 16 })
        return { sprite, layer: sprite.layers[0]!.id, frame: sprite.frames[0]!.id }
    }

    it('writes through the op pipeline with correct before colors', () => {
        const { sprite, layer, frame } = sprite16()
        const writes = floodFill(sprite, layer, frame, 0, 0, A, { tolerance: 0, contiguous: true })
        expect(writes).toHaveLength(16 * 16)
        expect(writes.every((w) => w.before === TRANSPARENT && w.after === A)).toBe(true)
        expect(getPixel(sprite, layer, frame, 15, 15)).toBe(A)
        expect(getCel(sprite, layer, frame)?.version).toBe(16 * 16)
    })

    it('is a no-op when T=0 and the seed already has the fill color', () => {
        const { sprite, layer, frame } = sprite16()
        floodFill(sprite, layer, frame, 0, 0, A, { tolerance: 0, contiguous: true })
        const version = getCel(sprite, layer, frame)!.version
        expect(
            floodFill(sprite, layer, frame, 8, 8, A, { tolerance: 0, contiguous: true }),
        ).toEqual([])
        expect(getCel(sprite, layer, frame)!.version).toBe(version)
    })

    it('skips cells that already hold the fill color inside a tolerant region', () => {
        const { sprite, layer, frame } = sprite16()
        const fill = rgba(255, 4, 0)
        floodFill(sprite, layer, frame, 0, 0, A, { tolerance: 0, contiguous: true })
        writePixel(sprite, layer, frame, 3, 3, fill)
        writePixel(sprite, layer, frame, 9, 12, fill)

        const writes = floodFill(sprite, layer, frame, 0, 0, fill, {
            tolerance: 8,
            contiguous: true,
        })
        expect(writes).toHaveLength(16 * 16 - 2)
        expect(new Set(writes.map((w) => w.before))).toEqual(new Set([A]))
        expect(getPixel(sprite, layer, frame, 3, 3)).toBe(fill)
    })

    it('returns [] for an out-of-bounds seed', () => {
        const { sprite, layer, frame } = sprite16()
        expect(
            floodFill(sprite, layer, frame, -1, 3, A, { tolerance: 0, contiguous: true }),
        ).toEqual([])
        expect(getCel(sprite, layer, frame)).toBeUndefined()
    })

    it('global mode crosses disconnected regions, contiguous does not', () => {
        const { sprite, layer, frame } = sprite16()
        floodFill(sprite, layer, frame, 0, 0, A, { tolerance: 0, contiguous: true })
        for (let x = 0; x < 16; x++) writePixel(sprite, layer, frame, x, 8, B)

        const contiguous = floodFill(sprite, layer, frame, 0, 0, C, {
            tolerance: 0,
            contiguous: true,
        })
        expect(contiguous).toHaveLength(16 * 8)
        expect(getPixel(sprite, layer, frame, 0, 15)).toBe(A)

        const global = floodFill(sprite, layer, frame, 0, 15, C, {
            tolerance: 0,
            contiguous: false,
        })
        expect(global).toHaveLength(16 * 7)
        expect(getPixel(sprite, layer, frame, 15, 15)).toBe(C)
        expect(getPixel(sprite, layer, frame, 0, 8)).toBe(B)
    })
})
