import type { DocumentSession } from '../document/session'
import { PreviewOverlay } from '../render/overlay'
import { Renderer } from '../render/renderer'
import { Viewport } from '../render/viewport'
import { GestureController } from './gesture'
import { EditorInput } from './input/EditorInput'
import type { LayersController } from './layers/layersController'
import type { ReadoutStore } from './readout'
import { SelectionController } from './selection/selectionController'
import type { EditorStore, EditTarget } from './store'

export function startEditor(
    canvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
    session: DocumentSession,
    store: EditorStore,
    readout: ReadoutStore,
    layers: LayersController,
): () => void {
    const sprite = session.doc

    const layer = sprite.layers[0]?.id
    const frame = sprite.frames[0]?.id
    if (!layer || !frame) throw new Error('sprite has no layers or frames')

    const target = (): EditTarget => ({ layer: store.state.activeLayer, frame })

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
        target,
        session,
        renderer,
        overlay,
        store,
        requestRender: invalidate,
    })

    const selection = new SelectionController({
        sprite,
        target,
        session,
        onChange: invalidate,
        invalidate: (layer, frameId, x, y, w, h) => {
            renderer.invalidate(sprite, layer, frameId, x, y, w, h)
        },
    })

    layers.setBeforeStructural(() => {
        if (selection.active) selection.commit()
    })

    const input = new EditorInput({
        canvas,
        sprite,
        target,
        viewport,
        gestures,
        selection,
        store,
        readout,
        requestRender: invalidate,
    })

    const unsubscribe = session.subscribe((change) => {
        if (change.kind === 'pixels') {
            const { x, y, w, h } = change.rect
            renderer.invalidate(sprite, change.layer, change.frame, x, y, w, h)
        }
        input.syncCursor()
        invalidate()
    })

    const unsubscribeStore = store.subscribe(() => {
        input.syncCursor()
    })

    const DEV = import.meta.env.DEV
    let lastRenderMs = 0

    let raf = requestAnimationFrame(function tick() {
        raf = requestAnimationFrame(tick)

        if (!needsRender) return
        needsRender = false

        const t0 = DEV ? performance.now() : 0
        renderer.render(sprite, frame, viewport.view)
        overlay.render(viewport.view, selection)
        if (DEV) lastRenderMs = performance.now() - t0
    })

    if (DEV) {
        const devWindow = window as Window & { __starforge?: unknown }
        devWindow.__starforge = {
            session,
            store,
            layers,
            sprite,
            frame,
            stats: () => ({
                recompositions: renderer.stats.recompositions,
                renderMs: lastRenderMs,
            }),
            benchCompose: (size?: number, layerCount?: number) => {
                /* devtools helper: fire-and-forget is the point, the result prints itself */
                void import('../render/composeBench').then((m) => m.benchCompose(size, layerCount))
            },
        }
    }

    return () => {
        cancelAnimationFrame(raf)
        unsubscribe()
        unsubscribeStore()
        input.dispose()
        viewport.dispose()
    }
}
