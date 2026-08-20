import { maskOutline, type RGBA, type SelectionMask } from '@starforge/core'
import type { View } from '../editor/view'
import type { SelectionView } from '../editor/selection/region'

interface Rect {
    x: number
    y: number
    w: number
    h: number
}

export class PreviewOverlay {
    readonly #ctx: CanvasRenderingContext2D
    readonly #buffer: HTMLCanvasElement
    readonly #bctx: CanvasRenderingContext2D
    readonly #image: ImageData

    readonly #width: number
    readonly #height: number

    #painted: Rect | null = null

    #onScreen = false

    #floatTile: HTMLCanvasElement | null = null
    #floatTileFor: Uint32Array | null = null

    #antsPath: Path2D | null = null
    #antsFor: SelectionMask | null = null

    constructor(canvas: HTMLCanvasElement, spriteW: number, spriteH: number) {
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('2d context unavailable')

        this.#ctx = ctx
        this.#width = spriteW
        this.#height = spriteH
        this.#buffer = document.createElement('canvas')
        this.#buffer.width = spriteW
        this.#buffer.height = spriteH

        const bctx = this.#buffer.getContext('2d')
        if (!bctx) throw new Error('2d context unavailable')
        this.#bctx = bctx

        this.#image = new ImageData(spriteW, spriteH)
    }

    setCells(cells: Iterable<number>, color: RGBA): void {
        const data = this.#image.data
        const prev = this.#painted
        if (prev) {
            for (let y = prev.y; y < prev.y + prev.h; y++) {
                data.fill(
                    0,
                    (y * this.#width + prev.x) * 4,
                    (y * this.#width + prev.x + prev.w) * 4,
                )
            }
        }

        const r = color >>> 24
        const g = (color >>> 16) & 0xff
        const b = (color >>> 8) & 0xff
        const a = color & 0xff

        let minX = this.#width
        let minY = this.#height
        let maxX = -1
        let maxY = -1

        for (const cell of cells) {
            if (cell < 0 || cell >= this.#width * this.#height) continue

            const x = cell % this.#width
            const y = (cell - x) / this.#width
            const o = cell * 4

            data[o] = r
            data[o + 1] = g
            data[o + 2] = b
            data[o + 3] = a

            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
        }

        const next: Rect | null =
            maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
        this.#painted = next
        const flush = union(prev, next)
        if (flush) this.#bctx.putImageData(this.#image, 0, 0, flush.x, flush.y, flush.w, flush.h)
    }

    clear(): void {
        this.setCells([], 0)
    }

    render(view: View, selection?: SelectionView | null): void {
        const hasSelection = !!selection?.mask
        if (!this.#painted && !hasSelection && !this.#onScreen) return

        const ctx = this.#ctx
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
        if (this.#painted) {
            ctx.imageSmoothingEnabled = false
            ctx.drawImage(
                this.#buffer,
                Math.round(view.panX),
                Math.round(view.panY),
                this.#width * view.zoom,
                this.#height * view.zoom,
            )
        }

        if (hasSelection) this.#paintSelection(view, selection)
        this.#onScreen = this.#painted !== null || hasSelection
    }

    #paintSelection(view: View, sel: SelectionView): void {
        const mask = sel.mask!
        const ctx = this.#ctx

        const panX = Math.round(view.panX)
        const panY = Math.round(view.panY)
        const rect = sel.floatRect

        if (sel.floatBuffer && rect) {
            ctx.imageSmoothingEnabled = false
            ctx.drawImage(
                this.#floatTileForBuffer(sel.floatBuffer, rect.w, rect.h),
                panX + (rect.x + sel.offsetX) * view.zoom,
                panY + (rect.y + sel.offsetY) * view.zoom,
                rect.w * view.zoom,
                rect.h * view.zoom,
            )
        }

        ctx.setTransform(
            view.zoom,
            0,
            0,
            view.zoom,
            panX + sel.offsetX * view.zoom,
            panY + sel.offsetY * view.zoom,
        )
        const ants = this.#antsFor === mask ? this.#antsPath! : this.#buildAnts(mask)
        ctx.lineWidth = 1 / view.zoom
        ctx.setLineDash([])
        ctx.strokeStyle = '#000'
        ctx.stroke(ants)
        ctx.strokeStyle = '#fff'
        ctx.setLineDash([2 / view.zoom, 2 / view.zoom])
        ctx.stroke(ants)
        ctx.setLineDash([])
        ctx.setTransform(1, 0, 0, 1, 0, 0)
    }

    #buildAnts(mask: SelectionMask): Path2D {
        const path = new Path2D()
        for (const edge of maskOutline(mask)) {
            path.moveTo(edge.x1, edge.y1)
            path.lineTo(edge.x2, edge.y2)
        }

        this.#antsPath = path
        this.#antsFor = mask
        return path
    }

    #floatTileForBuffer(buffer: Uint32Array, tw: number, th: number): HTMLCanvasElement {
        if (this.#floatTile && this.#floatTileFor === buffer) return this.#floatTile

        const img = new ImageData(unpackRgba(buffer), tw, th)

        const tile = document.createElement('canvas')
        tile.width = tw
        tile.height = th
        tile.getContext('2d')!.putImageData(img, 0, 0)
        this.#floatTile = tile
        this.#floatTileFor = buffer

        return tile
    }
}

export function unpackRgba(buffer: Uint32Array): Uint8ClampedArray<ArrayBuffer> {
    const data = new Uint8ClampedArray(buffer.length * 4)
    for (let i = 0; i < buffer.length; i++) {
        const c = buffer[i]!
        const o = i * 4
        data[o] = c >>> 24
        data[o + 1] = (c >>> 16) & 0xff
        data[o + 2] = (c >>> 8) & 0xff
        data[o + 3] = c & 0xff
    }
    return data
}

function union(a: Rect | null, b: Rect | null): Rect | null {
    if (!a) return b
    if (!b) return a

    const x = Math.min(a.x, b.x)
    const y = Math.min(a.y, b.y)

    return {
        x,
        y,
        w: Math.max(a.x + a.w, b.x + b.w) - x,
        h: Math.max(a.y + a.h, b.y + b.h) - y,
    }
}
