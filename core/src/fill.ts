import type { RGBA } from './color'
import { openCursor } from './cursor'
import { getCel, inBounds, type Sprite } from './doc'
import { applyInk, type InkContext } from './ink'
import { getPixel, type CellWrite } from './ops'

export interface FillOptions {
    tolerance: number
    contiguous: boolean
}

export function fillMask(
    width: number,
    height: number,
    pixels: Uint8Array | null,
    seedX: number,
    seedY: number,
    tolerance: number,
    contiguous: boolean,
): Uint8Array {
    if (
        !Number.isInteger(seedX) ||
        !Number.isInteger(seedY) ||
        seedX < 0 ||
        seedY < 0 ||
        seedX >= width ||
        seedY >= height
    )
        throw new RangeError(`fill seed (${seedX}, ${seedY}) outside ${width}*${height}`)

    const mask = new Uint8Array(width * height)
    if (!pixels) {
        mask.fill(1)
        return mask
    }

    const so = (seedY * width + seedX) * 4
    const sr = pixels[so]!
    const sg = pixels[so + 1]!
    const sb = pixels[so + 2]!
    const sa = pixels[so + 3]!

    const matches = (cell: number): boolean => {
        const o = cell * 4

        return (
            Math.abs(pixels[o]! - sr) <= tolerance &&
            Math.abs(pixels[o + 1]! - sg) <= tolerance &&
            Math.abs(pixels[o + 2]! - sb) <= tolerance &&
            Math.abs(pixels[o + 3]! - sa) <= tolerance
        )
    }

    if (!contiguous) {
        for (let cell = 0; cell < mask.length; cell++) {
            if (matches(cell)) mask[cell] = 1
        }

        return mask
    }

    const stack = [seedY * width + seedX]

    const pushRunSeeds = (rowStart: number, lx: number, rx: number): void => {
        let inRun = false

        for (let x = lx; x <= rx; x++) {
            const cell = rowStart + x
            const candidate = !mask[cell] && matches(cell)
            if (candidate && !inRun) {
                stack.push(cell)
                inRun = true
            } else if (!candidate) {
                inRun = false
            }
        }
    }

    for (let cell = stack.pop(); cell !== undefined; cell = stack.pop()) {
        if (mask[cell]) continue

        const x = cell % width
        const rowStart = cell - x

        let lx = x
        let rx = x

        while (lx > 0 && !mask[rowStart + lx - 1] && matches(rowStart + lx - 1)) lx--
        while (rx < width - 1 && !mask[rowStart + rx + 1] && matches(rowStart + rx + 1)) rx++

        mask.fill(1, rowStart + lx, rowStart + rx + 1)

        if (rowStart >= width) pushRunSeeds(rowStart - width, lx, rx)
        if (rowStart < width * (height - 1)) pushRunSeeds(rowStart + width, lx, rx)
    }

    return mask
}

export function floodFill(
    sprite: Sprite,
    layerId: string,
    frameId: string,
    x: number,
    y: number,
    color: RGBA,
    options: FillOptions,
): CellWrite[] {
    return floodFillResolved(sprite, layerId, frameId, x, y, options, () => color >>> 0)
}

export function floodFillInk(
    sprite: Sprite,
    layerId: string,
    frameId: string,
    x: number,
    y: number,
    context: InkContext,
    options: FillOptions,
): CellWrite[] {
    return floodFillResolved(sprite, layerId, frameId, x, y, options, (before) =>
        applyInk(before, context),
    )
}

function floodFillResolved(
    sprite: Sprite,
    layerId: string,
    frameId: string,
    x: number,
    y: number,
    options: FillOptions,
    resolve: (before: RGBA) => RGBA,
): CellWrite[] {
    const { tolerance, contiguous } = options
    if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 255)
        throw new RangeError(`fill tolerance must be an integer in 0..255, got ${tolerance}`)

    if (!inBounds(sprite, x, y)) return []

    const seed = getPixel(sprite, layerId, frameId, x, y)
    if (tolerance === 0 && resolve(seed) === seed) return []

    const cel = getCel(sprite, layerId, frameId)
    const mask = fillMask(
        sprite.width,
        sprite.height,
        cel?.pixels ?? null,
        x,
        y,
        tolerance,
        contiguous,
    )

    const writes: CellWrite[] = []
    const width = sprite.width
    const cursor = openCursor(sprite, layerId, frameId, (w) => writes.push(w))

    for (let cell = 0; cell < mask.length; cell++) {
        if (!mask[cell]) continue

        const cx = cell % width
        const cy = (cell - cx) / width
        cursor.set(cx, cy, resolve(cursor.get(cx, cy)))
    }

    return writes
}
