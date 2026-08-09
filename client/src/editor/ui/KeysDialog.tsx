import { useEffect, useRef } from 'preact/hooks'
import styles from './KeysDialog.module.css'

interface Binding {
    readonly keys: string
    readonly what: string
}

interface Group {
    readonly name: string
    readonly rows: readonly Binding[]
}

const GROUPS: readonly Group[] = [
    {
        name: 'Tools',
        rows: [
            { keys: 'B', what: 'Pencil' },
            { keys: 'E', what: 'Eraser' },
            { keys: 'L', what: 'Line' },
            { keys: 'U', what: 'Rectangle, again for ellipse' },
            { keys: 'G', what: 'Bucket' },
            { keys: 'M', what: 'Select' },
            { keys: '[  ]', what: 'Brush smaller, larger' },
        ],
    },
    {
        name: 'View',
        rows: [
            { keys: 'Wheel, pinch', what: 'Zoom' },
            { keys: 'Space drag', what: 'Pan' },
            { keys: 'Middle drag', what: 'Pan' },
            { keys: 'Two fingers', what: 'Pan' },
            { keys: 'Zoom %', what: 'Fit the document to the window' },
        ],
    },
    {
        name: 'Editing',
        rows: [
            { keys: 'Ctrl Z', what: 'Undo' },
            { keys: 'Ctrl Shift Z', what: 'Redo' },
            { keys: 'Alt click', what: 'Pick up the colour under the cursor' },
            { keys: 'Esc', what: 'Abandon the stroke in progress' },
        ],
    },
    {
        name: 'Selection',
        rows: [
            { keys: 'Drag', what: 'Marquee, then drag inside it to move' },
            { keys: 'Arrows', what: 'Nudge by one pixel' },
            { keys: 'Enter', what: 'Stamp it down' },
            { keys: 'Esc', what: 'Drop it without stamping' },
        ],
    },
    {
        name: 'Layers',
        rows: [
            { keys: 'F2', what: 'Rename the focused layer' },
            { keys: 'Double click', what: 'Rename' },
        ],
    },
]

export function KeysDialog({ onClose }: { onClose: () => void }) {
    const ref = useRef<HTMLDialogElement>(null)

    useEffect(() => {
        ref.current?.showModal()
    }, [])

    return (
        <dialog
            ref={ref}
            class={styles.dialog}
            aria-label="Keys and gestures"
            data-testid="keys-dialog"
            onCancel={(e) => {
                e.preventDefault()
                onClose()
            }}
            onClick={(e) => {
                if (e.target === ref.current) onClose()
            }}
            onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape') {
                    e.preventDefault()
                    onClose()
                }
            }}
        >
            <header class={styles.header}>Keys and gestures</header>

            <div class={styles.body}>
                {GROUPS.map((group) => (
                    <section key={group.name} class={styles.group}>
                        <h2 class={styles.groupName}>{group.name}</h2>
                        <dl class={styles.rows}>
                            {group.rows.map((row) => (
                                <div key={`${group.name}-${row.keys}`} class={styles.row}>
                                    <dt class={`mono ${styles.keys}`}>{row.keys}</dt>
                                    <dd class={styles.what}>{row.what}</dd>
                                </div>
                            ))}
                        </dl>
                    </section>
                ))}
                <p class={styles.note}>On a Mac, Ctrl is Cmd.</p>
            </div>

            <div class={styles.actions}>
                <button
                    type="button"
                    class={styles.action}
                    data-testid="keys-close"
                    autofocus
                    onClick={onClose}
                >
                    Close
                </button>
            </div>
        </dialog>
    )
}
