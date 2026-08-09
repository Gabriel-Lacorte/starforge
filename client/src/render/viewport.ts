import { clampPan, createView, fitSprite, screenToSprite, type View } from '../editor/view'

interface ViewportEvents {
    onResize: () => void
    onFit: (zoom: number) => void
}

export class Viewport {
    readonly view: View = createView()

    readonly #canvas: HTMLCanvasElement
    readonly #overlay: HTMLCanvasElement

    readonly #spriteW: number
    readonly #spriteH: number

    readonly #events: ViewportEvents
    readonly #observer: ResizeObserver

    #dpr = window.devicePixelRatio
    #adjusted = false
    #rectLeft = 0
    #rectTop = 0

    #rectDirty = true
    #dprQuery: MediaQueryList | null = null

    constructor(
        canvas: HTMLCanvasElement,
        overlay: HTMLCanvasElement,
        spriteW: number,
        spriteH: number,
        events: ViewportEvents,
    ) {
        this.#canvas = canvas
        this.#overlay = overlay

        this.#spriteW = spriteW
        this.#spriteH = spriteH

        this.#events = events
        this.#observer = new ResizeObserver(() => {
            this.#rectDirty = true
            this.#resize()
        })
        this.#observer.observe(canvas)

        window.addEventListener('scroll', this.#onScroll, { passive: true, capture: true })
        this.#watchDpr()
    }

    get dpr(): number {
        return this.#dpr
    }

    markAdjusted(): void {
        this.#adjusted = true
    }

    fit(): void {
        this.#adjusted = false
        fitSprite(this.view, this.#spriteW, this.#spriteH, this.#canvas.width, this.#canvas.height)
    }

    clampPan(): void {
        clampPan(this.view, this.#spriteW, this.#spriteH, this.#canvas.width, this.#canvas.height)
    }

    refreshRect(): void {
        if (!this.#rectDirty) return
        const rect = this.#canvas.getBoundingClientRect()
        this.#rectLeft = rect.left
        this.#rectTop = rect.top
        this.#rectDirty = false
    }

    toCanvas(clientX: number, clientY: number): { x: number; y: number } {
        return {
            x: (clientX - this.#rectLeft) * this.#dpr,
            y: (clientY - this.#rectTop) * this.#dpr,
        }
    }

    toSprite(clientX: number, clientY: number): { x: number; y: number } {
        return screenToSprite(
            this.view,
            (clientX - this.#rectLeft) * this.#dpr,
            (clientY - this.#rectTop) * this.#dpr,
        )
    }

    dispose(): void {
        this.#observer.disconnect()
        window.removeEventListener('scroll', this.#onScroll, { capture: true })
        this.#dprQuery?.removeEventListener('change', this.#onDprChange)
    }

    #onScroll = (): void => {
        this.#rectDirty = true
    }

    #resize(): void {
        this.#dpr = window.devicePixelRatio

        const rect = this.#canvas.getBoundingClientRect()
        const w = Math.max(1, Math.round(rect.width * this.#dpr))
        const h = Math.max(1, Math.round(rect.height * this.#dpr))
        if (this.#canvas.width === w && this.#canvas.height === h) return

        this.#canvas.width = w
        this.#canvas.height = h
        this.#overlay.width = w
        this.#overlay.height = h

        if (rect.width > 0 && !this.#adjusted) {
            fitSprite(this.view, this.#spriteW, this.#spriteH, w, h)
            this.#events.onFit(this.view.zoom)
        } else {
            this.clampPan()
        }

        this.#events.onResize()
    }

    #onDprChange = (): void => {
        this.#rectDirty = true
        this.#resize()
        this.#watchDpr()
    }

    #watchDpr(): void {
        this.#dprQuery?.removeEventListener('change', this.#onDprChange)
        this.#dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
        this.#dprQuery.addEventListener('change', this.#onDprChange)
    }
}
