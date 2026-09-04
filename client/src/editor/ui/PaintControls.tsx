import { hexToRgba, rgbaToHex, type Palette } from '@starforge/core'
import type { ReadoutStore } from '../readout'
import type { EditorStore } from '../store'
import { blurOnPointer } from './blurOnPointer'
import { useStore } from './useStore'
import styles from './PaintControls.module.css'

export function PaintControls({
    store,
    readout,
    palette,
    onOpenStudio,
    onOpenPalette,
    onClearSelection,
}: {
    store: EditorStore
    readout: ReadoutStore
    palette: Palette
    onOpenStudio: () => void
    onOpenPalette: () => void
    onClearSelection?: () => void
}) {
    const state = useStore(store)
    const { selectionActive } = useStore(readout)

    return (
        <div class={`bar ${styles.strip}`} data-testid="paint-colors">
            <span class={styles.fgBg}>
                <span class={styles.stack}>
                    <span
                        class={styles.fg}
                        style={{ background: rgbaToHex(state.color) }}
                        title={`Foreground ${rgbaToHex(state.color)}`}
                    />
                    <span
                        class={styles.bg}
                        style={{ background: rgbaToHex(state.background) }}
                        title={`Background ${rgbaToHex(state.background)}`}
                    />
                </span>
                <button
                    type="button"
                    class={styles.btn}
                    aria-label="Swap foreground and background"
                    title="Swap foreground and background"
                    onClick={(e) => {
                        store.swapColors()
                        blurOnPointer(e)
                    }}
                >
                    swap
                </button>
                <button
                    type="button"
                    class={styles.btn}
                    aria-label="Reset foreground and background"
                    title="Reset foreground and background"
                    onClick={(e) => {
                        store.resetColors()
                        blurOnPointer(e)
                    }}
                >
                    reset
                </button>
            </span>
            <div class={styles.rail} role="listbox" aria-label="Paint colours">
                {palette.colors.map((hex, at) => {
                    const selected = state.color === hexToRgba(hex)
                    return (
                        <button
                            key={`${hex}-${at}`}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            aria-pressed={selected}
                            aria-label={`Colour ${hex}`}
                            title={hex}
                            data-testid="swatch"
                            class={`${styles.swatch}${selected ? ` ${styles.on}` : ''}`}
                            onClick={(e) => {
                                store.pickColor(hexToRgba(hex))
                                blurOnPointer(e)
                            }}
                        >
                            <span
                                data-testid="swatch-color"
                                class={styles.dot}
                                style={{ background: hex }}
                            />
                        </button>
                    )
                })}
            </div>
            <span class={styles.mixers}>
                <button
                    type="button"
                    class={styles.btn}
                    title="Mix a colour of your own"
                    data-testid="open-studio"
                    onClick={onOpenStudio}
                >
                    Color
                </button>
                <button
                    type="button"
                    class={styles.btn}
                    title="Edit, reorder and import palettes"
                    data-testid="open-palette"
                    onClick={onOpenPalette}
                >
                    Palette
                </button>
            </span>
            {selectionActive && (
                <span class={styles.selection} data-testid="selection-active">
                    Selection active
                    <button
                        type="button"
                        class={styles.btn}
                        aria-label="Clear selection"
                        title="Clear selection"
                        onClick={(e) => {
                            onClearSelection?.()
                            blurOnPointer(e)
                        }}
                    >
                        Clear
                    </button>
                </span>
            )}
        </div>
    )
}
