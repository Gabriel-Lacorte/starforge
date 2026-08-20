import { SPRITE_MAX_SIZE, SPRITE_MIN_SIZE, type Cel, type Layer, type Sprite } from './doc'

export type ResizeAnchor =
    | 'top-left'
    | 'top'
    | 'top-right'
    | 'left'
    | 'center'
    | 'right'
    | 'bottom-left'
    | 'bottom'
    | 'bottom-right'

export const RESIZE_ANCHORS: readonly ResizeAnchor[] = [
    'top-left',
    'top',
    'top-right',
    'left',
    'center',
    'right',
    'bottom-left',
    'bottom',
    'bottom-right',
]

export function anchorOffset(
    anchor: ResizeAnchor,
    fromWidth: number,
    fromHeight: number,
    toWidth: number,
    toHeight: number,
): readonly [number, number] {
    const dx = toWidth - fromWidth
    const dy = toHeight - fromHeight
    const x = anchor.endsWith('left') ? 0 : anchor.endsWith('right') ? dx : Math.floor(dx / 2)
    const y = anchor.startsWith('top') ? 0 : anchor.startsWith('bottom') ? dy : Math.floor(dy / 2)

    return [x, y]
}

export interface CanvasGeometry {
    readonly width: number
    readonly height: number
}

export interface CelPixels {
    readonly layer: string
    readonly frame: string
    readonly x: number
    readonly y: number
    readonly pixels: Uint8Array<ArrayBuffer>
}

export function checkCanvasSize(width: number, height: number): void {
    for (const [axis, value] of [
        ['width', width],
        ['height', height],
    ] as const) {
        if (!Number.isInteger(value) || value < SPRITE_MIN_SIZE || value > SPRITE_MAX_SIZE) {
            throw new RangeError(
                `canvas ${axis} must be an integer in ${SPRITE_MIN_SIZE}..${SPRITE_MAX_SIZE}, got ${String(value)}`,
            )
        }
    }
}

export function snapshotCels(sprite: Sprite): readonly CelPixels[] {
    const snapshots: CelPixels[] = []
    for (const layer of sprite.layers) {
        for (const [frame, cel] of layer.cels) {
            snapshots.push({
                layer: layer.id,
                frame,
                x: cel.x,
                y: cel.y,
                pixels: new Uint8Array(cel.pixels),
            })
        }
    }

    return snapshots
}

export function restoreCels(
    sprite: Sprite,
    geometry: CanvasGeometry,
    snapshots: readonly CelPixels[],
): void {
    checkCanvasSize(geometry.width, geometry.height)
    const bytes = geometry.width * geometry.height * 4
    for (const snapshot of snapshots) {
        if (snapshot.pixels.length !== bytes) {
            throw new RangeError(
                `cel snapshot is ${snapshot.pixels.length} bytes, expected ${bytes}`,
            )
        }
    }

    sprite.width = geometry.width
    sprite.height = geometry.height
    for (const layer of sprite.layers) layer.cels.clear()

    for (const snapshot of snapshots) {
        const layer = sprite.layers.find((candidate) => candidate.id === snapshot.layer)
        if (!layer) continue

        layer.cels.set(snapshot.frame, {
            x: snapshot.x,
            y: snapshot.y,
            pixels: new Uint8Array(snapshot.pixels),
            version: 0,
        })
    }
}

export function resizeCanvas(
    sprite: Sprite,
    geometry: CanvasGeometry,
    offsetX: number,
    offsetY: number,
): void {
    checkCanvasSize(geometry.width, geometry.height)
    rewriteCels(sprite, geometry, (pixels, from) =>
        offsetPixels(pixels, from, geometry, offsetX, offsetY),
    )
}

export function scaleCanvas(sprite: Sprite, geometry: CanvasGeometry): void {
    checkCanvasSize(geometry.width, geometry.height)
    rewriteCels(sprite, geometry, (pixels, from) => samplePixels(pixels, from, geometry))
}

function rewriteCels(
    sprite: Sprite,
    geometry: CanvasGeometry,
    rewrite: (pixels: Uint8Array, from: CanvasGeometry) => Uint8Array<ArrayBuffer>,
): void {
    const from = { width: sprite.width, height: sprite.height }
    const rewritten: { layer: Layer; frame: string; cel: Cel }[] = []

    for (const layer of sprite.layers) {
        for (const [frame, cel] of layer.cels) {
            rewritten.push({
                layer,
                frame,
                cel: { x: cel.x, y: cel.y, pixels: rewrite(cel.pixels, from), version: 0 },
            })
        }
    }

    sprite.width = geometry.width
    sprite.height = geometry.height
    for (const layer of sprite.layers) layer.cels.clear()
    for (const entry of rewritten) entry.layer.cels.set(entry.frame, entry.cel)

    sprite.revision++
}

function offsetPixels(
    pixels: Uint8Array,
    from: CanvasGeometry,
    to: CanvasGeometry,
    offsetX: number,
    offsetY: number,
): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(to.width * to.height * 4)
    const left = Math.max(0, -offsetX)
    const top = Math.max(0, -offsetY)
    const right = Math.min(from.width, to.width - offsetX)
    const bottom = Math.min(from.height, to.height - offsetY)

    for (let y = top; y < bottom; y++) {
        const source = (y * from.width + left) * 4
        const target = ((y + offsetY) * to.width + left + offsetX) * 4
        out.set(pixels.subarray(source, source + (right - left) * 4), target)
    }

    return out
}

function samplePixels(
    pixels: Uint8Array,
    from: CanvasGeometry,
    to: CanvasGeometry,
): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(to.width * to.height * 4)

    for (let y = 0; y < to.height; y++) {
        const sy = Math.min(from.height - 1, Math.floor(((y + 0.5) * from.height) / to.height))

        for (let x = 0; x < to.width; x++) {
            const sx = Math.min(from.width - 1, Math.floor(((x + 0.5) * from.width) / to.width))
            const source = (sy * from.width + sx) * 4
            out.set(pixels.subarray(source, source + 4), (y * to.width + x) * 4)
        }
    }

    return out
}
