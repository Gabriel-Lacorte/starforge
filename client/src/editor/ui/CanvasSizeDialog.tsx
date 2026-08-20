import {
    RESIZE_ANCHORS,
    SPRITE_MAX_SIZE,
    SPRITE_MIN_SIZE,
    type ResizeAnchor,
} from '@starforge/core'
import { useEffect, useRef, useState } from 'preact/hooks'
import styles from './CanvasSizeDialog.module.css'

const ANCHOR_LABEL: Readonly<Record<ResizeAnchor, string>> = {
    'top-left': 'Anchor top left',
    top: 'Anchor top',
    'top-right': 'Anchor top right',
    left: 'Anchor left',
    center: 'Anchor centre',
    right: 'Anchor right',
    'bottom-left': 'Anchor bottom left',
    bottom: 'Anchor bottom',
    'bottom-right': 'Anchor bottom right',
}

export interface CanvasSizeChoice {
    readonly width: number
    readonly height: number
    readonly anchor: ResizeAnchor
    readonly scale: boolean
}

export function CanvasSizeDialog({
    current,
    canCrop,
    onApply,
    onCrop,
    onCancel,
}: {
    current: { width: number; height: number }
    canCrop: boolean
    onApply: (choice: CanvasSizeChoice) => void
    onCrop: () => void
    onCancel: () => void
}) {
    const ref = useRef<HTMLDialogElement>(null)
    const [width, setWidth] = useState(String(current.width))
    const [height, setHeight] = useState(String(current.height))
    const [anchor, setAnchor] = useState<ResizeAnchor>('center')
    const [scale, setScale] = useState(false)

    useEffect(() => {
        ref.current?.showModal()
    }, [])

    const w = parseSize(width)
    const h = parseSize(height)
    const unchanged = w === current.width && h === current.height
    const ready = w !== null && h !== null && !unchanged

    return (
        <dialog
            ref={ref}
            class={styles.dialog}
            aria-label="Canvas size"
            data-testid="canvas-size-dialog"
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
            <header class={styles.header}>Canvas size</header>

            <form
                class={styles.body}
                method="dialog"
                onSubmit={(e) => {
                    e.preventDefault()
                    if (ready) onApply({ width: w, height: h, anchor, scale })
                }}
            >
                <div class={styles.sizes}>
                    <label class={styles.size}>
                        w
                        <input
                            type="number"
                            inputMode="numeric"
                            min={SPRITE_MIN_SIZE}
                            max={SPRITE_MAX_SIZE}
                            value={width}
                            data-testid="canvas-width"
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
                            data-testid="canvas-height"
                            onInput={(e) => {
                                setHeight(e.currentTarget.value)
                            }}
                        />
                    </label>
                </div>

                <label class={styles.choice}>
                    <input
                        type="checkbox"
                        checked={scale}
                        data-testid="canvas-scale"
                        onChange={(e) => {
                            setScale(e.currentTarget.checked)
                        }}
                    />
                    <span>Scale the drawing</span>
                    <span class={styles.detail}>
                        Resamples every pixel into the new size, nearest neighbour, so no colour is
                        invented. Unchecked, the art keeps its size and the canvas moves around it.
                    </span>
                </label>

                <fieldset class={styles.group} disabled={scale}>
                    <legend class={styles.legend}>Anchor</legend>
                    <div class={styles.anchors}>
                        {RESIZE_ANCHORS.map((option) => (
                            <label key={option} class={styles.anchor}>
                                <input
                                    type="radio"
                                    name="canvas-anchor"
                                    value={option}
                                    checked={anchor === option}
                                    aria-label={ANCHOR_LABEL[option]}
                                    data-testid={`anchor-${option}`}
                                    onChange={() => {
                                        setAnchor(option)
                                    }}
                                />
                            </label>
                        ))}
                    </div>
                </fieldset>

                {w !== null &&
                    h !== null &&
                    !scale &&
                    (w < current.width || h < current.height) && (
                        <p class={styles.warn} data-testid="canvas-warning">
                            Smaller than the current canvas: whatever falls outside is cut. One undo
                            brings it back.
                        </p>
                    )}

                {(w === null || h === null) && (
                    <p class={styles.invalid} data-testid="canvas-error">
                        Size must be {SPRITE_MIN_SIZE}&ndash;{SPRITE_MAX_SIZE} pixels.
                    </p>
                )}
            </form>

            <div class={styles.actions}>
                {canCrop && (
                    <button
                        type="button"
                        class={styles.action}
                        title="Shrink the canvas to the current selection"
                        data-testid="crop-to-selection"
                        onClick={onCrop}
                    >
                        Crop to selection
                    </button>
                )}
                <span class={styles.spacer} />
                <button type="button" class={styles.action} onClick={onCancel}>
                    Cancel
                </button>
                <button
                    type="button"
                    class={`${styles.action} ${styles.primary}`}
                    data-testid="canvas-apply"
                    disabled={!ready}
                    onClick={() => {
                        if (ready) onApply({ width: w, height: h, anchor, scale })
                    }}
                >
                    Apply
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
