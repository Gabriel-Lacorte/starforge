import { getCel, type Sprite } from './doc'
import { fillMask, type FillOptions } from './fill'
import { plotEllipse } from './geom'
import type { DirtyRect } from './ops'

export type MaskMode = 'replace' | 'add' | 'subtract' | 'intersect'

export interface MaskPoint {
    readonly x: number
    readonly y: number
}

export interface SelectionMask {
    readonly width: number
    readonly height: number
    /** 0 or 1 per cell */
    readonly cells: Uint8Array
    /** the box around the selection, or nothing is selected */
    readonly bounds: DirtyRect | null
}

export function emptyMask(width: number, height: number): SelectionMask {
    return sealMask(width, height, new Uint8Array(width * height))
}

export function allMask(width: number, height: number): SelectionMask {
    const cells = new Uint8Array(width * height)
    cells.fill(1)

    return sealMask(width, height, cells)
}

export function rectMask(
    width: number,
    height: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
): SelectionMask {
    const cells = new Uint8Array(width * height)

    const left = Math.max(0, Math.min(x0, x1))
    const right = Math.min(width - 1, Math.max(x0, x1))
    const top = Math.max(0, Math.min(y0, y1))
    const bottom = Math.min(height - 1, Math.max(y0, y1))
    if (right < left || bottom < top) return sealMask(width, height, cells)

    for (let y = top; y <= bottom; y++) cells.fill(1, y * width + left, y * width + right + 1)

    return {
        width,
        height,
        cells,
        bounds: { x: left, y: top, w: right - left + 1, h: bottom - top + 1 },
    }
}

export function ellipseMask(
    width: number,
    height: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
): SelectionMask {
    const cells = new Uint8Array(width * height)
    plotEllipse(x0, y0, x1, y1, true, (x, y) => {
        mark(cells, width, height, x, y)
    })

    return sealMask(width, height, cells)
}

export function polygonMask(
    width: number,
    height: number,
    points: readonly MaskPoint[],
): SelectionMask {
    const cells = new Uint8Array(width * height)
    if (points.length < 3) return sealMask(width, height, cells)

    const starting: number[][] = Array.from({ length: height }, () => [])
    const edges: MaskPoint[][] = []

    for (const [index, a] of points.entries()) {
        const b = points[(index + 1) % points.length]!
        const top = Math.min(a.y, b.y)
        const bottom = Math.max(a.y, b.y)

        const first = Math.max(0, Math.ceil(top - 0.5))
        if (first >= height || bottom <= top) continue

        edges.push([a, b])
        starting[first]!.push(edges.length - 1)
    }

    let active: number[] = []
    const crossings: number[] = []

    for (let y = 0; y < height; y++) {
        const line = y + 0.5
        active.push(...starting[y]!)
        if (active.length === 0) continue

        crossings.length = 0
        const surviving: number[] = []
        for (const index of active) {
            const [a, b] = edges[index] as [MaskPoint, MaskPoint]
            if (Math.max(a.y, b.y) <= line) continue

            surviving.push(index)
            if (a.y <= line === b.y <= line) continue
            crossings.push(a.x + ((line - a.y) * (b.x - a.x)) / (b.y - a.y))
        }
        active = surviving

        crossings.sort((left, right) => left - right)
        for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
            const from = Math.max(0, Math.ceil(crossings[pair]! - 0.5))
            const to = Math.min(width - 1, Math.ceil(crossings[pair + 1]! - 0.5) - 1)
            for (let x = from; x <= to; x++) cells[y * width + x] = 1
        }
    }

    return sealMask(width, height, cells)
}

export function wandMask(
    sprite: Sprite,
    layerId: string,
    frameId: string,
    x: number,
    y: number,
    options: FillOptions,
): SelectionMask {
    const { tolerance, contiguous } = options
    if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 255) {
        throw new RangeError(`wand tolerance must be an integer in 0..255, got ${tolerance}`)
    }

    const cel = getCel(sprite, layerId, frameId)
    const cells = fillMask(
        sprite.width,
        sprite.height,
        cel?.pixels ?? null,
        x,
        y,
        tolerance,
        contiguous,
    )

    return sealMask(sprite.width, sprite.height, cells)
}

export function translateMask(mask: SelectionMask, dx: number, dy: number): SelectionMask {
    if (dx === 0 && dy === 0) return mask

    const { width, height } = mask
    const cells = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (mask.cells[y * width + x] !== 1) continue
            mark(cells, width, height, x + dx, y + dy)
        }
    }

    return sealMask(width, height, cells)
}

export function invertMask(mask: SelectionMask): SelectionMask {
    const cells = new Uint8Array(mask.cells.length)
    for (let cell = 0; cell < cells.length; cell++) cells[cell] = mask.cells[cell] ? 0 : 1

    return sealMask(mask.width, mask.height, cells)
}

export function combineMasks(
    base: SelectionMask,
    incoming: SelectionMask,
    mode: MaskMode,
): SelectionMask {
    if (base.width !== incoming.width || base.height !== incoming.height) {
        throw new Error('masks of different documents cannot be combined')
    }
    if (mode === 'replace') return incoming

    const cells = new Uint8Array(base.cells.length)
    for (let cell = 0; cell < cells.length; cell++) {
        const left = base.cells[cell]!
        const right = incoming.cells[cell]!
        cells[cell] =
            mode === 'add'
                ? left | right
                : mode === 'subtract'
                  ? left & (right ? 0 : 1)
                  : left & right
    }

    return sealMask(base.width, base.height, cells)
}

export interface MaskEdge {
    readonly x1: number
    readonly y1: number
    readonly x2: number
    readonly y2: number
}

export function maskOutline(mask: SelectionMask): readonly MaskEdge[] {
    const edges: MaskEdge[] = []
    const { width, height, cells } = mask

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (cells[y * width + x] !== 1) continue

            if (!isSelected(mask, x, y - 1)) edges.push({ x1: x, y1: y, x2: x + 1, y2: y })
            if (!isSelected(mask, x, y + 1)) {
                edges.push({ x1: x, y1: y + 1, x2: x + 1, y2: y + 1 })
            }
            if (!isSelected(mask, x - 1, y)) edges.push({ x1: x, y1: y, x2: x, y2: y + 1 })
            if (!isSelected(mask, x + 1, y)) {
                edges.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1 })
            }
        }
    }

    return edges
}

export function isSelected(mask: SelectionMask, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false

    return mask.cells[y * mask.width + x] === 1
}

export function isEmptyMask(mask: SelectionMask): boolean {
    return mask.bounds === null
}

function mark(cells: Uint8Array, width: number, height: number, x: number, y: number): void {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    cells[y * width + x] = 1
}

export function sealMask(width: number, height: number, cells: Uint8Array): SelectionMask {
    const first = cells.indexOf(1)
    if (first < 0) return { width, height, cells, bounds: null }

    const last = cells.lastIndexOf(1)
    const minY = Math.floor(first / width)
    const maxY = Math.floor(last / width)

    let minX = width
    let maxX = -1
    for (let y = minY; y <= maxY && (minX > 0 || maxX < width - 1); y++) {
        const row = y * width
        const start = cells.indexOf(1, row)
        if (start < 0 || start >= row + width) continue

        if (start - row < minX) minX = start - row
        const end = cells.lastIndexOf(1, row + width - 1)
        if (end - row > maxX) maxX = end - row
    }

    return {
        width,
        height,
        cells,
        bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    }
}
