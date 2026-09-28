import { maskOutline, type RGBA, type SelectionMask } from '@starforge/core'
import type { View } from '../editor/view'
import type { SelectionView } from '../editor/selection/region'
import { cursorPath, type CursorBoost } from './cursorLayer'

interface Rect {
    x: number
    y: number
    w: number
    h: number
}

export interface PeerCursor {
    readonly x: number
    readonly y: number
    readonly color: number
    readonly nickname: string
    readonly layer: string
    readonly frame: string
    readonly previewCells?: ReadonlySet<number>
    readonly previewColor?: number
}

interface PeerTarget {
    readonly layer: string
    readonly frame: string
}

export interface SymmetryGuides {
    h: boolean
    v: boolean
}

const GUIDE_STROKE = 'rgba(154, 154, 154, 0.5)'

const GRID_MAJOR_EVERY = 8

export class PreviewOverlay {
    readonly #ctx: CanvasRenderingContext2D
    readonly #buffer: HTMLCanvasElement
    readonly #bctx: CanvasRenderingContext2D
    readonly #image: ImageData
    readonly #peerBuffer: HTMLCanvasElement
    readonly #peerCtx: CanvasRenderingContext2D
    readonly #peerImage: ImageData

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

        this.#peerBuffer = document.createElement('canvas')
        this.#peerBuffer.width = spriteW
        this.#peerBuffer.height = spriteH
        const peerCtx = this.#peerBuffer.getContext('2d')
        if (!peerCtx) throw new Error('2d context unavailable')
        this.#peerCtx = peerCtx
        this.#peerImage = new ImageData(spriteW, spriteH)
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

    render(
        view: View,
        selection?: SelectionView | null,
        guides?: SymmetryGuides | null,
        peers?: readonly PeerCursor[] | null,
        target?: PeerTarget | null,
        grid?: boolean,
        boosts?: readonly CursorBoost[] | null,
    ): void {
        const hasSelection = !!selection?.mask
        const hasGuides = !!guides && (guides.h || guides.v)
        const hasGrid = grid === true
        const peerList = peers ?? null
        const peerTarget = target ?? null
        const hasPeers = peerList !== null && peerList.length > 0 && peerTarget !== null
        const anyBoost = boosts !== null && boosts !== undefined && boosts.length > 0
        if (
            !this.#painted &&
            !hasSelection &&
            !hasGuides &&
            !hasGrid &&
            !hasPeers &&
            !anyBoost &&
            !this.#onScreen
        )
            return

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

        if (hasGuides) this.#paintGuides(view, guides)
        if (hasGrid) this.#paintGrid(view)
        if (hasSelection) this.#paintSelection(view, selection)
        if (peerList !== null && peerList.length > 0 && peerTarget !== null) {
            this.#paintPeerPreviews(view, peerList, peerTarget)
            this.#paintPeers(view, peerList, peerTarget)
        }
        if (boosts !== null && boosts !== undefined && boosts.length > 0) {
            this.#paintCursorBoosts(view, boosts)
        }
        this.#onScreen = this.#painted !== null || hasSelection || hasGrid || hasPeers || anyBoost
    }

