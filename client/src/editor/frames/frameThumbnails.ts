import type { Frame, Sprite } from '@starforge/core'
import { canvasBackend, Compositor } from '../../render/compositor'

const THUMB_H = 32
const THUMB_MIN_W = 12
const THUMB_MAX_W = 64

export class FrameThumbnails {
    readonly #sprite: Sprite
    readonly #compositor = new Compositor(canvasBackend(), 12)
    readonly #tiles = new Map<string, HTMLCanvasElement>()
    readonly #painted = new Map<string, { stamp: string; canvas: HTMLCanvasElement }>()

    constructor(sprite: Sprite) {
        this.#sprite = sprite
    }

    track(frameId: string, canvas: HTMLCanvasElement | null): void {
        if (canvas) this.#tiles.set(frameId, canvas)
    }

    sync(frames: readonly Frame[]): void {
        const alive = new Set(frames.map((frame) => frame.id))
        for (const frame of frames) {
            const canvas = this.#tiles.get(frame.id)
            if (!canvas) continue

            const stamp = this.#compositor.stamp(this.#sprite, frame.id)

            const done = this.#painted.get(frame.id)
            if (done?.stamp === stamp && done.canvas === canvas) continue

            this.#paint(canvas, this.#compositor.get(this.#sprite, frame.id))
            this.#painted.set(frame.id, { stamp, canvas })
        }
        for (const id of [...this.#tiles.keys()]) {
            if (alive.has(id)) continue
            this.#tiles.delete(id)
            this.#painted.delete(id)
        }
    }

    #paint(canvas: HTMLCanvasElement, image: HTMLCanvasElement): void {
        const dpr = Math.max(1, window.devicePixelRatio || 1)
        const aspect = this.#sprite.width / this.#sprite.height
        const cssW = Math.min(THUMB_MAX_W, Math.max(THUMB_MIN_W, Math.round(THUMB_H * aspect)))
        const w = Math.round(cssW * dpr)
        const h = Math.round(THUMB_H * dpr)
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w
            canvas.height = h
        }
        canvas.style.width = `${cssW}px`
        canvas.style.height = `${THUMB_H}px`

        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.imageSmoothingEnabled = false
        ctx.clearRect(0, 0, w, h)
        ctx.drawImage(image, 0, 0, w, h)
    }
}
