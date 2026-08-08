import { BRUSH_MAX_SIZE } from '@starforge/core'
import { TOOL_CATALOG, toolBadge, type OptionGroup } from '../tools/catalog'
import type { EditorStore } from '../store'
import { TOOL_ICON } from './icons'
import { useStore } from './useStore'
import styles from './Toolbar.module.css'

export function Toolbar({ store, onExport }: { store: EditorStore; onExport: () => void }) {
    const state = useStore(store)
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

            <button
                type="button"
                class={`${styles.textBtn} ${styles.export}`}
                title="Export the frame as a PNG"
                onClick={(e) => {
                    onExport()
                    e.currentTarget.blur()
                }}
            >
                Export PNG
            </button>
        </div>
    )
}
