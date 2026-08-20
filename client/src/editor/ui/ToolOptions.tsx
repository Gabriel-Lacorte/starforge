import { BRUSH_MAX_SIZE } from '@starforge/core'
import { TOOL_CATALOG } from '../tools/catalog'
import { toolCapabilities, type ToolCapability } from '../tools/definition'
import type { EditorStore } from '../store'
import { useStore } from './useStore'
import styles from './Toolbar.module.css'
import { blurOnPointer } from './blurOnPointer'

function Toggle({
    text,
    title,
    checked,
    onToggle,
    testId,
    ariaLabel,
}: {
    text: string
    title: string
    checked: boolean
    onToggle: (next: boolean) => void
    testId?: string
    ariaLabel?: string
}) {
    return (
        <label class={styles.opt} title={title}>
            <input
                type="checkbox"
                checked={checked}
                aria-label={ariaLabel}
                data-testid={testId}
                onChange={(e) => {
                    onToggle(e.currentTarget.checked)
                }}
            />
            {text}
        </label>
    )
}

export function ToolOptions({ store }: { store: EditorStore }) {
    const state = useStore(store)

    const active = TOOL_CATALOG.find((t) => t.id === state.tool)
    const capabilities: readonly ToolCapability[] = active ? toolCapabilities(active) : []
    const shows = (capability: ToolCapability) => capabilities.includes(capability)

    const brushTo = (size: number) => {
        store.patch({ brushSize: Math.max(1, Math.min(BRUSH_MAX_SIZE, size)) })
    }

    return (
        <div class={styles.optionStrip}>
            {capabilities.length > 0 && <span class={styles.sep} />}

            {shows('brush') && (
                <span class={styles.opt} title="Brush size">
                    brush
                    <span class={styles.stepper}>
                        <button
                            type="button"
                            aria-label="Brush smaller"
                            onClick={(e) => {
                                brushTo(state.brushSize - 1)
                                blurOnPointer(e)
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
                                blurOnPointer(e)
                            }}
                        >
                            +
                        </button>
                    </span>
                </span>
            )}

            {shows('opacity') && (
                <label class={styles.opt} title="Ink opacity, separate from the colour's own alpha">
                    opacity
                    <input
                        class={styles.range}
                        type="range"
                        min={1}
                        max={255}
                        step={1}
                        value={state.inkOpacity}
                        aria-label="Ink opacity"
                        data-testid="ink-opacity"
                        onInput={(e) => {
                            store.patch({ inkOpacity: Number(e.currentTarget.value) })
                        }}
                    />
                    <span class="mono" data-testid="ink-opacity-value">
                        {Math.round((state.inkOpacity / 255) * 100)}%
                    </span>
                </label>
            )}

            {shows('pixelPerfect') && (
                <Toggle
                    text="pixel-perfect"
                    title="Drop the corner pixel a freehand turn leaves behind"
                    checked={state.pixelPerfect}
                    testId="pixel-perfect"
                    onToggle={(pixelPerfect) => {
                        store.patch({ pixelPerfect })
                    }}
                />
            )}

            {shows('lockAlpha') && (
                <Toggle
                    text="lock alpha"
                    title="Paint only where there is already colour"
                    checked={state.lockAlpha}
                    testId="lock-alpha"
                    onToggle={(lockAlpha) => {
                        store.patch({ lockAlpha })
                    }}
                />
            )}

            {shows('shapeFill') && (
                <Toggle
                    text="fill"
                    title="Rect and ellipse: filled instead of outlined"
                    checked={state.shapeFill}
                    onToggle={(shapeFill) => {
                        store.patch({ shapeFill })
                    }}
                />
            )}

            {shows('flood') && (
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

                    <Toggle
                        text="contiguous"
                        title="Bucket: only the connected region"
                        checked={state.fillContiguous}
                        onToggle={(fillContiguous) => {
                            store.patch({ fillContiguous })
                        }}
                    />
                </>
            )}
        </div>
    )
}
