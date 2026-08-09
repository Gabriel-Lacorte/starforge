import { rgbaToHex, type Sprite } from '@starforge/core'
import { TOOL_CATALOG } from '../tools/catalog'
import { ZOOM_LEVELS } from '../view'
import type { LayersController } from '../layers/layersController'
import type { ReadoutStore } from '../readout'
import type { EditorStore } from '../store'
import { LockedIcon } from './icons'
import { useStore } from './useStore'
import styles from './StatusBar.module.css'

type HoverView =
    | { readonly pos: string; readonly empty: true }
    | { readonly pos: string; readonly empty: false; readonly hex: string }

const ZOOM_MIN = ZOOM_LEVELS[0]
const ZOOM_MAX = ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!

const SAVE_LABEL = {
    pending: 'saving',
    saved: 'saved',
    failed: 'not saved',
} as const

const EXPORT_LABEL = {
    working: 'exporting',
    done: 'exported',
    failed: 'export failed',
} as const

const EXPORT_TITLE = {
    working: 'Building the PNG',
    done: 'The PNG was written to your downloads',
    failed: 'The browser could not write the PNG. Try a smaller sprite, or reload',
} as const

export function StatusBar({
    sprite,
    store,
    readout,
    layers,
    onZoom,
    onFit,
}: {
    sprite: Sprite
    store: EditorStore
    readout: ReadoutStore
    layers: LayersController
    onZoom: (direction: 1 | -1) => void
    onFit: () => void
}) {
    useStore(layers)
    const state = useStore(store)
    const { zoom, hover, save, exportState } = useStore(readout)

    const active = sprite.layers.find((l) => l.id === state.activeLayer)
    const hasBrush =
        TOOL_CATALOG.find((tool) => tool.id === state.tool)?.options.includes('brush') ?? false

    const hoverView: HoverView | null = hover
        ? (hover.color & 0xff) !== 0
            ? { pos: `${hover.x}, ${hover.y}`, empty: false, hex: rgbaToHex(hover.color) }
            : { pos: `${hover.x}, ${hover.y}`, empty: true }
        : null

    return (
        <footer class={`bar ${styles.statusbar}`}>
            <span class={styles.docTitle}>{sprite.meta.title}</span>
            <span class="mono">
                {sprite.width}x{sprite.height}
            </span>

            <span class={styles.cursor} title="Pixel under the cursor">
                <span class={`mono ${styles.pos}`} data-testid="hover-pos">
                    {hoverView ? hoverView.pos : '-'}
                </span>
                {hoverView &&
                    (hoverView.empty ? (
                        <>
                            <span class="chip chip-empty" />
                            <span class="mono dim" data-testid="hover-label">
                                empty
                            </span>
                        </>
                    ) : (
                        <>
                            <span class="chip" style={{ background: hoverView.hex }} />
                            <span class="mono dim" data-testid="hover-label">
                                {hoverView.hex}
                            </span>
                        </>
                    ))}
            </span>

            <span class={styles.toolStatus}>
                <span class="chip" style={{ background: rgbaToHex(state.color) }} />
                <span class="mono" data-testid="status-tool">
                    {state.tool}
                </span>
                {hasBrush && (
                    <span class="mono dim" data-testid="status-brush">
                        brush {state.brushSize}
                    </span>
                )}
            </span>

            {active?.locked && (
                <span
                    class={`mono ${styles.locked}`}
                    data-testid="status-locked"
                    title={`"${active.name}" is locked`}
                >
                    <LockedIcon />
                    locked
                </span>
            )}

            {exportState && (
                <span
                    class={`mono ${styles.save}${exportState === 'failed' ? ` ${styles.saveFailed}` : ''}`}
                    data-testid="status-export"
                    title={EXPORT_TITLE[exportState]}
                    role="status"
                >
                    {EXPORT_LABEL[exportState]}
                </span>
            )}

            {save && (
                <span
                    class={`mono ${styles.save}${save === 'failed' ? ` ${styles.saveFailed}` : ''}`}
                    data-testid="status-save"
                    role="status"
                    title={
                        save === 'failed'
                            ? 'This browser refused to store the drawing. Export it before you leave'
                            : 'Kept in this browser. It comes back when you reload'
                    }
                >
                    {SAVE_LABEL[save]}
                </span>
            )}

            <span class={styles.zoomGroup}>
                <button
                    type="button"
                    class={styles.zoomBtn}
                    title="Zoom out"
                    aria-label="Zoom out"
                    data-testid="zoom-out"
                    disabled={zoom <= ZOOM_MIN}
                    onClick={() => onZoom(-1)}
                >
                    -
                </button>
                <button
                    type="button"
                    class={`mono ${styles.zoom}`}
                    title="Fit the document to the window"
                    data-testid="zoom"
                    onClick={onFit}
                >
                    {zoom * 100}%
                </button>
                <button
                    type="button"
                    class={styles.zoomBtn}
                    title="Zoom in"
                    aria-label="Zoom in"
                    data-testid="zoom-in"
                    disabled={zoom >= ZOOM_MAX}
                    onClick={() => onZoom(1)}
                >
                    +
                </button>
            </span>
        </footer>
    )
}
