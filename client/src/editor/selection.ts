import { TRANSPARENT, type CelCursor, type RGBA } from '@starforge/core'

export interface SelRect {
    x: number
    y: number
    w: number
    h: number
}

export interface SelectionView {
    readonly rect: SelRect | null
    readonly offsetX: number
    readonly offsetY: number
    readonly floatBuffer: Uint32Array | null
}

export function normalizeSelection(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    width: number,
    height: number,
): SelRect | null {
    const minX = Math.max(0, Math.min(x0, x1))
    const minY = Math.max(0, Math.min(y0, y1))

    const maxX = Math.min(width - 1, Math.max(x0, x1))
    const maxY = Math.min(height - 1, Math.max(y0, y1))

    if (maxX < minX || maxY < minY) return null

    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

export function liftRegion(cursor: CelCursor, rect: SelRect): Uint32Array {
    const buffer = new Uint32Array(rect.w * rect.h)
    for (let dy = 0; dy < rect.h; dy++) {
        for (let dx = 0; dx < rect.w; dx++) {
            const color = cursor.get(rect.x + dx, rect.y + dy)
            buffer[dy * rect.w + dx] = color
            cursor.set(rect.x + dx, rect.y + dy, TRANSPARENT)
        }
    }
    return buffer
}

export function stampRegion(
    cursor: CelCursor,
    buffer: Uint32Array,
    rect: SelRect,
    offsetX: number,
    offsetY: number,
): void {
    for (let dy = 0; dy < rect.h; dy++) {
        for (let dx = 0; dx < rect.w; dx++) {
            const color: RGBA = buffer[dy * rect.w + dx]!
            if ((color & 0xff) === 0) continue
            cursor.set(rect.x + dx + offsetX, rect.y + dy + offsetY, color)
        }
    }
}
