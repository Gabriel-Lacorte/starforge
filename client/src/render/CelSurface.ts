import type { Cel } from '@starforge/core'

interface Rect {
    x: number
    y: number
    w: number
    h: number
}

export class CelSurface {
    readonly canvas: HTMLCanvasElement
    readonly #cel: Cel
    readonly #ctx: CanvasRenderingContext2D
    readonly #image: ImageData
    #dirty: Rect | null = null
    #flushedVersion = -1

    constructor(cel: Cel, width: number, height: number) {
        this.#cel = cel
        this.canvas = document.createElement('canvas')
        this.canvas.width = width
        this.canvas.height = height

        const ctx = this.canvas.getContext('2d')
        if (!ctx) throw new Error('2d context unavailable')
        this.#ctx = ctx

        this.#image = new ImageData(
            new Uint8ClampedArray(cel.pixels.buffer, cel.pixels.byteOffset, cel.pixels.byteLength),
            width,
            height,
        )
    }

    invalidate(x: number, y: number, w: number, h: number): void {
        const d = this.#dirty
        if (!d) {
            this.#dirty = { x, y, w, h }
            return
        }

        const x2 = Math.max(d.x + d.w, x + w)
        const y2 = Math.max(d.y + d.h, y + h)

        d.x = Math.min(d.x, x)
        d.y = Math.min(d.y, y)

        d.w = x2 - d.x
        d.h = y2 - d.y
    }

    flush(): void {
        if (this.#flushedVersion === this.#cel.version) return

        const d = this.#dirty
        if (d) this.#ctx.putImageData(this.#image, 0, 0, d.x, d.y, d.w, d.h)
        else this.#ctx.putImageData(this.#image, 0, 0)

        this.#dirty = null
        this.#flushedVersion = this.#cel.version
    }
}
