import { getCel, type Cel, type Sprite } from '@starforge/core'
import type { View } from '../editor/view'
import { CelSurface } from './CelSurface'

const BACKDROP = '#09090b'
const CHECKER_DARK = '#18181b'
const CHECKER_LIGHT = '#212125'

const CHECKER_SIZE = 8
const GRID_COLOR = 'rgba(0, 0, 0, 0.25)'
const GRID_MIN_ZOOM = 8

export class Renderer {
    readonly #ctx: CanvasRenderingContext2D
    readonly #checker: CanvasPattern
    readonly #surfaces = new WeakMap<Cel, CelSurface>()

    constructor(canvas: HTMLCanvasElement) {
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('2d context unavailable')
        this.#ctx = ctx
        this.#checker = makeCheckerPattern(ctx)
    }

    render(sprite: Sprite, frameId: string, view: View): void {
        const ctx = this.#ctx
        const { width: cw, height: ch } = ctx.canvas
        const panX = Math.round(view.panX)
        const panY = Math.round(view.panY)
        const w = sprite.width * view.zoom
        const h = sprite.height * view.zoom

        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.imageSmoothingEnabled = false
        ctx.fillStyle = BACKDROP
        ctx.fillRect(0, 0, cw, ch)

        ctx.translate(panX, panY)
        ctx.fillStyle = this.#checker
        ctx.fillRect(0, 0, w, h)
        ctx.setTransform(1, 0, 0, 1, 0, 0)

        for (const layer of sprite.layers) {
            if (!layer.visible) continue

            const cel = layer.cels.get(frameId)
            if (!cel) continue

            const surface = this.#surfaceFor(cel, sprite)
            surface.flush()

            ctx.globalAlpha = layer.opacity / 255
            ctx.drawImage(surface.canvas, panX + cel.x * view.zoom, panY + cel.y * view.zoom, w, h)
        }
        ctx.globalAlpha = 1

        if (view.zoom >= GRID_MIN_ZOOM) this.#drawGrid(sprite, view.zoom, panX, panY, cw, ch)
    }

    invalidate(
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
        this.#surfaces.get(cel)?.invalidate(x, y, w, h)
    }

    #drawGrid(
        sprite: Sprite,
        zoom: number,
        panX: number,
        panY: number,
        cw: number,
        ch: number,
    ): void {
        const ctx = this.#ctx

        const i0 = Math.max(0, Math.ceil(-panX / zoom))
        const i1 = Math.min(sprite.width, Math.floor((cw - panX) / zoom))
        const j0 = Math.max(0, Math.ceil(-panY / zoom))
        const j1 = Math.min(sprite.height, Math.floor((ch - panY) / zoom))
        const top = Math.max(0, panY)
        const bottom = Math.min(ch, panY + sprite.height * zoom)
        const left = Math.max(0, panX)
        const right = Math.min(cw, panX + sprite.width * zoom)

        ctx.fillStyle = GRID_COLOR
        for (let i = i0; i <= i1; i++) ctx.fillRect(panX + i * zoom, top, 1, bottom - top)
        for (let j = j0; j <= j1; j++) ctx.fillRect(left, panY + j * zoom, right - left, 1)
    }

    #surfaceFor(cel: Cel, sprite: Sprite): CelSurface {
        let surface = this.#surfaces.get(cel)
        if (!surface) {
            surface = new CelSurface(cel, sprite.width, sprite.height)
            this.#surfaces.set(cel, surface)
        }
        return surface
    }
}

function makeCheckerPattern(ctx: CanvasRenderingContext2D): CanvasPattern {
    const tile = document.createElement('canvas')
    tile.width = tile.height = CHECKER_SIZE * 2
    const tileCtx = tile.getContext('2d')
    if (!tileCtx) throw new Error('2d context unavailable')
    tileCtx.fillStyle = CHECKER_DARK
    tileCtx.fillRect(0, 0, tile.width, tile.height)
    tileCtx.fillStyle = CHECKER_LIGHT
    tileCtx.fillRect(CHECKER_SIZE, 0, CHECKER_SIZE, CHECKER_SIZE)
    tileCtx.fillRect(0, CHECKER_SIZE, CHECKER_SIZE, CHECKER_SIZE)

    const pattern = ctx.createPattern(tile, 'repeat')
    if (!pattern) throw new Error('checker pattern creation failed')
    return pattern
}
