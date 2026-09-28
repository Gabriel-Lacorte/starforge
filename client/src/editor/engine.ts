import type { DocumentSession, EditTarget } from '../document/session'
import type { ComposeBenchResult } from '../render/composeBench'
import { brushCursorFor, easeCursor, mirrorCursors } from '../render/brushPreview'
import { CursorLayer } from '../render/cursorLayer'
import { PreviewOverlay, type PeerCursor, type SymmetryGuides } from '../render/overlay'
import { Renderer } from '../render/renderer'
import { Viewport } from '../render/viewport'
import type { TransformKind } from '@starforge/core'
import type { PlaybackController } from './frames/playbackController'
import { GestureController } from './gesture'
import type { StrokeBroadcast } from './strokeBroadcast'
import { CanvasController } from './transform/canvasController'
import { TransformController } from './transform/transformController'
import { EditorInput } from './input/EditorInput'
import type { LayersController } from './layers/layersController'
import type { PaletteController } from './palette/paletteController'
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
    clearSelection(): void
    readonly canvas: CanvasController
    hasSelection(): boolean
    zoom(direction: 1 | -1): void
    fit(): void
}

export function startEditor(
    canvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
    cursorCanvas: HTMLCanvasElement,
    session: DocumentSession,
    store: EditorStore,
    readout: ReadoutStore,
    layers: LayersController,
    playback: PlaybackController,
    palette: PaletteController,
    isActive: () => boolean = () => true,
    peersProvider: () => readonly PeerCursor[] | null = () => null,
    stroke: StrokeBroadcast | null = null,
): EditorHandle {
    const sprite = session.doc
    const target = (): EditTarget => session.target.state
    stroke?.setWidth(sprite.width)

    let needsRender = true
    let ready = false
    const invalidate = () => {
        needsRender = true
    }

    const renderer = new Renderer(canvas)
    const overlay = new PreviewOverlay(overlayCanvas, sprite.width, sprite.height)
    const cursorLayer = new CursorLayer(cursorCanvas)
    const viewport = new Viewport(
        canvas,
        overlayCanvas,
        cursorCanvas,
        sprite.width,
        sprite.height,
        {
            onResize: () => {
                invalidate()
                if (ready) draw()
            },
            onFit: (zoom) => {
                readout.patch({ zoom })
            },
        },
    )

    viewport.refreshRect()
    viewport.fit()
    readout.patch({ zoom: viewport.view.zoom })

    const selection = new SelectionController({
        sprite,
        target,
        session,
        onChange: () => {
            if (readout.state.selectionActive !== selection.active) {
                readout.patch({ selectionActive: selection.active })
            }
            input.sync()
            invalidate()
        },
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
        ...(stroke !== null ? { broadcast: stroke } : {}),
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
        palette,
        isActive,
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
        const geometry = toolDefinition(store.state.tool).geometry
        const mirrors =
            geometry === 'freehand' ||
            geometry === 'line' ||
            geometry === 'rect' ||
            geometry === 'ellipse'
        if (!mirrors) return null

        const { symmetryH, symmetryV } = store.state
        if (!symmetryH && !symmetryV) return null

        return { h: symmetryH, v: symmetryV }
    }

    let cursorPos: { x: number; y: number } | null = null

    const DEV = import.meta.env.DEV
    let lastRenderMs = 0

    function draw(): void {
        needsRender = false

        const frame = playback.frame
        const ghosts = playback.state.playing
            ? NO_GHOSTS
            : ghostFrames(sprite.frames, frame, store.state.onion)

        const t0 = DEV ? performance.now() : 0
        renderer.render(sprite, frame, viewport.view, ghosts)
        const primary = cursorPos === null ? null : brushCursorFor(store.state, cursorPos)
        const cursors =
            primary === null
                ? null
                : [
                      primary,
                      ...mirrorCursors(
                          primary,
                          sprite.width,
                          sprite.height,
                          store.state.symmetryH,
                          store.state.symmetryV,
                      ),
                  ]
        const boosts = cursorLayer.render(viewport.view, cursors, (x, y) =>
            renderer.sample(sprite, frame, x, y),
        )
        overlay.render(
            viewport.view,
            selection,
            symmetryGuides(),
            peersProvider(),
            target(),
            store.state.showGrid,
            boosts,
        )
        if (DEV) lastRenderMs = performance.now() - t0
    }

    ready = true

    let lastPeers: readonly PeerCursor[] | null = null
    let raf = requestAnimationFrame(function tick(now: number) {
        raf = requestAnimationFrame(tick)

        const peers = peersProvider()
        if (peers !== lastPeers) {
            lastPeers = peers
            invalidate()
        }

        const hover = readout.state.hover
        if (hover === null) {
            if (cursorPos !== null) {
                cursorPos = null
                invalidate()
            }
        } else if (cursorPos === null) {
            cursorPos = { x: hover.x, y: hover.y }
            invalidate()
        } else {
            const next = easeCursor(cursorPos, hover)
            if (next) {
                cursorPos = next
                invalidate()
            } else if (cursorPos.x !== hover.x || cursorPos.y !== hover.y) {
                cursorPos = { x: hover.x, y: hover.y }
            }
        }

        playback.tick(now)
        if (!needsRender) return

        draw()
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
            stroke?.end()
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

        clearSelection() {
            selection.deselect()
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
