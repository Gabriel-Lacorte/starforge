import type { Sprite } from '@starforge/core'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { GifScale } from '../../export/gif'
import { gifFilename, renderGif, renderSpritesheet, spritesheetFilename } from '../../export/gif'
import { portablePngFilename, visualPngFilename } from '../../export/png'
import styles from './ExportDialog.module.css'

export type ExportFormat = 'png' | 'gif' | 'spritesheet'

export interface ExportChoice {
    readonly format: ExportFormat
    readonly portable: boolean
    readonly scale: GifScale
    readonly loop: boolean
}

interface FormatOption {
    readonly id: ExportFormat
    readonly label: string
    readonly detail: string
    readonly filename: (title: string, choice: ExportChoice) => string
    readonly hasScale: boolean
    readonly hasLoop: boolean
    readonly hasPortable: boolean
}

const FORMATS: readonly FormatOption[] = [
    {
        id: 'png',
        label: 'PNG',
        detail: 'The active frame, flattened.',
        filename: (title, { portable }) =>
            portable ? portablePngFilename(title) : visualPngFilename(title),
        hasScale: false,
        hasLoop: false,
        hasPortable: true,
    },
    {
        id: 'gif',
        label: 'GIF',
        detail: 'All frames as an animated GIF. Up to 256 colors.',
        filename: (title) => gifFilename(title),
        hasScale: true,
        hasLoop: true,
        hasPortable: false,
    },
    {
        id: 'spritesheet',
        label: 'Spritesheet',
        detail: 'All frames side-by-side as a PNG strip.',
        filename: (title) => spritesheetFilename(title),
        hasScale: true,
        hasLoop: false,
        hasPortable: false,
    },
]

const SCALES: readonly GifScale[] = [1, 2, 4]

const PREVIEW_DEBOUNCE_MS = 150

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(ms: number): string {
    return `${(ms / 1000).toFixed(2)}s`
}

interface Preview {
    url: string
    size: number
    note: string
    alt: string
}

const PREVIEWABLE: readonly ExportFormat[] = ['gif', 'spritesheet']

