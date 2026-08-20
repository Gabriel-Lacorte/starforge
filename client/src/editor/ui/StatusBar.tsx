import { rgbaToHex, SPRITE_TITLE_MAX, type Sprite } from '@starforge/core'
import { useEffect, useRef, useState } from 'preact/hooks'
import { TOOL_CATALOG } from '../tools/catalog'
import { toolCapabilities } from '../tools/definition'
import { ZOOM_LEVELS } from '../view'
import type { LayersController } from '../layers/layersController'
import type { ReadoutStore } from '../readout'
import type { PlaybackController } from '../frames/playbackController'
import type { EditorStore } from '../store'
import { LockedIcon } from './icons'
import type { EditTarget, Store } from '../../store'
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

const SAVE_SPEECH = {
    pending: 'Saving',
    saved: 'Saved in this browser. It comes back when you reload',
    failed: 'Not saved. This browser refused to store the drawing. Export it before you leave',
} as const

const EXPORT_TITLE = {
    working: 'Building the PNG',
    done: 'The PNG was written to your downloads',
    failed: 'The browser could not write the PNG. Try a smaller sprite, or reload',
} as const

export function StatusBar({
    sprite,
    target: targetStore,
    playback,
    store,
    readout,
    layers,
    onZoom,
    onFit,
    onRename,
}: {
    sprite: Sprite
    target: Store<EditTarget>
    playback: PlaybackController
    store: EditorStore
    readout: ReadoutStore
    layers: LayersController
    onZoom: (direction: 1 | -1) => void
    onFit: () => void
    onRename: (title: string) => void
}) {
    const [renaming, setRenaming] = useState(false)
    useStore(layers)
    const state = useStore(store)
    const target = useStore(targetStore)
    const reel = useStore(playback)
    const { zoom, hover, save, exportState, projectNotice } = useStore(readout)

    const active = sprite.layers.find((l) => l.id === target.layer)
    const frameNumber = sprite.frames.findIndex((f) => f.id === playback.frame) + 1
    const activeTool = TOOL_CATALOG.find((tool) => tool.id === state.tool)
    const hasBrush = activeTool ? toolCapabilities(activeTool).includes('brush') : false

    const hoverView: HoverView | null = hover
        ? (hover.color & 0xff) !== 0
            ? { pos: `${hover.x}, ${hover.y}`, empty: false, hex: rgbaToHex(hover.color) }
            : { pos: `${hover.x}, ${hover.y}`, empty: true }
        : null

    return (
        <footer class={`bar ${styles.statusbar}`}>
            {renaming ? (
                <TitleInput
                    initial={sprite.meta.title}
                    onSettle={(value) => {
                        if (value !== null) onRename(value)
                        setRenaming(false)
                    }}
                />
            ) : (
                <button
                    type="button"
                    class={styles.docTitle}
                    title="Rename this drawing"
                    data-testid="doc-title"
                    onClick={() => {
                        setRenaming(true)
                    }}
                >
                    {sprite.meta.title}
                </button>
            )}
            <span class={`mono ${styles.docSize}`}>
                {sprite.width}x{sprite.height}
            </span>

            <span
                class="mono dim"
                data-testid="status-frame"
                title={reel.playing ? 'Frame being shown' : 'Frame being edited'}
            >
                frame {frameNumber}/{sprite.frames.length}
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
                    <span class={`mono dim ${styles.brushSize}`} data-testid="status-brush">
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
                >
                    {EXPORT_LABEL[exportState]}
                </span>
            )}

            {projectNotice && (
                <div
                    class={`mono ${styles.projectNotice}${projectNotice.phase === 'error' ? ` ${styles.projectNoticeError}` : ''}`}
                    data-testid="status-project"
                >
                    <strong class={styles.projectNoticeLabel}>{projectNotice.label}</strong>
                    <span dir="auto">{projectNotice.detail}</span>
                </div>
            )}

            {save && (
                <span
                    class={`mono ${styles.save}${save === 'failed' ? ` ${styles.saveFailed}` : ''}`}
                    data-testid="status-save"
                    title={
                        save === 'failed'
                            ? 'This browser refused to store the drawing. Export it before you leave'
                            : 'Kept in this browser. It comes back when you reload'
                    }
                >
                    {SAVE_LABEL[save]}
                </span>
            )}

            <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {save ? SAVE_SPEECH[save] : ''}
            </span>
            <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {exportState ? EXPORT_TITLE[exportState] : ''}
            </span>
            <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {projectNotice && projectNotice.phase !== 'error'
                    ? `${projectNotice.label}. ${projectNotice.detail}`
                    : ''}
            </span>
            <span class="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
                {projectNotice?.phase === 'error'
                    ? `${projectNotice.label}. ${projectNotice.detail}`
                    : ''}
            </span>

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

function TitleInput({
    initial,
    onSettle,
}: {
    initial: string
    onSettle: (value: string | null) => void
}) {
    const ref = useRef<HTMLInputElement>(null)
    const abandoned = useRef(false)

    useEffect(() => {
        ref.current?.focus()
        ref.current?.select()
    }, [])

    return (
        <input
            ref={ref}
            class={styles.titleInput}
            data-testid="doc-title-input"
            value={initial}
            aria-label="Drawing name"
            maxLength={SPRITE_TITLE_MAX}
            dir="auto"
            spellcheck={false}
            autocomplete="off"
            autocapitalize="off"
            enterkeyhint="done"
            onBlur={(e) => {
                onSettle(abandoned.current ? null : e.currentTarget.value)
            }}
            onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') e.currentTarget.blur()
                else if (e.key === 'Escape') {
                    abandoned.current = true
                    e.currentTarget.blur()
                }
            }}
        />
    )
}
