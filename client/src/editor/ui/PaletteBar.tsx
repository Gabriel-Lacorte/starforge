import { hexToRgba, rgbaToHex, type Palette } from '@starforge/core'
import { useMemo } from 'preact/hooks'
import type { EditorStore } from '../store'
import { useStore } from './useStore'
import styles from './PaletteBar.module.css'

export function PaletteBar({ palette, store }: { palette: Palette; store: EditorStore }) {
    const state = useStore(store)

    const swatches = useMemo(
        () => palette.colors.map((hex) => ({ hex, rgba: hexToRgba(hex) })),
        [palette],
    )

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
                        data-testid="swatch"
                        aria-pressed={state.color === swatch.rgba}
                        onClick={(e) => {
                            store.patch({ color: swatch.rgba })
                            e.currentTarget.blur()
                        }}
                    />
                ))}
            </div>
            <span class={styles.activeColor}>
                <span class="chip" style={{ background: rgbaToHex(state.color) }} />
                <span class="mono" data-testid="active-hex">
                    {rgbaToHex(state.color)}
                </span>
            </span>
        </div>
    )
}
