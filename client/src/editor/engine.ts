import type { DocumentSession, EditTarget } from '../document/session'
import type { ComposeBenchResult } from '../render/composeBench'
import { PreviewOverlay, type SymmetryGuides } from '../render/overlay'
import { Renderer } from '../render/renderer'
import { Viewport } from '../render/viewport'
import type { TransformKind } from '@starforge/core'
import type { PlaybackController } from './frames/playbackController'
import { GestureController } from './gesture'
import { CanvasController } from './transform/canvasController'
import { TransformController } from './transform/transformController'
import { EditorInput } from './input/EditorInput'
import type { LayersController } from './layers/layersController'
import type { ReadoutStore } from './readout'
import { SelectionController } from './selection/selectionController'
import type { EditorStore } from './store'
import { stepZoom } from './view'
import { toolDefinition } from './tools'
import { ghostFrames, type Ghost } from '../render/onion'

const NO_GHOSTS: readonly Ghost[] = []

export interface EditorHandle {
    dispose(): void
    history(direction: 'undo' | 'redo'): void
    transform(kind: TransformKind): void
    readonly canvas: CanvasController
    hasSelection(): boolean
    zoom(direction: 1 | -1): void
    fit(): void
}

export function startEditor(
    canvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
    session: DocumentSession,
    store: EditorStore,
    readout: ReadoutStore,
    layers: LayersController,
    playback: PlaybackController,
): EditorHandle {
    const sprite = session.doc
    const target = (): EditTarget => session.target.state

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

    viewport.refreshRect()
    viewport.fit()
    readout.patch({ zoom: viewport.view.zoom })

    const selection = new SelectionController({
        sprite,
        target,
        session,
        onChange: invalidate,
        invalidate: (layer, frameId, x, y, w, h) => {
            renderer.invalidate(sprite, layer, frameId, x, y, w, h)
        },
    })

    const gestures = new GestureController({
        sprite,
        target,
        selection: () => selection.mask,
        session,
        renderer,
        overlay,
        store,
        requestRender: invalidate,
    })

    const canvas2d = new CanvasController({
        sprite,
        session,
        selection: () => selection.mask,
        settle: () => {
            if (gestures.active) gestures.abort()
            selection.cancel()
        },
    })

    const transforms = new TransformController({
        sprite,
        session,
        selection: () => selection.mask,
        reselect: (mask) => {
            selection.reselect(mask)
        },
        settle: () => {
            if (gestures.active) gestures.abort()
            if (selection.floating) selection.commit()
        },
    })

    const input = new EditorInput({
        canvas,
        sprite,
        target,
        viewport,
        gestures,
        selection,
        transforms,
        store,
        readout,
        playback,
        requestRender: invalidate,
    })

    session.setBeforeChange(() => {
        playback.pause()
        if (gestures.active) gestures.abort()
        if (selection.active) selection.commit()
    })

    const syncHistory = () => {
        const { canUndo, canRedo } = readout.state
        if (canUndo === session.canUndo && canRedo === session.canRedo) return
        readout.patch({ canUndo: session.canUndo, canRedo: session.canRedo })
    }

    const unsubscribe = session.subscribe((change) => {
        if (change.kind === 'pixels') {
            const { x, y, w, h } = change.rect
            renderer.invalidate(sprite, change.layer, change.frame, x, y, w, h)
        }
        input.sync()
        syncHistory()
        invalidate()
    })

    const unsubscribeStore = store.subscribe(() => {
        invalidate()
        input.sync()
    })

    const unsubscribePlayback = playback.subscribe(() => {
        input.sync()
        invalidate()
    })

    const unsubscribeTarget = session.target.subscribe(() => {
        input.sync()
        invalidate()
    })

    const symmetryGuides = (): SymmetryGuides | null => {
        if (toolDefinition(store.state.tool).geometry !== 'freehand') return null

        const { symmetryH, symmetryV } = store.state
        if (!symmetryH && !symmetryV) return null

        return { h: symmetryH, v: symmetryV }
    }

    const DEV = import.meta.env.DEV
    let lastRenderMs = 0

    let raf = requestAnimationFrame(function tick(now: number) {
        raf = requestAnimationFrame(tick)

        playback.tick(now)
        if (!needsRender) return
        needsRender = false

        const frame = playback.frame
        const ghosts = playback.state.playing
            ? NO_GHOSTS
            : ghostFrames(sprite.frames, frame, store.state.onion)

        const t0 = DEV ? performance.now() : 0
        renderer.render(sprite, playback.frame, viewport.view, ghosts)
        overlay.render(viewport.view, selection, symmetryGuides())
        if (DEV) lastRenderMs = performance.now() - t0
    })

    if (DEV) {
        const devWindow = window as Window & { __starforge?: unknown }
        devWindow.__starforge = {
            session,
            store,
            layers,
            sprite,
            stats: () => ({
                recompositions: renderer.stats.recompositions,
                renderMs: lastRenderMs,
            }),
            benchCompose: (size?: number, layerCount?: number): Promise<ComposeBenchResult> =>
                import('../render/composeBench').then((m) => m.benchCompose(size, layerCount)),
        }
    }

    return {
        dispose() {
            cancelAnimationFrame(raf)
            playback.pause()
            unsubscribe()
            unsubscribePlayback()
            unsubscribeStore()
            unsubscribeTarget()
            input.dispose()
            viewport.dispose()
        },

        history(direction) {
            gestures.history(direction)
            syncHistory()
        },

        transform(kind) {
            transforms.apply(kind)
        },

        canvas: canvas2d,

        hasSelection() {
            return selection.active
        },

        zoom(direction) {
            stepZoom(viewport.view, direction, canvas.width / 2, canvas.height / 2)
            viewport.clampPan()
            viewport.markAdjusted()
            readout.patch({ zoom: viewport.view.zoom })
            invalidate()
        },

        fit() {
            viewport.fit()
            readout.patch({ zoom: viewport.view.zoom })
            invalidate()
        },
    }
}
