import {
    BRUSH_MAX_SIZE,
    getPixel,
    inBounds,
    type Sprite,
    type TransformKind,
} from '@starforge/core'
import type { Viewport } from '../../render/viewport'
import type { PlaybackController } from '../frames/playbackController'
import type { GestureController } from '../gesture'
import type { ReadoutStore } from '../readout'
import type { SelectionController } from '../selection/selectionController'
import type { TransformController } from '../transform/transformController'
import type { EditTarget } from '../../document/session'
import type { EditorStore } from '../store'
import type { Mods } from '../tools'
import { panBy, stepZoom } from '../view'
import { isGestureTool } from '../tools/registry'
import { brushStepForKey, toolForKey } from './keymap'
import { SelectionInput } from './selectionInput'
import { WheelZoom } from './wheelZoom'

export interface InputDeps {
    canvas: HTMLCanvasElement
    sprite: Sprite

    target: () => EditTarget
    viewport: Viewport
    gestures: GestureController
    selection: SelectionController
    transforms: TransformController
    store: EditorStore
    readout: ReadoutStore
    playback: PlaybackController

    requestRender: () => void
}

export class EditorInput {
    readonly #deps: InputDeps
    readonly #selection: SelectionInput

    #spaceHeld = false
    #panning = false
    readonly #wheel = new WheelZoom()
    #pointerId = -1

    #lastX = 0
    #lastY = 0

    readonly #touches = new Map<number, { x: number; y: number }>()
    #pinchDistance = 0
    #pinchX = 0
    #pinchY = 0

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

    sync(): void {
        this.#updateCursor()
        this.#syncHover()
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

    #sample(p: { x: number; y: number }): void {
        const { sprite, store } = this.#deps
        const { layer, frame } = this.#deps.target()
        const color = getPixel(sprite, layer, frame, p.x, p.y)
        if ((color & 0xff) !== 0) store.pickColor(color)
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

        const color = getPixel(
            sprite,
            this.#deps.target().layer,
            this.#deps.playback.frame,
            this.#hoverX,
            this.#hoverY,
        )
        if (prev?.x === this.#hoverX && prev.y === this.#hoverY && prev.color === color) return
        readout.patch({ hover: { x: this.#hoverX, y: this.#hoverY, color } })
    }

    #moveHover(p: { x: number; y: number }): void {
        this.#hoverX = p.x
        this.#hoverY = p.y
        this.#syncHover()
    }

    get #pinching(): boolean {
        return this.#touches.size >= 2
    }

    #beginPinch(): void {
        const [a, b] = [...this.#touches.values()]
        if (!a || !b) return

        this.#pinchDistance = Math.hypot(a.x - b.x, a.y - b.y)
        this.#pinchX = (a.x + b.x) / 2
        this.#pinchY = (a.y + b.y) / 2

        this.#deps.gestures.abort()
        this.#deps.selection.cancel()
        this.#panning = false
        this.#updateCursor()
    }

    #movePinch(): void {
        const { viewport, readout } = this.#deps
        const [a, b] = [...this.#touches.values()]
        if (!a || !b) return

        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        const midX = (a.x + b.x) / 2
        const midY = (a.y + b.y) / 2

        viewport.refreshRect()
        const anchor = viewport.toCanvas(midX, midY)

        const ratio = this.#pinchDistance === 0 ? 1 : distance / this.#pinchDistance
        if (ratio > Math.SQRT2 || ratio < Math.SQRT1_2) {
            stepZoom(viewport.view, ratio > 1 ? 1 : -1, anchor.x, anchor.y)
            this.#pinchDistance = distance
            readout.patch({ zoom: viewport.view.zoom })
        }

        panBy(
            viewport.view,
            (midX - this.#pinchX) * viewport.dpr,
            (midY - this.#pinchY) * viewport.dpr,
        )
        this.#pinchX = midX
        this.#pinchY = midY

        viewport.clampPan()
        viewport.markAdjusted()
        this.#deps.requestRender()
    }

    #onPointerDown = (e: PointerEvent): void => {
        const { canvas, viewport, gestures, store } = this.#deps

        if (e.pointerType === 'touch') {
            this.#touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
            canvas.setPointerCapture(e.pointerId)

            if (this.#pinching) {
                e.preventDefault()
                this.#beginPinch()
                return
            }
        }

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
        this.#deps.playback.pause()
        const p = viewport.toSprite(e.clientX, e.clientY)

        const tool = store.state.tool
        if (!isGestureTool(tool)) {
            if (this.#selection.shape) this.#selection.pointerDown(e, p)
            else this.#sample(p)
            this.#moveHover(p)

            return
        }

        if (e.altKey) {
            this.#sample(p)
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

        if (e.pointerType === 'touch' && this.#touches.has(e.pointerId)) {
            this.#touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
            if (this.#pinching) {
                e.preventDefault()
                this.#movePinch()
                return
            }
        }
        if (this.#pinching) return

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
            viewport.clampPan()
            viewport.markAdjusted()
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

        if (this.#touches.delete(e.pointerId) && this.#touches.size > 0) return

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

    #onPointerCancel = (e: PointerEvent): void => {
        if (this.#touches.delete(e.pointerId) && this.#touches.size > 0) return

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

        const direction = this.#wheel.step(e.deltaY, e.deltaMode)
        if (direction !== 0) {
            viewport.refreshRect()
            stepZoom(viewport.view, direction, e.offsetX * viewport.dpr, e.offsetY * viewport.dpr)
            viewport.clampPan()
            viewport.markAdjusted()
            readout.patch({ zoom: viewport.view.zoom })
            this.#deps.requestRender()
        }
        this.#moveHover(viewport.toSprite(e.clientX, e.clientY))
    }

    #onKeyDown = (e: KeyboardEvent): void => {
        if (isEditableTarget(e.target)) return

        const { store, gestures } = this.#deps
        if (e.code === 'Space') {
            if (e.target instanceof HTMLButtonElement) return
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

        if (e.code === 'Enter' || e.code === 'NumpadEnter') {
            if (e.target instanceof HTMLButtonElement || e.repeat) return
            e.preventDefault()
            this.#deps.playback.toggle()
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

        if (e.shiftKey) {
            const kind = TRANSFORM_KEYS[key]
            if (kind) {
                e.preventDefault()
                this.#deps.transforms.apply(kind)
                return
            }
        }

        if (key === 'x') {
            store.swapColors()
            return
        }
        if (key === 'd') {
            store.resetColors()
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

const TRANSFORM_KEYS: Readonly<Record<string, TransformKind | undefined>> = {
    h: 'flip-h',
    v: 'flip-v',
    r: 'rotate-cw',
    l: 'rotate-ccw',
}

function isEditableTarget(target: EventTarget | null): boolean {
    return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
    )
}
