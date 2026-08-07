import { TRANSPARENT, rgba, type RGBA } from './color'
import { getFrame, getLayer, type Cel, type Sprite } from './doc'
import type { CellWrite } from './ops'

export interface CelCursor {
    readonly width: number
    readonly height: number

    get(x: number, y: number): RGBA
    set(x: number, y: number, color: RGBA): void
}

export function openCursor(
    sprite: Sprite,
    layerId: string,
    frameId: string,
    onWrite?: (write: CellWrite) => void,
): CelCursor {
    const layer = getLayer(sprite, layerId)
    getFrame(sprite, frameId)
    const width = sprite.width
    const height = sprite.height
    let cel: Cel | undefined = layer.cels.get(frameId)

    const inBounds = (x: number, y: number): boolean =>
        Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height

    const read = (x: number, y: number): RGBA => {
        if (!cel) return TRANSPARENT

        const p = cel.pixels
        const o = (y * width + x) * 4

        return rgba(p[o]!, p[o + 1]!, p[o + 2]!, p[o + 3])
    }

    return {
        width,
        height,

        get(x, y) {
            return inBounds(x, y) ? read(x, y) : TRANSPARENT
        },

        set(x, y, color) {
            if (!inBounds(x, y)) return

            const after = color >>> 0
            const before = read(x, y)
            if (before === after) return

            if (!cel) {
                cel = { x: 0, y: 0, pixels: new Uint8Array(width * height * 4), version: 0 }
                layer.cels.set(frameId, cel)
            }

            const o = (y * width + x) * 4
            cel.pixels[o] = after >>> 24
            cel.pixels[o + 1] = (after >>> 16) & 0xff
            cel.pixels[o + 2] = (after >>> 8) & 0xff
            cel.pixels[o + 3] = after & 0xff
            cel.version++

            onWrite?.({ layer: layerId, frame: frameId, x, y, before, after })
        },
    }
}
