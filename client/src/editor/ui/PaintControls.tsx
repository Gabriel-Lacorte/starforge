import { hexToRgba, rgbaToHex, type Palette } from '@starforge/core'
import { useRef, useState } from 'preact/hooks'
import type { ReadoutStore } from '../readout'
import type { PaletteController } from '../palette/paletteController'
import type { EditorStore } from '../store'
import { blurOnPointer } from './blurOnPointer'
import { ColorPopover, type ColorPopoverTarget } from './ColorPopover'
import { useStore } from './useStore'
import { useReorder } from './useReorder'
import styles from './PaintControls.module.css'

export function PaintControls({
    store,
    readout,
    palette,
    controller,
    onOpenPalette,
    onClearSelection,
}: {
    store: EditorStore
    readout: ReadoutStore
    palette: Palette
    controller: PaletteController
    onOpenPalette: () => void
    onClearSelection?: () => void
}) {
    const state = useStore(store)
    const { selectionActive } = useStore(readout)
    const [popover, setPopover] = useState<ColorPopoverTarget | null>(null)
    const fgAnchor = useRef<HTMLSpanElement>(null)
    const rail = useRef<HTMLDivElement>(null)

    useReorder(rail, `[data-testid="swatch"]`, (from, to) => {
        controller.move(from, to)
    })

    const swatchTargetValid =
        popover === null ||
        popover.kind === 'foreground' ||
        palette.colors[popover.index] !== undefined

    return (
        <div class={`bar ${styles.strip}`} data-testid="paint-colors">
            <span class={styles.fgBg} ref={fgAnchor}>
                <button
                    type="button"
                    class={styles.stack}
                    aria-label="Pick the paint colour"
                    title="Pick the paint colour"
                    data-testid="fg-color"
                    onClick={(e) => {
                        if (popover?.kind !== 'foreground') setPopover({ kind: 'foreground' })
                        blurOnPointer(e)
                    }}
                >
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
                </button>
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
            </span>
            <div class={styles.rail} role="listbox" aria-label="Paint colours" ref={rail}>
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
                            title={`${hex} (right-click to edit)`}
                            data-testid="swatch"
                            class={`${styles.swatch}${selected ? ` ${styles.on}` : ''}`}
                            onClick={(e) => {
                                store.pickColor(hexToRgba(hex))
                                blurOnPointer(e)
                            }}
                            onContextMenu={(e) => {
                                e.preventDefault()
                                setPopover({ kind: 'swatch', index: at })
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
                    class={styles.plus}
                    aria-label="Add the paint colour to the palette"
                    title="Add the paint colour to the palette"
                    data-testid="swatch-add"
                    disabled={palette.colors.includes(rgbaToHex(state.color))}
                    onClick={(e) => {
                        controller.add(state.color)
                        blurOnPointer(e)
                    }}
                >
                    +
                </button>
                <button
                    type="button"
                    class={styles.btn}
                    title="Mix colours and edit palettes"
                    data-testid="open-palette"
                    onClick={onOpenPalette}
                >
                    Colors
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
            {popover !== null && swatchTargetValid && (
                <ColorPopover
                    store={store}
                    palette={controller}
                    target={popover}
                    anchor={fgAnchor}
                    onClose={() => {
                        setPopover(null)
                    }}
                />
            )}
        </div>
    )
}
