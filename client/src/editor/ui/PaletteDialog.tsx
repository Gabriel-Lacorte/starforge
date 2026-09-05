import { hexToRgba, PALETTE_NAME_MAX, rgbaToHex, type RGBA } from '@starforge/core'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { PaletteController } from '../palette/paletteController'
import type { EditorStore } from '../store'
import { ColorField } from './ColorField'
import { LeftIcon, PlusIcon, RightIcon, TrashIcon } from './icons'
import { useStore, type Subscribable } from './useStore'
import styles from './PaletteDialog.module.css'

export function PaletteDialog({
    palette,
    store,
    revision,
    onImport,
    onClose,
}: {
    palette: PaletteController
    store: EditorStore
    revision: Subscribable<unknown>
    onImport: (file: File) => void
    onClose: () => void
}) {
    const ref = useRef<HTMLDialogElement>(null)
    const fileInput = useRef<HTMLInputElement>(null)
    const importButton = useRef<HTMLButtonElement>(null)
    useStore(revision)
    const state = useStore(store)
    const [selected, setSelected] = useState(0)

    useEffect(() => {
        ref.current?.showModal()
    }, [])

    const colors = palette.palette.colors
    const index = Math.min(selected, colors.length - 1)
    const [draft, setDraft] = useState<RGBA>(() => hexToRgba(colors[0] ?? '#ffffff'))
    const lastSelected = useRef(colors[0] ?? '#ffffff')
    const draftHex = rgbaToHex(draft)
    const selectedHex = colors[index]
    if (
        selectedHex !== undefined &&
        selectedHex !== lastSelected.current &&
        draftHex === lastSelected.current
    ) {
        lastSelected.current = selectedHex
        setDraft(hexToRgba(selectedHex))
    }
    const duplicate = colors.includes(draftHex)
    const unchanged = colors[index] === draftHex

    const pick = (at: number): void => {
        setSelected(at)
        const hex = colors[at]
        if (hex !== undefined) {
            lastSelected.current = hex
            setDraft(hexToRgba(hex))
            store.pickColor(hexToRgba(hex))
        }
    }

    const shift = (delta: number): void => {
        const to = index + delta
        if (to < 0 || to >= colors.length) return

        palette.move(index, to)
        setSelected(to)
    }

    const onGridKey = (event: KeyboardEvent): void => {
        const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 }
        const delta = moves[event.key]

        if (delta !== undefined) {
            event.preventDefault()
            if (event.altKey) shift(delta)
            else pick(clamp(index + delta, colors.length))
            return
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault()
            palette.remove(index)
            setSelected(clamp(index, colors.length - 1))
        }
    }

    return (
        <dialog
            ref={ref}
            class={styles.dialog}
            aria-label="Palette"
            data-testid="palette-dialog"
            onCancel={(e) => {
                e.preventDefault()
                onClose()
            }}
            onClick={(e) => {
                if (e.target === ref.current) onClose()
            }}
            onKeyDown={(e) => {
                e.stopPropagation()
            }}
        >
            <header class={styles.header}>Palette</header>

            <div class={styles.editor}>
                <div class={styles.body}>
                    <label class={styles.nameField}>
                        name
                        <input
                            type="text"
                            value={palette.palette.name}
                            maxLength={PALETTE_NAME_MAX}
                            spellcheck={false}
                            autocomplete="off"
                            dir="auto"
                            aria-label="Palette name"
                            data-testid="palette-name"
                            onChange={(e) => {
                                palette.rename(e.currentTarget.value)
                                e.currentTarget.value = palette.palette.name
                            }}
                        />
                    </label>

                    <div
                        class={styles.grid}
                        role="listbox"
                        tabIndex={0}
                        aria-label="Palette colours. Alt with the arrow keys reorders"
                        aria-activedescendant={`swatch-${index}`}
                        data-testid="palette-grid"
                        onKeyDown={onGridKey}
                    >
                        {colors.map((hex, at) => (
                            <span
                                key={`${hex}-${at}`}
                                id={`swatch-${at}`}
                                role="option"
                                aria-selected={at === index}
                                aria-label={hex}
                                title={hex}
                                class={`${styles.swatch}${at === index ? ` ${styles.on}` : ''}`}
                                style={{ background: hex }}
                                data-testid="palette-swatch"
                                onClick={() => {
                                    pick(at)
                                }}
                            />
                        ))}
                    </div>

                    <div class={styles.tools}>
                        <button
                            type="button"
                            class={styles.tool}
                            title="Move this colour left (Alt + Left)"
                            aria-label="Move colour left"
                            data-testid="palette-left"
                            disabled={index <= 0}
                            onClick={() => shift(-1)}
                        >
                            <LeftIcon />
                        </button>
                        <button
                            type="button"
                            class={styles.tool}
                            title="Move this colour right (Alt + Right)"
                            aria-label="Move colour right"
                            data-testid="palette-right"
                            disabled={index >= colors.length - 1}
                            onClick={() => shift(1)}
                        >
                            <RightIcon />
                        </button>
                        <button
                            type="button"
                            class={styles.tool}
                            title="Remove this colour (Delete)"
                            aria-label="Remove this colour"
                            data-testid="palette-remove"
                            disabled={colors.length <= 1}
                            onClick={() => {
                                palette.remove(index)
                                const next = clamp(index, colors.length - 1)
                                setSelected(next)
                                const after = colors.filter((_, at) => at !== index)
                                const following = after[clamp(next, after.length - 1)]
                                if (following !== undefined) lastSelected.current = following
                            }}
                        >
                            <TrashIcon />
                        </button>
                    </div>

                    <p class={styles.note}>
                        Removing a swatch leaves the colour you are painting with alone. Importing
                        replaces the whole palette in one step, which one undo puts back.
                    </p>
                </div>

                <div class={styles.mixer}>
                    <ColorField
                        value={draft}
                        recentColors={state.recentColors}
                        onInput={setDraft}
                    />
                    <div class={styles.commits}>
                        <button
                            type="button"
                            class={styles.tool}
                            title="Start a new colour from the selected one without changing the document yet"
                            aria-label="New swatch"
                            data-testid="palette-new"
                            onClick={() => {
                                const hex = colors[index]
                                if (hex !== undefined) setDraft(hexToRgba(hex))
                            }}
                        >
                            <PlusIcon /> New
                        </button>
                        <button
                            type="button"
                            class={styles.tool}
                            title={
                                duplicate ? 'Already in palette' : `Add ${draftHex} to the palette`
                            }
                            aria-label="Add new colour to palette"
                            data-testid="palette-add"
                            disabled={duplicate}
                            onClick={() => {
                                palette.add(draft)
                                setSelected(colors.length)
                            }}
                        >
                            Add new
                        </button>
                        <button
                            type="button"
                            class={styles.tool}
                            title={
                                unchanged
                                    ? 'Already in palette'
                                    : `Replace this colour with ${draftHex}`
                            }
                            aria-label="Replace selected colour"
                            data-testid="palette-replace"
                            disabled={unchanged}
                            onClick={() => {
                                palette.setColor(index, draft)
                                lastSelected.current = draftHex
                            }}
                        >
                            Replace selected
                        </button>
                    </div>
                </div>
            </div>

            <div class={styles.actions}>
                <button
                    ref={importButton}
                    type="button"
                    class={styles.action}
                    title="Load a GIMP .gpl palette or a list of hex colours"
                    data-testid="palette-import"
                    onClick={() => fileInput.current?.click()}
                >
                    Import…
                </button>
                <input
                    ref={fileInput}
                    class={styles.fileInput}
                    type="file"
                    accept=".gpl,.txt,.hex,text/plain"
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={(event) => {
                        const file = event.currentTarget.files?.[0]
                        event.currentTarget.value = ''
                        if (file) onImport(file)
                        importButton.current?.focus()
                    }}
                />
                <button
                    type="button"
                    class={`${styles.action} ${styles.primary}`}
                    data-testid="palette-done"
                    onClick={onClose}
                >
                    Done
                </button>
            </div>
        </dialog>
    )
}

function clamp(index: number, length: number): number {
    return Math.max(0, Math.min(index, length - 1))
}
