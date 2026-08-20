import { createLayer, createSprite, insertLayer, openCursor } from '@starforge/core'
import { Compositor, canvasBackend } from './compositor'

export interface ComposeBenchResult {
    size: number
    layers: number

    fullMs: number
    dirtyMs: number
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0

export function benchCompose(
    size = 256,
    layerCount = 8,
    runs = 20,
    batch = 50,
): ComposeBenchResult {
    const sprite = createSprite({ width: size, height: size })
    const frame = sprite.frames[0]!.id

    while (sprite.layers.length < layerCount) {
        insertLayer(sprite, createLayer(`bench ${sprite.layers.length}`), sprite.layers.at(-1)!.id)
    }

    for (const [i, layer] of sprite.layers.entries()) {
        const cursor = openCursor(sprite, layer.id, frame)
        for (let x = 0; x < size; x++) {
            cursor.set(x, (x + i * 7) % size, 0xff00ffff)
            cursor.set((x + i * 13) % size, x, 0x00ffffff)
        }
    }

    const compositor = new Compositor(canvasBackend())
    compositor.get(sprite, frame)

    const fence = (canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(0, 0, 1, 1)

    const full: number[] = []
    for (let i = 0; i < runs; i++) {
        const t0 = performance.now()
        for (let b = 0; b < batch; b++) {
            sprite.revision++
            fence(compositor.get(sprite, frame))
        }
        full.push((performance.now() - t0) / batch)
    }

    const dirty: number[] = []
    const cursor = openCursor(sprite, sprite.layers[0]!.id, frame)
    let step = 0

    for (let i = 0; i < runs; i++) {
        const t0 = performance.now()
        for (let b = 0; b < batch; b++, step++) {
            const ox = (step * 31) % (size - 16)
            for (let k = 0; k < 16; k++) {
                cursor.set(ox + k, (ox + k * 3) % 16, step % 2 ? 0xffffffff : 0)
            }
            compositor.invalidateCel(sprite, sprite.layers[0]!.id, frame, ox, 0, 16, 16)
            fence(compositor.get(sprite, frame))
        }
        dirty.push((performance.now() - t0) / batch)
    }

    return { size, layers: layerCount, fullMs: median(full), dirtyMs: median(dirty) }
}
