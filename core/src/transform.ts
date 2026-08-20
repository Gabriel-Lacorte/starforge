import { isSelected, sealMask, type SelectionMask } from './mask'
import type { DirtyRect } from './ops'

export type TransformKind = 'flip-h' | 'flip-v' | 'rotate-cw' | 'rotate-ccw' | 'rotate-180'

export interface TransformedRegion {
    readonly pixels: Uint32Array
    readonly width: number
    readonly height: number
}

export function transformPlacement(bounds: DirtyRect, kind: TransformKind): DirtyRect {
    const turned = kind === 'rotate-cw' || kind === 'rotate-ccw'
    const w = turned ? bounds.h : bounds.w
    const h = turned ? bounds.w : bounds.h

    return {
        x: bounds.x + Math.floor((bounds.w - w) / 2),
        y: bounds.y + Math.floor((bounds.h - h) / 2),
        w,
        h,
    }
}

export function transformRegion(
    pixels: Uint32Array,
    width: number,
    height: number,
    kind: TransformKind,
): TransformedRegion {
    if (pixels.length !== width * height) {
        throw new RangeError(`region is ${pixels.length} cells, expected ${width * height}`)
    }

    const turned = kind === 'rotate-cw' || kind === 'rotate-ccw'
    const outWidth = turned ? height : width
    const outHeight = turned ? width : height
    const out = new Uint32Array(pixels.length)

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [dx, dy] = destination(x, y, width, height, kind)
            out[dy * outWidth + dx] = pixels[y * width + x]!
        }
    }

    return { pixels: out, width: outWidth, height: outHeight }
}

export function transformMask(mask: SelectionMask, kind: TransformKind): SelectionMask {
    const bounds = mask.bounds
    if (!bounds) return mask

    const region = new Uint32Array(bounds.w * bounds.h)
    for (let y = 0; y < bounds.h; y++) {
        for (let x = 0; x < bounds.w; x++) {
            region[y * bounds.w + x] = isSelected(mask, bounds.x + x, bounds.y + y) ? 1 : 0
        }
    }

    const moved = transformRegion(region, bounds.w, bounds.h, kind)
    const placed = transformPlacement(bounds, kind)
    const cells = new Uint8Array(mask.cells.length)

    for (let y = 0; y < moved.height; y++) {
        for (let x = 0; x < moved.width; x++) {
            if (moved.pixels[y * moved.width + x] !== 1) continue

            const px = placed.x + x
            const py = placed.y + y
            if (px < 0 || py < 0 || px >= mask.width || py >= mask.height) continue
            cells[py * mask.width + px] = 1
        }
    }

    return sealMask(mask.width, mask.height, cells)
}

export function mirrorCells(
    x: number,
    y: number,
    width: number,
    height: number,
    horizontal: boolean,
    vertical: boolean,
): readonly (readonly [number, number])[] {
    const cells: (readonly [number, number])[] = [[x, y]]
    const mx = width - 1 - x
    const my = height - 1 - y

    if (horizontal && mx !== x) cells.push([mx, y])
    if (vertical && my !== y) cells.push([x, my])
    if (horizontal && vertical && mx !== x && my !== y) cells.push([mx, my])

    return cells
}

function destination(
    x: number,
    y: number,
    width: number,
    height: number,
    kind: TransformKind,
): readonly [number, number] {
    switch (kind) {
        case 'flip-h':
            return [width - 1 - x, y]
        case 'flip-v':
            return [x, height - 1 - y]
        case 'rotate-180':
            return [width - 1 - x, height - 1 - y]
        case 'rotate-cw':
            return [height - 1 - y, x]
        case 'rotate-ccw':
            return [y, width - 1 - x]
    }
}
