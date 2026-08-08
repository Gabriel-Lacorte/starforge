import { BRUSH_MAX_SIZE, getPixel, inBounds, type Sprite } from '@starforge/core'
import type { Viewport } from '../../render/viewport'
import type { GestureController } from '../gesture'
import type { ReadoutStore } from '../readout'
import type { SelectionController } from '../selection/selectionController'
import type { EditTarget, EditorStore } from '../store'
import type { Mods } from '../tools'
import { panBy, stepZoom } from '../view'
import { brushStepForKey, toolForKey } from './keymap'
import { SelectionInput } from './selectionInput'

export interface InputDeps {
    canvas: HTMLCanvasElement
    sprite: Sprite

    target: () => EditTarget
    viewport: Viewport
    gestures: GestureController
    selection: SelectionController
    store: EditorStore
    readout: ReadoutStore

    requestRender: () => void
}

export class EditorInput {
    readonly #deps: InputDeps
    readonly #selection: SelectionInput

    #spaceHeld = false
    #panning = false
    #pointerId = -1

    #lastX = 0
    #lastY = 0

    #hoverX = 0
    #hoverY = -1

    constructor(deps: InputDeps) {
        this.#deps = deps
        this.#selection = new SelectionInput({
            canvas: deps.canvas,
            viewport: deps.viewport,
            selection: deps.selection,
            store: deps.store,
        })
        this.#updateCursor()

        const c = deps.canvas
        c.addEventListener('pointerdown', this.#onPointerDown)
        c.addEventListener('pointermove', this.#onPointerMove)
        c.addEventListener('pointerup', this.#onPointerUp)
        c.addEventListener('pointercancel', this.#onPointerCancel)
        c.addEventListener('pointerleave', this.#onPointerLeave)
        c.addEventListener('wheel', this.#onWheel, { passive: false })
        c.addEventListener('contextmenu', this.#onContextMenu)
        window.addEventListener('keydown', this.#onKeyDown)
        window.addEventListener('keyup', this.#onKeyUp)
    }

    dispose(): void {
        this.#selection.dispose()

        const c = this.#deps.canvas
        c.removeEventListener('pointerdown', this.#onPointerDown)
        c.removeEventListener('pointermove', this.#onPointerMove)
        c.removeEventListener('pointerup', this.#onPointerUp)
        c.removeEventListener('pointercancel', this.#onPointerCancel)
        c.removeEventListener('pointerleave', this.#onPointerLeave)
        c.removeEventListener('wheel', this.#onWheel)
        c.removeEventListener('contextmenu', this.#onContextMenu)
        window.removeEventListener('keydown', this.#onKeyDown)
        window.removeEventListener('keyup', this.#onKeyUp)
    }

    syncCursor(): void {
        this.#updateCursor()
    }

    #updateCursor(): void {
        this.#deps.canvas.style.cursor = this.#panning
            ? 'grabbing'
            : this.#spaceHeld
              ? 'grab'
              : this.#activeLocked()
                ? 'not-allowed'
                : 'crosshair'
    }

    #activeLocked(): boolean {
        const { sprite } = this.#deps
        const id = this.#deps.target().layer
        return sprite.layers.find((l) => l.id === id)?.locked ?? false
    }

    #mods(e: MouseEvent): Mods {
        return { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey }
    }

    #syncHover(): void {
        const { readout, sprite } = this.#deps
        const prev = readout.state.hover
        if (!inBounds(sprite, this.#hoverX, this.#hoverY)) {
            if (prev) readout.patch({ hover: null })
            return
        }

        const { layer, frame } = this.#deps.target()
        const color = getPixel(sprite, layer, frame, this.#hoverX, this.#hoverY)
        if (prev?.x === this.#hoverX && prev.y === this.#hoverY && prev.color === color) return
        readout.patch({ hover: { x: this.#hoverX, y: this.#hoverY, color } })
    }

    #moveHover(p: { x: number; y: number }): void {
        this.#hoverX = p.x
        this.#hoverY = p.y
        this.#syncHover()
    }

    #onPointerDown = (e: PointerEvent): void => {
        const { canvas, viewport, gestures, store, sprite } = this.#deps

        if (gestures.active || this.#panning || this.#selection.busy) return
        viewport.refreshRect()

        if (e.button === 1 || (e.button === 0 && this.#spaceHeld)) {
            e.preventDefault()
            this.#panning = true
            this.#lastX = e.clientX
            this.#lastY = e.clientY
            canvas.setPointerCapture(e.pointerId)
            this.#updateCursor()
            return
        }
        if (e.button !== 0) return
        e.preventDefault()
        const p = viewport.toSprite(e.clientX, e.clientY)

        if (e.altKey) {
            const { layer, frame } = this.#deps.target()
            const color = getPixel(sprite, layer, frame, p.x, p.y)
            if ((color & 0xff) !== 0) store.patch({ color })
            this.#moveHover(p)
            return
        }

        const tool = store.state.tool
        if (tool === 'select') {
            this.#selection.pointerDown(e, p)
            this.#moveHover(p)
            return
        }

        this.#pointerId = e.pointerId
        canvas.setPointerCapture(e.pointerId)
        gestures.begin(tool, p.x, p.y, this.#mods(e))
        this.#moveHover(p)
    }

    #onPointerMove = (e: PointerEvent): void => {
        const { viewport, gestures } = this.#deps
        viewport.refreshRect()
        if (this.#selection.busy) {
            const p = viewport.toSprite(e.clientX, e.clientY)
            if (this.#selection.pointerMove(e, p)) this.#moveHover(p)
            return
        }
        if (this.#panning) {
            panBy(
                viewport.view,
                (e.clientX - this.#lastX) * viewport.dpr,
                (e.clientY - this.#lastY) * viewport.dpr,
            )
            this.#lastX = e.clientX
            this.#lastY = e.clientY
            this.#deps.requestRender()
            this.#moveHover(viewport.toSprite(e.clientX, e.clientY))
            return
        }
        if (!gestures.active || e.pointerId !== this.#pointerId) {
            this.#moveHover(viewport.toSprite(e.clientX, e.clientY))
            return
        }
        const coalesced = e.getCoalescedEvents()
        const samples = coalesced.length > 0 ? coalesced : [e]
        const m = this.#mods(e)
        let sx = -1
        let sy = -1
        for (const sample of samples) {
            const p = viewport.toSprite(sample.clientX, sample.clientY)
            if (p.x === sx && p.y === sy) continue
            sx = p.x
            sy = p.y
            gestures.move(p.x, p.y, m)
        }
        gestures.endBatch()
        this.#moveHover(viewport.toSprite(e.clientX, e.clientY))
    }

    #onPointerUp = (e: PointerEvent): void => {
        const { viewport, gestures } = this.#deps
        if (this.#panning) {
            this.#panning = false
            this.#updateCursor()
            return
        }
        if (this.#selection.busy) {
            viewport.refreshRect()
            const p = viewport.toSprite(e.clientX, e.clientY)
            if (this.#selection.pointerUp(e, p)) this.#moveHover(p)
            return
        }
        if (gestures.active && e.pointerId === this.#pointerId && e.button === 0) {
            viewport.refreshRect()
            const p = viewport.toSprite(e.clientX, e.clientY)
            gestures.finish(p.x, p.y, this.#mods(e))
            this.#moveHover(p)
        }
    }

    #onPointerCancel = (): void => {
        if (this.#panning) {
            this.#panning = false
            this.#updateCursor()
            return
        }
        if (this.#selection.pointerCancel()) return
        this.#deps.gestures.abort()
        this.#syncHover()
    }

    #onPointerLeave = (): void => {
        this.#hoverY = -1
        this.#syncHover()
    }

    #onWheel = (e: WheelEvent): void => {
        const { viewport, readout } = this.#deps
        e.preventDefault()
        if (e.deltaY === 0) return
        viewport.refreshRect()
        stepZoom(
            viewport.view,
            e.deltaY < 0 ? 1 : -1,
            e.offsetX * viewport.dpr,
            e.offsetY * viewport.dpr,
        )
        readout.patch({ zoom: viewport.view.zoom })
        this.#deps.requestRender()
        this.#moveHover(viewport.toSprite(e.clientX, e.clientY))
    }

    #onKeyDown = (e: KeyboardEvent): void => {
        if (isEditableTarget(e.target)) return

        const { store, gestures } = this.#deps
        if (e.code === 'Space') {
            if (e.repeat) return
            e.preventDefault()
            this.#spaceHeld = true
            this.#updateCursor()
            return
        }

        if (this.#selection.keyDown(e)) {
            this.#syncHover()
            return
        }

        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
            const key = e.key.toLowerCase()
            if (key === 'z') {
                e.preventDefault()
                gestures.history(e.shiftKey ? 'redo' : 'undo')
                this.#syncHover()
            } else if (key === 'y') {
                e.preventDefault()
                gestures.history('redo')
                this.#syncHover()
            }

            return
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return

        const key = e.key.toLowerCase()
        const tool = toolForKey(key, store.state.tool)
        if (tool) {
            store.patch({ tool })
            return
        }

        const step = brushStepForKey(e.key)
        if (step) {
            const size = Math.max(1, Math.min(BRUSH_MAX_SIZE, store.state.brushSize + step))
            store.patch({ brushSize: size })
            return
        }

        if (key === 'escape') {
            gestures.abort()
            this.#syncHover()
        }
    }

    #onKeyUp = (e: KeyboardEvent): void => {
        if (e.code !== 'Space') return
        this.#spaceHeld = false
        this.#updateCursor()
    }

    #onContextMenu = (e: Event): void => {
        e.preventDefault()
    }
}

function isEditableTarget(target: EventTarget | null): boolean {
    return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
    )
}
