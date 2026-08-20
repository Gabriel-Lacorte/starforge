import { useEffect, useRef, useState } from 'preact/hooks'
import { portablePngFilename, visualPngFilename } from '../../export/png'
import styles from './ExportDialog.module.css'

export type ExportFormat = 'png'

export interface ExportChoice {
    readonly format: ExportFormat
    readonly portable: boolean
}

interface FormatOption {
    readonly id: ExportFormat
    readonly label: string
    readonly detail: string
    readonly filename: (title: string, portable: boolean) => string
    readonly embeds: boolean
}

const FORMATS: readonly FormatOption[] = [
    {
        id: 'png',
        label: 'PNG',
        detail: 'The active frame, flattened.',
        filename: (title, portable) =>
            portable ? portablePngFilename(title) : visualPngFilename(title),
        embeds: true,
    },
]

export function ExportDialog({
    title,
    onExport,
    onCancel,
}: {
    title: string
    onExport: (choice: ExportChoice) => void
    onCancel: () => void
}) {
    const ref = useRef<HTMLDialogElement>(null)
    const [chosen, setChosen] = useState<FormatOption>(FORMATS[0]!)
    const [portable, setPortable] = useState(false)

    useEffect(() => {
        ref.current?.showModal()
    }, [])

    const embeds = portable && chosen.embeds
    const filename = chosen.filename(title, embeds)

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
                    onExport({ format: chosen.id, portable: embeds })
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
                                onChange={() => {
                                    setChosen(option)
                                }}
                            />
                            <span class={styles.choiceLabel}>{option.label}</span>
                            <span class={styles.choiceDetail}>{option.detail}</span>
                        </label>
                    ))}
                </fieldset>

                <label class={styles.choice}>
                    <input
                        type="checkbox"
                        checked={embeds}
                        disabled={!chosen.embeds}
                        data-testid="export-portable"
                        onChange={(e) => {
                            setPortable(e.currentTarget.checked)
                        }}
                    />
                    <span class={styles.choiceLabel}>Keep it editable</span>
                    <span class={styles.choiceDetail}>
                        Stores the project inside the image, so Starforge reopens it with every
                        layer. Viewers still see a normal {chosen.label}, and a service that strips
                        metadata leaves the picture intact but drops the project.
                    </span>
                </label>

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
                    onClick={() => {
                        onExport({ format: chosen.id, portable: embeds })
                    }}
                >
                    Export
                </button>
            </div>
        </dialog>
    )
}
