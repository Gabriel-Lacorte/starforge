import type { Sprite } from '@starforge/core'
import { Renderer } from '../render/renderer'
import { createView, fitSprite, panBy, stepZoom, type Zoom } from './view'

export interface EditorEvents {
    onZoom(zoom: Zoom): void
}

export function startEditor(
    canvas: HTMLCanvasElement,
    sprite: Sprite,
    events: EditorEvents,
): () => void {
    const frameId = sprite.frames[0]?.id
    if (!frameId) throw new Error('sprite has no frames')

    const renderer = new Renderer(canvas)
    const view = createView()

    let needsRender = true
    const invalidate = () => {
        needsRender = true
    }

    /* --- sizing */
    let dpr = window.devicePixelRatio
    let fitted = false

    const resize = () => {
        dpr = window.devicePixelRatio

        const rect = canvas.getBoundingClientRect()

        const w = Math.max(1, Math.round(rect.width * dpr))
        const h = Math.max(1, Math.round(rect.height * dpr))
        if (canvas.width === w && canvas.height === h) return
        canvas.width = w
        canvas.height = h

        if (!fitted && rect.width > 0) {
            fitSprite(view, sprite.width, sprite.height, w, h)
            fitted = true
            events.onZoom(view.zoom)
        }

        invalidate()
    }

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    /* browser zoom change dpr without necessarily resizing the element */
    /* the media query must be rebuilt for each new ratio. */
    let dprQuery: MediaQueryList | null = null
    const onDprChange = () => {
        resize()
        watchDpr()
    }
    const watchDpr = () => {
        dprQuery?.removeEventListener('change', onDprChange)
        dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
        dprQuery.addEventListener('change', onDprChange)
    }
    watchDpr()

    /* --- input */
    let panning = false
    let spaceHeld = false

    let lastX = 0
    let lastY = 0

    const updateCursor = () => {
        canvas.style.cursor = panning ? 'grabbing' : spaceHeld ? 'grab' : 'crosshair'
    }

    const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 1 && !(e.button === 0 && spaceHeld)) return
        e.preventDefault()

        panning = true
        lastX = e.clientX
        lastY = e.clientY

        canvas.setPointerCapture(e.pointerId)
        updateCursor()
    }

    const onPointerMove = (e: PointerEvent) => {
        if (!panning) return
        panBy(view, (e.clientX - lastX) * dpr, (e.clientY - lastY) * dpr)

        lastX = e.clientX
        lastY = e.clientY

        invalidate()
    }

    const onPointerEnd = () => {
        if (!panning) return
        panning = false
        updateCursor()
    }

    const onWheel = (e: WheelEvent) => {
        e.preventDefault()
        if (e.deltaY === 0) return

        stepZoom(view, e.deltaY < 0 ? 1 : -1, e.offsetX * dpr, e.offsetY * dpr)
        events.onZoom(view.zoom)

        invalidate()
    }

    const onKeyDown = (e: KeyboardEvent) => {
        if (e.code !== 'Space' || e.repeat || isEditableTarget(e.target)) return
        e.preventDefault()
        spaceHeld = true
        updateCursor()
    }

    const onKeyUp = (e: KeyboardEvent) => {
        if (e.code !== 'Space') return
        spaceHeld = false
        updateCursor()
    }

    updateCursor()
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerEnd)
    canvas.addEventListener('pointercancel', onPointerEnd)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    /* --- render loop */
    let raf = requestAnimationFrame(function tick() {
        raf = requestAnimationFrame(tick)
        if (!needsRender) return
        needsRender = false
        renderer.render(sprite, frameId, view)
    })

    return () => {
        cancelAnimationFrame(raf)
        observer.disconnect()
        dprQuery?.removeEventListener('change', onDprChange)
        canvas.removeEventListener('pointerdown', onPointerDown)
        canvas.removeEventListener('pointermove', onPointerMove)
        canvas.removeEventListener('pointerup', onPointerEnd)
        canvas.removeEventListener('pointercancel', onPointerEnd)
        canvas.removeEventListener('wheel', onWheel)
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('keyup', onKeyUp)
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