export function ExportDialog({
    title,
    sprite,
    onExport,
    onCancel,
}: {
    title: string
    sprite: Sprite
    onExport: (choice: ExportChoice) => void
    onCancel: () => void
}) {
    const ref = useRef<HTMLDialogElement>(null)
    const [chosen, setChosen] = useState<FormatOption>(FORMATS[0]!)
    const [portable, setPortable] = useState(false)
    const [scale, setScale] = useState<GifScale>(1)
    const [loop, setLoop] = useState(true)

    const [preview, setPreview] = useState<Preview | null>(null)
    const [previewBusy, setPreviewBusy] = useState(false)
    const [previewError, setPreviewError] = useState(false)

    const urlRef = useRef<string | null>(null)

    useEffect(() => {
        ref.current?.showModal()
    }, [])

    const revokeUrl = () => {
        if (urlRef.current) {
            URL.revokeObjectURL(urlRef.current)
            urlRef.current = null
        }
    }

    const loopMs = sprite.frames.reduce((sum, frame) => sum + frame.duration, 0)

    useEffect(() => {
        if (!PREVIEWABLE.includes(chosen.id)) {
            revokeUrl()
            setPreview(null)
            setPreviewError(false)
            setPreviewBusy(false)
            return
        }

        setPreviewBusy(true)
        let cancelled = false

        const show = (blob: Blob, note: string, alt: string): void => {
            if (cancelled) return
            const url = URL.createObjectURL(blob)
            revokeUrl()
            urlRef.current = url
            setPreview({ url, size: blob.size, note, alt })
            setPreviewError(false)
            setPreviewBusy(false)
        }
        const fail = (): void => {
            if (cancelled) return
            revokeUrl()
            setPreview(null)
            setPreviewError(true)
            setPreviewBusy(false)
        }

        const timer = setTimeout(() => {
            try {
                if (chosen.id === 'gif') {
                    const { blob, colorsUsed } = renderGif(sprite, scale, loop)
                    show(
                        blob,
                        `uses ${colorsUsed} of 256 colors * ${formatDuration(loopMs)} loop`,
                        'Animated preview of the GIF export',
                    )
                } else {
                    const sheetW = sprite.width * scale * sprite.frames.length
                    const sheetH = sprite.height * scale
                    renderSpritesheet(sprite, scale).then(
                        (blob) =>
                            show(
                                blob,
                                `${sprite.frames.length} frames * ${sheetW}×${sheetH}`,
                                'Preview of the spritesheet export',
                            ),
                        fail,
                    )
                }
            } catch {
                fail()
            }
        }, PREVIEW_DEBOUNCE_MS)

        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [chosen.id, scale, loop, sprite])

    useEffect(() => revokeUrl, [])

    const choice: ExportChoice = {
        format: chosen.id,
        portable: portable && chosen.hasPortable,
        scale,
        loop,
    }
    const filename = chosen.filename(title, choice)

    const submit = () => {
        onExport(choice)
    }

    return (
        <dialog
            ref={ref}
            class={styles.dialog}
            aria-label="Export"
            data-testid="export-dialog"
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
            <header class={styles.header}>Export</header>

            <form
                class={styles.body}
                method="dialog"
                onSubmit={(e) => {
                    e.preventDefault()
                    submit()
                }}
            >
                <fieldset class={styles.group}>
                    <legend class={styles.legend}>Format</legend>
                    {FORMATS.map((option) => (
                        <label key={option.id} class={styles.choice}>
                            <input
                                type="radio"
                                name="export-format"
                                value={option.id}
                                checked={chosen === option}
                                data-testid="export-format"
                                autofocus={chosen === option}
                                onChange={() => setChosen(option)}
                            />
                            <span class={styles.choiceLabel}>{option.label}</span>
                            <span class={styles.choiceDetail}>{option.detail}</span>
                        </label>
                    ))}
                </fieldset>

                {chosen.hasScale && (
                    <fieldset class={styles.group}>
                        <legend class={styles.legend}>Scale</legend>
                        <div class={styles.scaleRow}>
                            {SCALES.map((s) => (
                                <label key={s} class={styles.scaleChoice}>
                                    <input
                                        type="radio"
                                        name="export-scale"
                                        value={s}
                                        checked={scale === s}
                                        data-testid="export-scale"
                                        onChange={() => setScale(s)}
                                    />
                                    {s}x
                                </label>
                            ))}
                        </div>
                    </fieldset>
                )}

                {chosen.hasLoop && (
                    <label class={styles.choice}>
                        <input
                            type="checkbox"
                            checked={loop}
                            data-testid="export-loop"
                            onChange={(e) => setLoop(e.currentTarget.checked)}
                        />
                        <span class={styles.choiceLabel}>Loop</span>
                        <span class={styles.choiceDetail}>
                            Repeat the animation indefinitely. Without this, it plays once and
                            stops.
                        </span>
                    </label>
                )}

                {chosen.hasPortable && (
                    <label class={styles.choice}>
                        <input
                            type="checkbox"
                            checked={portable}
                            data-testid="export-portable"
                            onChange={(e) => setPortable(e.currentTarget.checked)}
                        />
                        <span class={styles.choiceLabel}>Keep it editable</span>
                        <span class={styles.choiceDetail}>
                            Stores the project inside the image, so Starforge reopens it with every
                            layer. Viewers still see a normal PNG, and a service that strips
                            metadata leaves the picture intact but drops the project.
                        </span>
                    </label>
                )}

                {PREVIEWABLE.includes(chosen.id) && (
                    <div class={styles.preview} data-testid="export-preview">
                        <div class={styles.previewStage} aria-busy={previewBusy}>
                            {preview ? (
                                <img
                                    class={styles.previewImg}
                                    src={preview.url}
                                    alt={preview.alt}
                                    data-testid="export-preview-img"
                                />
                            ) : (
                                <span class="mono dim">
                                    {previewError ? 'preview unavailable' : 'rendering…'}
                                </span>
                            )}
                        </div>
                        {preview && (
                            <p class={styles.previewMeta}>
                                <span class="mono" data-testid="export-preview-size">
                                    {formatBytes(preview.size)}
                                </span>
                                <span class="mono dim"> * {preview.note}</span>
                            </p>
                        )}
                    </div>
                )}

                <p class={styles.filename}>
                    <span class="mono dim">saves as</span>{' '}
                    <span class="mono" data-testid="export-filename">
                        {filename}
                    </span>
                </p>
            </form>

            <div class={styles.actions}>
                <button type="button" class={styles.action} onClick={onCancel}>
                    Cancel
                </button>
                <button
                    type="button"
                    class={`${styles.action} ${styles.primary}`}
                    data-testid="export-confirm"
                    onClick={submit}
                >
                    Export
                </button>
            </div>
        </dialog>
    )
}
