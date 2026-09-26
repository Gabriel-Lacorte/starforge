import type { Sprite } from '@starforge/core'
import type { View } from '../editor/view'
import { canvasBackend, Compositor } from './compositor'
import type { CursorSample } from './cursorLayer'
import type { Ghost, GhostSide } from './onion'

const BACKDROP = '#0c0c0c'
const DOC_EDGE = '#5e5e5e'
const CHECKER_DARK = '#2f2f2f'
const CHECKER_LIGHT = '#3b3b3b'

const GHOST_TINT: Readonly<Record<GhostSide, readonly [number, number, number]>> = {
    before: [0xbe, 0x14, 0x25],
    after: [0x33, 0x66, 0xff],
}

interface GhostTint {
    stamp: string
    side: GhostSide
    canvas: HTMLCanvasElement
}

const CHECKER_SIZE = 8
const GRID_COLOR = 'rgba(255, 255, 255, 0.10)'
const GRID_MIN_ZOOM = 8

export class Renderer {
    readonly #ctx: CanvasRenderingContext2D
    readonly #checker: CanvasPattern
    readonly #compositor = new Compositor(canvasBackend())
    readonly #ghostTints = new Map<string, GhostTint>()

    constructor(canvas: HTMLCanvasElement) {
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('2d context unavailable')
        this.#ctx = ctx
        this.#checker = makeCheckerPattern(ctx)
    }

    get stats(): { readonly recompositions: number } {
        return this.#compositor.stats
    }

    render(sprite: Sprite, frameId: string, view: View, ghosts: readonly Ghost[]): void {
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

        for (const ghost of ghosts) {
            this.#drawGhost(sprite, ghost, panX, panY, w, h)
        }
        ctx.globalAlpha = 1

        ctx.drawImage(this.#compositor.get(sprite, frameId), panX, panY, w, h)

        if (view.zoom >= GRID_MIN_ZOOM) {
            this.#drawGrid(sprite, view.zoom, panX, panY, cw, ch)
        }

        ctx.strokeStyle = DOC_EDGE
        ctx.lineWidth = 1
        ctx.strokeRect(panX - 0.5, panY - 0.5, w + 1, h + 1)
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
        this.#compositor.invalidateCel(sprite, layerId, frameId, x, y, w, h)
    }

    sample(sprite: Sprite, frameId: string, x: number, y: number): CursorSample | null {
        if (x < 0 || y < 0 || x >= sprite.width || y >= sprite.height) return null

        const image = this.#compositor.get(sprite, frameId)
        const ctx = image.getContext('2d')
        if (!ctx) return null

        const { data } = ctx.getImageData(x, y, 1, 1)
        return { r: data[0]!, g: data[1]!, b: data[2]!, a: data[3]! }
    }

    #drawGhost(
        sprite: Sprite,
        ghost: Ghost,
        panX: number,
        panY: number,
        w: number,
        h: number,
    ): void {
        const stamp = this.#compositor.stamp(sprite, ghost.id)
        const cached = this.#ghostTints.get(ghost.id)
        let entry: GhostTint
        if (cached?.stamp === stamp && cached.side === ghost.side) {
            entry = cached
        } else {
            const source = this.#compositor.get(sprite, ghost.id)
            const sctx = source.getContext('2d')
            if (!sctx) return

            const image = sctx.getImageData(0, 0, sprite.width, sprite.height)
            const data = image.data
            const [tr, tg, tb] = GHOST_TINT[ghost.side]
            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] === 0) continue
                data[i] = (data[i]! + tr) >> 1
                data[i + 1] = (data[i + 1]! + tg) >> 1
                data[i + 2] = (data[i + 2]! + tb) >> 1
            }

            const canvas = cached?.canvas ?? document.createElement('canvas')
            if (canvas.width !== sprite.width || canvas.height !== sprite.height) {
                canvas.width = sprite.width
                canvas.height = sprite.height
            }
            canvas.getContext('2d')!.putImageData(image, 0, 0)
            entry = { stamp, side: ghost.side, canvas }
            this.#ghostTints.set(ghost.id, entry)

            while (this.#ghostTints.size > 8) {
                const oldest = this.#ghostTints.keys().next()
                if (oldest.done) break
                this.#ghostTints.delete(oldest.value)
            }
        }

        const ctx = this.#ctx
        ctx.globalAlpha = ghost.alpha
        ctx.drawImage(entry.canvas, panX, panY, w, h)
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
