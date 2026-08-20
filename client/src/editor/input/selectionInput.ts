import type { MaskMode } from '@starforge/core'
import { marqueeShape, type MarqueeShape } from '../tools/definition'
import { toolDefinition } from '../tools/registry'
import type { Viewport } from '../../render/viewport'
import type { SelectionController } from '../selection/selectionController'
import type { EditorStore } from '../store'

export interface SelectionInputDeps {
    canvas: HTMLCanvasElement
    viewport: Viewport
    selection: SelectionController
    store: EditorStore
}

const ARROW_NUDGE: Readonly<Record<string, readonly [number, number]>> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
}

export class SelectionInput {
    readonly #deps: SelectionInputDeps
    readonly #unsubStore: () => void
    #mode: 'none' | 'marquee' | 'move' = 'none'
    #pointerId = -1

    constructor(deps: SelectionInputDeps) {
        this.#deps = deps
        this.#unsubStore = deps.store.subscribe(() => {
            if (!this.shape && deps.selection.active) deps.selection.commit()
        })
    }

    dispose(): void {
        this.#unsubStore()
    }

    get busy(): boolean {
        return this.#mode !== 'none'
    }

    get shape(): MarqueeShape | null {
        return marqueeShape(toolDefinition(this.#deps.store.state.tool))
    }

    pointerDown(e: PointerEvent, p: { x: number; y: number }): void {
        const { canvas, selection, store } = this.#deps
        this.#pointerId = e.pointerId
        canvas.setPointerCapture(e.pointerId)

        const mode = maskModeFor(e)
        const shape = this.shape ?? 'rect'

        if (shape === 'wand') {
            if (selection.floating) selection.commit()
            this.#mode = 'none'
            selection.wandAt(p.x, p.y, mode, {
                tolerance: store.state.fillTolerance,
                contiguous: store.state.fillContiguous,
            })
            return
        }

        if (mode === 'replace' && selection.contains(p.x, p.y)) {
            this.#mode = 'move'
            selection.beginMove(p.x, p.y)
        } else {
            if (selection.floating) selection.commit()
            this.#mode = 'marquee'
            selection.beginMarquee(p.x, p.y, mode, shape)
        }
    }

    pointerMove(e: PointerEvent, p: { x: number; y: number }): boolean {
        if (this.#mode === 'none' || e.pointerId !== this.#pointerId) return false
        if (this.#mode === 'marquee') this.#deps.selection.updateMarquee(p.x, p.y)
        else this.#deps.selection.moveTo(p.x, p.y)
        return true
    }

    pointerUp(e: PointerEvent, p: { x: number; y: number }): boolean {
        if (this.#mode === 'none' || e.pointerId !== this.#pointerId) return false
        if (this.#mode === 'marquee') this.#deps.selection.endMarquee(p.x, p.y)
        this.#mode = 'none'
        return true
    }

    pointerCancel(): boolean {
        if (this.#mode === 'none') return false
        this.#mode = 'none'
        return true
    }

    keyDown(e: KeyboardEvent): boolean {
        const { selection } = this.#deps

        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
            const key = e.key.toLowerCase()
            if (key === 'a') {
                e.preventDefault()
                if (e.shiftKey) selection.deselect()
                else selection.selectAll()
                return true
            }
            if (key === 'i' && selection.active) {
                e.preventDefault()
                selection.invert()
                return true
            }
            return false
        }

        if (!selection.active) return false

        const nudge = ARROW_NUDGE[e.key]
        if (nudge) {
            e.preventDefault()
            selection.nudge(nudge[0], nudge[1])
            return true
        }

        if (e.key === 'Enter') {
            e.preventDefault()
            selection.commit()
            return true
        }

        if (e.key === 'Escape') {
            e.preventDefault()
            selection.cancel()
            return true
        }

        return false
    }
}

function maskModeFor(event: PointerEvent): MaskMode {
    if (event.shiftKey && event.altKey) return 'intersect'
    if (event.shiftKey) return 'add'
    if (event.altKey) return 'subtract'

    return 'replace'
}
