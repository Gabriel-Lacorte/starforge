import { hexToRgba, rgbaToHex, type Palette } from '@starforge/core'
import type { EditorStore } from '../store'
import { useStore, type Subscribable } from './useStore'
import styles from './PaletteBar.module.css'
import { blurOnPointer } from './blurOnPointer'

export function PaletteBar({
    palette,
    store,
    revision,
    onOpenStudio,
    onOpenPalette,
}: {
    palette: Palette
    store: EditorStore
    revision: Subscribable<unknown>
    onOpenStudio: () => void
    onOpenPalette: () => void
}) {
    const state = useStore(store)
    useStore(revision)

    const swatches = palette.colors.map((hex) => ({ hex, rgba: hexToRgba(hex) }))

    return (
        <div class={`bar ${styles.palettebar}`}>
            <div class={styles.swatches}>
                {swatches.map((swatch) => (
                    <button
                        key={swatch.hex}
                        type="button"
                        class={`${styles.swatch}${state.color === swatch.rgba ? ` ${styles.active}` : ''}`}
                        style={{ background: swatch.hex }}
                        title={swatch.hex}
                        aria-label={`Colour ${swatch.hex}`}
                        data-testid="swatch"
                        aria-pressed={state.color === swatch.rgba}
                        onClick={(e) => {
                            store.patch({ color: swatch.rgba })
                            blurOnPointer(e)
                        }}
                    />
                ))}
            </div>
            <span class={styles.actions}>
                <button
                    type="button"
                    class={styles.chip}
                    title="Mix a colour of your own"
                    data-testid="open-studio"
                    onClick={onOpenStudio}
                >
                    studio
                </button>
                <button
                    type="button"
                    class={styles.chip}
                    title="Edit, reorder and import palettes"
                    data-testid="open-palette"
                    onClick={onOpenPalette}
                >
                    palette
                </button>
            </span>
            <span class={styles.activeColor}>
                <span class="chip" style={{ background: rgbaToHex(state.color) }} />
                <span class="mono" data-testid="active-hex">
                    {rgbaToHex(state.color)}
                </span>
            </span>
        </div>
    )
}
