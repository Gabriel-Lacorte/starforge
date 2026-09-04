import { rgbaToHex, type Palette, type RGBA } from '@starforge/core'
import { useEffect, useRef } from 'preact/hooks'
import type { LayersController } from '../layers/layersController'
import { type EditorStore } from '../store'
import { ColorField } from './ColorField'
import { useStore } from './useStore'
import styles from './ColorStudio.module.css'

export function ColorStudio({
    store,
    palette,
    layers,
    onAddToPalette,
    onClose,
}: {
    store: EditorStore
    palette: Palette
    layers: LayersController
    onAddToPalette: (color: RGBA) => void
    onClose: () => void
}) {
    const ref = useRef<HTMLDialogElement>(null)
    useStore(layers)
    const state = useStore(store)

    const openedWith = useRef(state.color)

    useEffect(() => {
        ref.current?.showModal()
    }, [])

    const close = (): void => {
        store.rememberColor(openedWith.current)
        onClose()
    }

    const hex = rgbaToHex(state.color)
    const inPalette = palette.colors.includes(hex)

    return (
        <dialog
            ref={ref}
            class={styles.dialog}
            aria-label="Color"
            data-testid="color-studio"
            onCancel={(e) => {
                e.preventDefault()
                close()
            }}
            onClick={(e) => {
                if (e.target === ref.current) close()
            }}
            onKeyDown={(e) => {
                e.stopPropagation()
            }}
        >
            <header class={styles.header}>Color</header>

            <div class={styles.body}>
                <ColorField
                    value={state.color}
                    recentColors={state.recentColors}
                    onInput={(color) => {
                        store.setColor(color)
                    }}
                />
            </div>

            <div class={styles.actions}>
                <button
                    type="button"
                    class={styles.action}
                    disabled={inPalette}
                    title={inPalette ? 'Already in palette' : 'Add this color to the palette'}
                    data-testid="add-to-palette"
                    onClick={() => {
                        onAddToPalette(state.color)
                    }}
                >
                    Add to palette
                </button>
                <button
                    type="button"
                    class={`${styles.action} ${styles.primary}`}
                    data-testid="color-done"
                    onClick={close}
                >
                    Done
                </button>
            </div>
        </dialog>
    )
}
