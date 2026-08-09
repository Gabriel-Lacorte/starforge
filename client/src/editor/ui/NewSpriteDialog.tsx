import { SPRITE_MAX_SIZE, SPRITE_MIN_SIZE } from '@starforge/core'
import { useEffect, useRef, useState } from 'preact/hooks'
import styles from './NewSpriteDialog.module.css'

const PRESETS = [16, 32, 64, 128, 256] as const

const TITLE_MAX = 48
const FALLBACK_TITLE = 'untitled'

export interface OpenSprite {
    title: string
    width: number
    height: number
}

export function NewSpriteDialog({
    current,
    onCreate,
    onCancel,
}: {
    current: OpenSprite
    onCreate: (width: number, height: number, title: string) => void
    onCancel: () => void
}) {
    const ref = useRef<HTMLDialogElement>(null)
    const [width, setWidth] = useState(String(current.width))
    const [height, setHeight] = useState(String(current.height))
    const [title, setTitle] = useState('')

    useEffect(() => {
        ref.current?.showModal()
    }, [])

    const w = parseSize(width)
    const h = parseSize(height)
    const square = w !== null && w === h ? w : null
    const cleanTitle = title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) || FALLBACK_TITLE

    return (
        <dialog
            ref={ref}
            class={styles.dialog}
            aria-label="New sprite"
            data-testid="new-dialog"
            onCancel={(e) => {
                e.preventDefault()
                onCancel()
            }}
            onClick={(e) => {
                if (e.target === ref.current) onCancel()
            }}
            onKeyDown={(e) => {
                e.stopPropagation()
            }}
        >
            <header class={styles.header}>New sprite</header>

            <form
                class={styles.body}
                method="dialog"
                onSubmit={(e) => {
                    e.preventDefault()
                    if (w !== null && h !== null) onCreate(w, h, cleanTitle)
                }}
            >
                <div class={styles.presets}>
                    {PRESETS.map((size) => (
                        <button
                            key={size}
                            type="button"
                            class={`${styles.preset}${square === size ? ` ${styles.on}` : ''}`}
                            data-testid="size-preset"
                            aria-pressed={square === size}
                            onClick={() => {
                                setWidth(String(size))
                                setHeight(String(size))
                            }}
                        >
                            {size}
                        </button>
                    ))}
                </div>

                <div class={styles.sizes}>
                    <label class={styles.size}>
                        w
                        <input
                            type="number"
                            inputMode="numeric"
                            min={SPRITE_MIN_SIZE}
                            max={SPRITE_MAX_SIZE}
                            value={width}
                            data-testid="new-width"
                            autofocus
                            onInput={(e) => {
                                setWidth(e.currentTarget.value)
                            }}
                        />
                    </label>
                    <label class={styles.size}>
                        h
                        <input
                            type="number"
                            inputMode="numeric"
                            min={SPRITE_MIN_SIZE}
                            max={SPRITE_MAX_SIZE}
                            value={height}
                            data-testid="new-height"
                            onInput={(e) => {
                                setHeight(e.currentTarget.value)
                            }}
                        />
                    </label>
                </div>

                <label class={`${styles.size} ${styles.titleField}`}>
                    name
                    <input
                        type="text"
                        value={title}
                        placeholder={FALLBACK_TITLE}
                        maxLength={TITLE_MAX}
                        spellcheck={false}
                        autocomplete="off"
                        dir="auto"
                        aria-label="Sprite name, used for the export file name"
                        data-testid="new-title"
                        onInput={(e) => {
                            setTitle(e.currentTarget.value)
                        }}
                    />
                </label>

                <p class={styles.warn} data-testid="new-warning">
                    Discards <b>{current.title}</b> {current.width}&times;{current.height}. This
                    cannot be undone.
                </p>

                {(w === null || h === null) && (
                    <p class={styles.invalid} data-testid="new-error">
                        Size must be {SPRITE_MIN_SIZE}&ndash;{SPRITE_MAX_SIZE} pixels.
                    </p>
                )}
            </form>

            <div class={styles.actions}>
                <button type="button" class={styles.action} onClick={onCancel}>
                    Cancel
                </button>
                <button
                    type="button"
                    class={`${styles.action} ${styles.primary}`}
                    data-testid="new-create"
                    disabled={w === null || h === null}
                    onClick={() => {
                        if (w !== null && h !== null) onCreate(w, h, cleanTitle)
                    }}
                >
                    Create
                </button>
            </div>
        </dialog>
    )
}

function parseSize(value: string): number | null {
    const size = Number(value)
    if (!Number.isInteger(size) || size < SPRITE_MIN_SIZE || size > SPRITE_MAX_SIZE) return null

    return size
}
