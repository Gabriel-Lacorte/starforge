import { TRANSPARENT, rgba, type RGBA } from './color'
import { openCursor } from './cursor'
import { getCel, inBounds, type Sprite } from './doc'

export interface CellWrite {
    layer: string
    frame: string

    x: number
    y: number

    before: RGBA
    after: RGBA
}

export interface DirtyRect {
    x: number
    y: number
    w: number
    h: number
}

export function writePixel(
    sprite: Sprite,
    layerId: string,
    frameId: string,
    x: number,
    y: number,
    color: RGBA,
): CellWrite | null {
    let result: CellWrite | null = null
    openCursor(sprite, layerId, frameId, (w) => {
        result = w
    }).set(x, y, color)

    return result
}

export function applyWrite(sprite: Sprite, write: CellWrite): void {
    writePixel(sprite, write.layer, write.frame, write.x, write.y, write.after)
}

export function invertWrite(write: CellWrite): CellWrite {
    return {
        ...write,
        before: write.after,
        after: write.before,
    }
}

export function getPixel(
    sprite: Sprite,
    layerId: string,
    frameId: string,
    x: number,
    y: number,
): RGBA {
    const cel = getCel(sprite, layerId, frameId)
    if (!cel || !inBounds(sprite, x, y)) return TRANSPARENT

    const p = cel.pixels
    const o = (y * sprite.width + x) * 4

    return rgba(p[o] ?? 0, p[o + 1] ?? 0, p[o + 2] ?? 0, p[o + 3] ?? 0)
}
