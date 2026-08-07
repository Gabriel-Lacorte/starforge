export interface Point {
    x: number
    y: number
}

export type Plot = (x: number, y: number) => void

export function plotLine(x0: number, y0: number, x1: number, y1: number, plot: Plot): void {
    if (x1 < x0 || (x1 === x0 && y1 < y0)) {
        const points: number[] = []
        plotLine(x1, y1, x0, y0, (x, y) => points.push(x, y))
        for (let i = points.length - 2; i >= 0; i -= 2) plot(points[i]!, points[i + 1]!)
        return
    }

    const dx = Math.abs(x1 - x0)
    const sx = x0 < x1 ? 1 : -1
    const dy = -Math.abs(y1 - y0)
    const sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    for (;;) {
        plot(x0, y0)
        if (x0 === x1 && y0 === y1) return
        const e2 = 2 * err
        if (e2 >= dy) {
            err += dy
            x0 += sx
        }
        if (e2 <= dx) {
            err += dx
            y0 += sy
        }
    }
}

export function plotRect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    filled: boolean,
    plot: Plot,
): void {
    const minX = Math.min(x0, x1)
    const maxX = Math.max(x0, x1)
    const minY = Math.min(y0, y1)
    const maxY = Math.max(y0, y1)
    if (filled) {
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                plot(x, y)
            }
        }
        return
    }

    for (let x = minX; x <= maxX; x++) plot(x, minY)
    if (maxY > minY) {
        for (let x = minX; x <= maxX; x++) plot(x, maxY)
    }

    for (let y = minY + 1; y < maxY; y++) {
        plot(minX, y)
        if (maxX > minX) plot(maxX, y)
    }
}

export function plotEllipse(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    filled: boolean,
    plot: Plot,
): void {
    const minX = Math.min(x0, x1)
    const minY = Math.min(y0, y1)

    const w = Math.abs(x1 - x0) + 1
    const h = Math.abs(y1 - y0) + 1

    const rhs = w * h * (w * h)

    const inside = (x: number, y: number): boolean => {
        if (x < 0 || y < 0 || x >= w || y >= h) return false
        const ex = (2 * x + 1 - w) * h
        const ey = (2 * y + 1 - h) * w
        return ex * ex + ey * ey <= rhs
    }

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (!inside(x, y)) continue

            if (
                filled ||
                !inside(x - 1, y) ||
                !inside(x + 1, y) ||
                !inside(x, y - 1) ||
                !inside(x, y + 1)
            ) {
                plot(minX + x, minY + y)
            }
        }
    }
}

export const BRUSH_MAX_SIZE = 64

const brushCache = new Map<number, readonly Point[]>()

export function brushCells(size: number): readonly Point[] {
    if (!Number.isInteger(size) || size < 1 || size > BRUSH_MAX_SIZE) {
        throw new RangeError(`brush size must be an integer in 1..${BRUSH_MAX_SIZE}, got ${size}`)
    }

    const cached = brushCache.get(size)
    if (cached) return cached

    const anchor = Math.floor((size - 1) / 2)
    const cells: Point[] = []
    plotEllipse(0, 0, size - 1, size - 1, true, (x, y) => {
        cells.push({ x: x - anchor, y: y - anchor })
    })
    brushCache.set(size, cells)

    return cells
}
