import { getCel, type BlendMode, type Cel, type DirtyRect, type Sprite } from '@starforge/core'
import { CelSurface } from './CelSurface'

export const BLEND_OP: Readonly<Record<BlendMode, GlobalCompositeOperation>> = {
    normal: 'source-over',
    multiply: 'multiply',
    screen: 'screen',
    overlay: 'overlay',
    darken: 'darken',
    lighten: 'lighten',
    additive: 'lighter',
}

export interface CompositeContext<TImage> {
    globalAlpha: number
    globalCompositeOperation: GlobalCompositeOperation
    clearRect(x: number, y: number, w: number, h: number): void
    drawImage(
        image: TImage,
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        dx: number,
        dy: number,
        dw: number,
        dh: number,
    ): void
}

export interface CompositeSurface<TImage> {
    readonly image: TImage
    readonly ctx: CompositeContext<TImage>
}

export interface CompositorBackend<TImage> {
    createComposite(width: number, height: number): CompositeSurface<TImage>
    celImage(cel: Cel, width: number, height: number): TImage
    invalidateCel(cel: Cel, x: number, y: number, w: number, h: number): void
}

interface FrameEntry<TImage> {
    surface: CompositeSurface<TImage>
    revision: number
    celSum: number
    dirty: DirtyRect | null
}

export class Compositor<TImage> {
    readonly #backend: CompositorBackend<TImage>
    readonly #frames = new Map<string, FrameEntry<TImage>>()
    readonly stats = { recompositions: 0 }

    constructor(backend: CompositorBackend<TImage>) {
        this.#backend = backend
    }

    get(sprite: Sprite, frameId: string): TImage {
        let entry = this.#frames.get(frameId)
        if (!entry) {
            entry = {
                surface: this.#backend.createComposite(sprite.width, sprite.height),
                revision: -1,
                celSum: -1,
                dirty: null,
            }
            this.#frames.set(frameId, entry)
        }

        let celSum = 0
        for (const layer of sprite.layers) {
            if (!layer.visible) continue

            const cel = layer.cels.get(frameId)
            if (cel) celSum += cel.version
        }

        if (entry.revision === sprite.revision && entry.celSum === celSum) {
            return entry.surface.image
        }

        const full = entry.revision !== sprite.revision || !entry.dirty
        const rect: DirtyRect = full
            ? { x: 0, y: 0, w: sprite.width, h: sprite.height }
            : entry.dirty!

        this.#compose(sprite, frameId, entry, rect)
        entry.revision = sprite.revision
        entry.celSum = celSum
        entry.dirty = null
        this.stats.recompositions++
        return entry.surface.image
    }

    invalidateCel(
        sprite: Sprite,
        layerId: string,
        frameId: string,
        x: number,
        y: number,
        w: number,
        h: number,
    ): void {
        const cel = getCel(sprite, layerId, frameId)
        if (!cel) return
        this.#backend.invalidateCel(cel, x, y, w, h)

        const entry = this.#frames.get(frameId)
        if (!entry) return

        const d = entry.dirty
        if (!d) {
            entry.dirty = { x, y, w, h }
            return
        }

        const x2 = Math.max(d.x + d.w, x + w)
        const y2 = Math.max(d.y + d.h, y + h)
        d.x = Math.min(d.x, x)
        d.y = Math.min(d.y, y)
        d.w = x2 - d.x
        d.h = y2 - d.y
    }

    #compose(sprite: Sprite, frameId: string, entry: FrameEntry<TImage>, rect: DirtyRect): void {
        const ctx = entry.surface.ctx
        ctx.clearRect(rect.x, rect.y, rect.w, rect.h)

        let first = true
        for (const layer of sprite.layers) {
            if (!layer.visible) continue

            const cel = layer.cels.get(frameId)
            if (!cel) continue

            const image = this.#backend.celImage(cel, sprite.width, sprite.height)
            ctx.globalAlpha = layer.opacity / 255
            ctx.globalCompositeOperation = first ? 'source-over' : BLEND_OP[layer.blendMode]
            ctx.drawImage(
                image,
                rect.x - cel.x,
                rect.y - cel.y,
                rect.w,
                rect.h,
                rect.x,
                rect.y,
                rect.w,
                rect.h,
            )
            first = false
        }

        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
    }
}

export function canvasBackend(): CompositorBackend<HTMLCanvasElement> {
    const surfaces = new WeakMap<Cel, CelSurface>()
    return {
        createComposite(width, height) {
            const canvas = document.createElement('canvas')
            canvas.width = width
            canvas.height = height

            const ctx = canvas.getContext('2d')
            if (!ctx) {
                throw new Error('2d context unavailable')
            }

            return { image: canvas, ctx }
        },

        celImage(cel, width, height) {
            let surface = surfaces.get(cel)
            if (!surface) {
                surface = new CelSurface(cel, width, height)
                surfaces.set(cel, surface)
            }

            surface.flush()
            return surface.canvas
        },

        invalidateCel(cel, x, y, w, h) {
            surfaces.get(cel)?.invalidate(x, y, w, h)
        },
    }
}
