import { createSprite, hexToRgba, writePixel, type RGBA, type Sprite } from '@starforge/core'

const OUTLINE = hexToRgba('#a87b0a')
const SHADE = hexToRgba('#edb111')
const BASE = hexToRgba('#ffd93d')
const LIGHT = hexToRgba('#ffe97f')
const HIGHLIGHT = hexToRgba('#fff6c9')

export function createDemoSprite(): Sprite {
    const sprite = createSprite({ width: 64, height: 64, title: 'hello starforge' })
    const layerId = sprite.layers[0]?.id
    const frameId = sprite.frames[0]?.id
    if (!layerId || !frameId) throw new Error('sprite has no layer or frame')

    const put = (x: number, y: number, color: RGBA) => {
        writePixel(sprite, layerId, frameId, x, y, color)
    }

    const size = sprite.width
    const cx = 32
    const cy = 33
    const outer = 25
    const inner = 13

    const vx: number[] = []
    const vy: number[] = []
    for (let k = 0; k < 10; k++) {
        const radius = k % 2 === 0 ? outer : inner
        const angle = -Math.PI / 2 + (k * Math.PI) / 5
        vx.push(cx + radius * Math.cos(angle))
        vy.push(cy + radius * Math.sin(angle))
    }

    const inside = new Uint8Array(size * size)
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (insidePolygon(vx, vy, x + 0.5, y + 0.5)) inside[y * size + x] = 1
        }
    }

    const filled = (x: number, y: number) =>
        x >= 0 && y >= 0 && x < size && y < size && inside[y * size + x] === 1

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (!filled(x, y)) continue
            const boundary =
                !filled(x - 1, y) || !filled(x + 1, y) || !filled(x, y - 1) || !filled(x, y + 1)
            if (boundary) {
                put(x, y, OUTLINE)
                continue
            }
            const light = x - cx + (y - cy)
            put(x, y, light <= -10 ? LIGHT : light >= 14 ? SHADE : BASE)
        }
    }

    for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, -1],
    ] as const) {
        put(26 + dx, 27 + dy, HIGHLIGHT)
    }

    const sparkle = (x: number, y: number) => {
        put(x, y, HIGHLIGHT)
        put(x + 1, y, LIGHT)
        put(x - 1, y, LIGHT)
        put(x, y + 1, LIGHT)
        put(x, y - 1, LIGHT)
    }
    sparkle(11, 11)
    sparkle(52, 47)
    for (const [x, y] of [
        [53, 13],
        [12, 51],
        [25, 4],
        [58, 31],
    ] as const) {
        put(x, y, LIGHT)
    }

    return sprite
}

function insidePolygon(vx: number[], vy: number[], px: number, py: number): boolean {
    let inside = false
    for (let i = 0, j = vx.length - 1; i < vx.length; j = i++) {
        const xi = vx[i] ?? 0
        const yi = vy[i] ?? 0
        const xj = vx[j] ?? 0
        const yj = vy[j] ?? 0
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
}
