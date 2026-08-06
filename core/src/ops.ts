import { TRANSPARENT, rgba, type RGBA } from './color'
import { getCel, getLayer, inBounds, type Cel, type Sprite } from './doc'

export interface CellWrite {
    layer: string
    frame: string

    x: number
    y: number

    before: RGBA
    after: RGBA
}

export function writePixel(
    sprite: Sprite,
    layerId: string,
    frameId: string,
    x: number,
    y: number,
    color: RGBA,
): CellWrite | null {
    if (!inBounds(sprite, x, y)) return null

    const after = color >>> 0
    const before = getPixel(sprite, layerId, frameId, x, y)
    if (before === after) return null

    const cel = ensureCel(sprite, layerId, frameId)
    setPixelBytes(cel.pixels, sprite.width, x, y, after)
    cel.version++

    return {
        layer: layerId,
        frame: frameId,
        x,
        y,
        before,
        after,
    }
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
    const o = pixelOffset(sprite.width, x, y)

    return rgba(p[o] ?? 0, p[o + 1] ?? 0, p[o + 2] ?? 0, p[o + 3] ?? 0)
}

function setPixelBytes(pixels: Uint8Array, width: number, x: number, y: number, color: RGBA): void {
    const o = pixelOffset(width, x, y)

    pixels[o] = color >>> 24
    pixels[o + 1] = (color >> 16) & 0xff
    pixels[o + 2] = (color >> 8) & 0xff
    pixels[o + 3] = color & 0xff
}

function pixelOffset(width: number, x: number, y: number): number {
    return (y * width + x) * 4
}

function ensureCel(sprite: Sprite, layerId: string, frameId: string): Cel {
    const existing = getCel(sprite, layerId, frameId)
    if (existing) return existing

    const cel: Cel = {
        x: 0,
        y: 0,
        pixels: new Uint8Array(sprite.width * sprite.height * 4),
        version: 0,
    }

    getLayer(sprite, layerId).cels.set(frameId, cel)
    return cel
}
