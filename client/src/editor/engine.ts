import type { DocumentSession } from '../document/session'
import { PreviewOverlay } from '../render/overlay'
import { Renderer } from '../render/renderer'
import { Viewport } from '../render/viewport'
import { GestureController } from './gesture'
import { EditorInput } from './input/EditorInput'
import type { ReadoutStore } from './readout'
import { SelectionController } from './selectionController'
import type { EditorStore } from './store'

export function startEditor(
    canvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
    session: DocumentSession,
    store: EditorStore,
    readout: ReadoutStore,
): () => void {
    const sprite = session.doc

    const layer = sprite.layers[0]?.id
    const frame = sprite.frames[0]?.id
    if (!layer || !frame) throw new Error('sprite has no layers or frames')

    let needsRender = true
    const invalidate = () => {
        needsRender = true
    }

    const renderer = new Renderer(canvas)
    const overlay = new PreviewOverlay(overlayCanvas, sprite.width, sprite.height)
    const viewport = new Viewport(canvas, overlayCanvas, sprite.width, sprite.height, {
        onResize: invalidate,
        onFit: (zoom) => {
            readout.patch({ zoom })
        },
    })

    const gestures = new GestureController({
        sprite,
        layer,
        frame,
        session,
        renderer,
        overlay,
        store,
        requestRender: invalidate,
    })

    const selection = new SelectionController({
        sprite,
        layer,
        frame,
        session,
        onChange: invalidate,
        invalidate: (x, y, w, h) => {
            renderer.invalidate(sprite, layer, frame, x, y, w, h)
        },
    })

    const unsubscribe = session.subscribe((change) => {
        if (change.kind !== 'pixels') return
        const { x, y, w, h } = change.rect
        renderer.invalidate(sprite, change.layer, change.frame, x, y, w, h)
        invalidate()
    })

    const input = new EditorInput({
        canvas,
        sprite,
        layer,
        frame,
        viewport,
        gestures,
        selection,
        store,
        readout,
        requestRender: invalidate,
    })

    let raf = requestAnimationFrame(function tick() {
        raf = requestAnimationFrame(tick)

        if (!needsRender) return
        needsRender = false
        renderer.render(sprite, frame, viewport.view)
        overlay.render(viewport.view, selection)
    })

    return () => {
        cancelAnimationFrame(raf)
        unsubscribe()
        input.dispose()
        viewport.dispose()
    }
}
