import type { View } from '../editor/view'
import { compositeLuma, cursorContrast, stampEdges, type BrushCursor } from './brushPreview'

export interface CursorSample {
    readonly r: number
    readonly g: number
    readonly b: number
    readonly a: number
}

export interface CursorBoost {
    readonly cursor: BrushCursor
    readonly color: '#000000' | '#ffffff'
}

export class CursorLayer {
    readonly #ctx: CanvasRenderingContext2D
    #drawn = false

    constructor(canvas: HTMLCanvasElement) {
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('2d context unavailable')
        this.#ctx = ctx
    }

    render(
        view: View,
        cursors: readonly BrushCursor[] | null,
        sample: (x: number, y: number) => CursorSample | null,
    ): CursorBoost[] | null {
        const ctx = this.#ctx
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        if (!cursors || cursors.length === 0) {
            if (!this.#drawn) return null
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
            this.#drawn = false
            return null
        }
        this.#drawn = true
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)

        const boosts: CursorBoost[] = []
        for (const cursor of cursors) {
            ctx.save()
            ctx.translate(
                Math.round(view.panX) + cursor.x * view.zoom,
                Math.round(view.panY) + cursor.y * view.zoom,
            )
            ctx.scale(view.zoom, view.zoom)

            ctx.lineWidth = 1 / view.zoom
            ctx.strokeStyle = '#ffffff'
            ctx.stroke(cursorPath(cursor))

            const px = sample(Math.round(cursor.x), Math.round(cursor.y))
            const color = px === null ? null : cursorContrast(compositeLuma(px))
            if (color) boosts.push({ cursor, color })

            ctx.restore()
        }
        return boosts.length > 0 ? boosts : null
    }
}

const paths = new Map<string, Path2D>()

export function cursorPath(cursor: BrushCursor): Path2D {
    const key = cursor.shape === 'cell' ? 'cell' : `brush${cursor.size}`
    let path = paths.get(key)
    if (!path) {
        path = new Path2D()
        if (cursor.shape === 'cell') path.rect(0, 0, 1, 1)
        else
            for (const { x1, y1, x2, y2 } of stampEdges(cursor.size)) {
                path.moveTo(x1, y1)
                path.lineTo(x2, y2)
            }
        paths.set(key, path)
    }
    return path
}