    #paintCursorBoosts(view: View, boosts: readonly CursorBoost[]): void {
        for (const boost of boosts) this.#paintCursorBoost(view, boost)
    }

    #paintCursorBoost(view: View, boost: CursorBoost): void {
        const ctx = this.#ctx
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.save()
        ctx.translate(
            Math.round(view.panX) + boost.cursor.x * view.zoom,
            Math.round(view.panY) + boost.cursor.y * view.zoom,
        )
        ctx.scale(view.zoom, view.zoom)
        ctx.lineWidth = 1 / view.zoom
        ctx.strokeStyle = boost.color
        ctx.stroke(cursorPath(boost.cursor))
        ctx.restore()
    }

    #paintGrid(view: View): void {
        const ctx = this.#ctx
        ctx.setTransform(1, 0, 0, 1, 0, 0)

        const panX = Math.round(view.panX)
        const panY = Math.round(view.panY)
        const w = this.#width * view.zoom
        const h = this.#height * view.zoom

        ctx.lineWidth = 1
        ctx.strokeStyle = 'rgba(154, 154, 154, 0.18)'
        ctx.strokeRect(panX + 0.5, panY + 0.5, w - 1, h - 1)

        if (view.zoom >= 6) {
            ctx.beginPath()
            for (let i = 1; i < this.#width; i++) {
                const x = Math.round(panX + i * view.zoom) + 0.5
                ctx.moveTo(x, panY)
                ctx.lineTo(x, panY + h)
            }
            for (let j = 1; j < this.#height; j++) {
                const y = Math.round(panY + j * view.zoom) + 0.5
                ctx.moveTo(panX, y)
                ctx.lineTo(panX + w, y)
            }
            ctx.stroke()
        }

        if (view.zoom >= 2) {
            ctx.strokeStyle = 'rgba(154, 154, 154, 0.35)'
            ctx.beginPath()
            for (let i = GRID_MAJOR_EVERY; i < this.#width; i += GRID_MAJOR_EVERY) {
                const x = Math.round(panX + i * view.zoom) + 0.5
                ctx.moveTo(x, panY)
                ctx.lineTo(x, panY + h)
            }
            for (let j = GRID_MAJOR_EVERY; j < this.#height; j += GRID_MAJOR_EVERY) {
                const y = Math.round(panY + j * view.zoom) + 0.5
                ctx.moveTo(panX, y)
                ctx.lineTo(panX + w, y)
            }
            ctx.stroke()
        }

        ctx.strokeStyle = 'rgba(255, 204, 51, 0.4)'
        ctx.beginPath()
        const cx = Math.round(panX + w / 2) + 0.5
        const cy = Math.round(panY + h / 2) + 0.5
        ctx.moveTo(cx, panY)
        ctx.lineTo(cx, panY + h)
        ctx.moveTo(panX, cy)
        ctx.lineTo(panX + w, cy)
        ctx.stroke()
    }

    #paintPeerPreviews(view: View, peers: readonly PeerCursor[], target: PeerTarget): void {
        let any = false
        for (const peer of peers) {
            if ((peer.previewCells?.size ?? 0) === 0) continue
            if (peer.layer !== target.layer || peer.frame !== target.frame) continue
            any = true
            break
        }
        if (!any) return

        const data = this.#peerImage.data
        data.fill(0)
        const limit = this.#width * this.#height
        for (const peer of peers) {
            if ((peer.previewCells?.size ?? 0) === 0) continue
            if (peer.layer !== target.layer || peer.frame !== target.frame) continue

            const c = peer.previewColor ?? 0
            const r = c >>> 24
            const g = (c >>> 16) & 0xff
            const b = (c >>> 8) & 0xff
            const a = c & 0xff
            for (const cell of peer.previewCells!) {
                if (cell < 0 || cell >= limit) continue
                const o = cell * 4
                data[o] = r
                data[o + 1] = g
                data[o + 2] = b
                data[o + 3] = a
            }
        }

        this.#peerCtx.putImageData(this.#peerImage, 0, 0)
        const ctx = this.#ctx
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(
            this.#peerBuffer,
            Math.round(view.panX),
            Math.round(view.panY),
            this.#width * view.zoom,
            this.#height * view.zoom,
        )
    }

    #paintPeers(view: View, peers: readonly PeerCursor[], target: PeerTarget): void {
        const ctx = this.#ctx
        const dpr = Math.max(1, window.devicePixelRatio || 1)
        const fontSize = Math.round(8 * dpr)
        const minMarker = Math.round(4 * dpr)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.font = `${String(fontSize)}px 'Silkscreen', ui-monospace, monospace`
        ctx.textBaseline = 'top'

        for (const peer of peers) {
            if (peer.x < 0 || peer.y < 0) continue

            const css = `#${((peer.color >>> 8) & 0xffffff).toString(16).padStart(6, '0')}`
            const samePlace = peer.layer === target.layer && peer.frame === target.frame
            const x = Math.round(view.panX) + peer.x * view.zoom
            const y = Math.round(view.panY) + peer.y * view.zoom
            const size = Math.max(view.zoom, minMarker)
            const mx = x + (view.zoom - size) / 2
            const my = y + (view.zoom - size) / 2

            ctx.globalAlpha = samePlace ? 1 : 0.45

            ctx.strokeStyle = css
            ctx.lineWidth = Math.max(1, Math.floor(dpr))
            ctx.strokeRect(mx + 0.5, my + 0.5, size - 1, size - 1)

            if (peer.nickname.length > 0) {
                const pad = Math.round(3 * dpr)
                const textWidth = ctx.measureText(peer.nickname).width
                const chipW = textWidth + pad * 2
                const chipH = fontSize + pad * 2
                let lx = mx + size + Math.round(2 * dpr)
                let ly = my
                if (lx + chipW > ctx.canvas.width) lx = mx - chipW - Math.round(2 * dpr)
                if (ly + chipH > ctx.canvas.height)
                    ly = Math.max(0, my - chipH - Math.round(2 * dpr))

                const painting = (peer.previewCells?.size ?? 0) > 0
                ctx.fillStyle = painting ? css : 'rgba(10, 10, 10, 0.82)'
                ctx.fillRect(lx, ly, chipW, chipH)
                ctx.strokeStyle = painting ? '#0a0a0a' : css
                ctx.lineWidth = 1
                ctx.strokeRect(lx + 0.5, ly + 0.5, chipW - 1, chipH - 1)
                ctx.fillStyle = painting ? '#161616' : '#e4e4e4'
                ctx.fillText(peer.nickname, lx + pad, ly + pad)
            }

            ctx.globalAlpha = 1
        }
    }

    #paintGuides(view: View, guides: SymmetryGuides): void {
        const ctx = this.#ctx
        ctx.setTransform(1, 0, 0, 1, 0, 0)

        const panX = Math.round(view.panX)
        const panY = Math.round(view.panY)
        const w = this.#width * view.zoom
        const h = this.#height * view.zoom

        ctx.strokeStyle = GUIDE_STROKE
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.beginPath()

        if (guides.h) {
            const x = Math.round(panX + w / 2) + 0.5
            ctx.moveTo(x, panY)
            ctx.lineTo(x, panY + h)
        }
        if (guides.v) {
            const y = Math.round(panY + h / 2) + 0.5
            ctx.moveTo(panX, y)
            ctx.lineTo(panX + w, y)
        }

        ctx.stroke()
        ctx.setLineDash([])
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
