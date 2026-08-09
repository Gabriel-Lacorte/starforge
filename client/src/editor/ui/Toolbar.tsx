import { BRUSH_MAX_SIZE } from '@starforge/core'
import { TOOL_CATALOG, toolBadge, type OptionGroup } from '../tools/catalog'
import type { ReadoutStore } from '../readout'
import type { EditorStore } from '../store'
import { FileIcon, KeysIcon, PanelIcon, RedoIcon, TOOL_ICON, UndoIcon } from './icons'
import { useStore } from './useStore'
import styles from './Toolbar.module.css'

export function Toolbar({
    store,
    readout,
    layersOpen,
    onNew,
    onExport,
    onToggleLayers,
    onKeys,
    onHistory,
}: {
    store: EditorStore
    readout: ReadoutStore
    layersOpen: boolean
    onNew: () => void
    onExport: () => void
    onToggleLayers: () => void
    onKeys: () => void
    onHistory: (direction: 'undo' | 'redo') => void
}) {
    const state = useStore(store)
    const { canUndo, canRedo, exportState } = useStore(readout)
    const brushTo = (size: number) => {
        store.patch({ brushSize: Math.max(1, Math.min(BRUSH_MAX_SIZE, size)) })
    }

    const active = TOOL_CATALOG.find((t) => t.id === state.tool)
    const shows = (group: OptionGroup) => active?.options.includes(group) ?? false

    return (
        <div class={`bar ${styles.toolbar}`}>
            {TOOL_CATALOG.map((tool) => {
                const Icon = TOOL_ICON[tool.id]
                const badge = toolBadge(tool)

                return (
                    <button
                        key={tool.id}
                        type="button"
                        class={`${styles.toolBtn}${state.tool === tool.id ? ` ${styles.active}` : ''}`}
                        title={badge ? `${tool.label} (${badge})` : tool.label}
                        aria-label={tool.label}
                        aria-pressed={state.tool === tool.id}
                        onClick={(e) => {
                            store.patch({ tool: tool.id })
                            e.currentTarget.blur()
                        }}
                    >
                        <Icon />
                        {badge && (
                            <span class={styles.toolKey} data-testid="tool-key" aria-hidden="true">
                                {badge}
                            </span>
                        )}
                    </button>
                )
            })}

            {(shows('brush') || shows('fill') || shows('bucket')) && <span class={styles.sep} />}

            {shows('brush') && (
                <span class={styles.opt} title="Brush size">
                    brush
                    <span class={styles.stepper}>
                        <button
                            type="button"
                            aria-label="Brush smaller"
                            onClick={(e) => {
                                brushTo(state.brushSize - 1)
                                e.currentTarget.blur()
                            }}
                        >
                            −
                        </button>
                        <span class="mono" data-testid="brush-size">
                            {state.brushSize}
                        </span>
                        <button
                            type="button"
                            aria-label="Brush larger"
                            onClick={(e) => {
                                brushTo(state.brushSize + 1)
                                e.currentTarget.blur()
                            }}
                        >
                            +
                        </button>
                    </span>
                </span>
            )}

            {shows('fill') && (
                <label class={styles.opt} title="Rect and ellipse: filled instead of outlined">
                    <input
                        type="checkbox"
                        checked={state.shapeFill}
                        onChange={(e) => {
                            store.patch({ shapeFill: e.currentTarget.checked })
                            e.currentTarget.blur()
                        }}
                    />
                    fill
                </label>
            )}

            {shows('bucket') && (
                <>
                    <label class={styles.opt} title="Bucket: per-channel color tolerance">
                        tolerance
                        <input
                            class={styles.num}
                            type="number"
                            min={0}
                            max={255}
                            value={state.fillTolerance}
                            data-testid="tolerance"
                            onInput={(e) => {
                                const value = Math.floor(Number(e.currentTarget.value))
                                if (Number.isFinite(value)) {
                                    store.patch({
                                        fillTolerance: Math.max(0, Math.min(255, value)),
                                    })
                                }
                            }}
                        />
                    </label>

                    <label class={styles.opt} title="Bucket: only the connected region">
                        <input
                            type="checkbox"
                            checked={state.fillContiguous}
                            onChange={(e) => {
                                store.patch({ fillContiguous: e.currentTarget.checked })
                                e.currentTarget.blur()
                            }}
                        />
                        contiguous
                    </label>
                </>
            )}

            <span class={styles.fileGroup}>
                <button
                    type="button"
                    class={styles.iconBtn}
                    title="Undo (Ctrl+Z)"
                    aria-label="Undo"
                    data-testid="undo"
                    disabled={!canUndo}
                    onClick={(e) => {
                        onHistory('undo')
                        e.currentTarget.blur()
                    }}
                >
                    <UndoIcon />
                </button>
                <button
                    type="button"
                    class={styles.iconBtn}
                    title="Redo (Ctrl+Shift+Z)"
                    aria-label="Redo"
                    data-testid="redo"
                    disabled={!canRedo}
                    onClick={(e) => {
                        onHistory('redo')
                        e.currentTarget.blur()
                    }}
                >
                    <RedoIcon />
                </button>
                <span class={styles.sep} />
                <button
                    type="button"
                    class={styles.textBtn}
                    title="Start a new sprite at any size"
                    data-testid="new-sprite"
                    onClick={(e) => {
                        onNew()
                        e.currentTarget.blur()
                    }}
                >
                    <FileIcon />
                    New
                </button>
                <button
                    type="button"
                    class={styles.textBtn}
                    title="Export as a PNG"
                    data-testid="export-png"
                    disabled={exportState === 'working'}
                    onClick={(e) => {
                        onExport()
                        e.currentTarget.blur()
                    }}
                >
                    <span class={styles.wide}>Export </span>PNG
                </button>
                <button
                    type="button"
                    class={styles.textBtn}
                    title="Keys and gestures"
                    data-testid="keys"
                    onClick={(e) => {
                        onKeys()
                        e.currentTarget.blur()
                    }}
                >
                    <KeysIcon />
                    <span class={styles.wide}>Keys</span>
                </button>
                <button
                    type="button"
                    class={`${styles.textBtn}${layersOpen ? ` ${styles.on}` : ''}`}
                    title={layersOpen ? 'Hide the layers panel' : 'Show the layers panel'}
                    aria-expanded={layersOpen}
                    aria-controls="layers-panel"
                    data-testid="toggle-layers"
                    onClick={(e) => {
                        onToggleLayers()
                        e.currentTarget.blur()
                    }}
                >
                    <PanelIcon />
                    <span class={styles.wide}>Layers</span>
                </button>
            </span>
        </div>
    )
}
