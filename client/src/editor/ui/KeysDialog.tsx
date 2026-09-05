import { useEffect, useRef } from 'preact/hooks'
import { TOOL_CATALOG, toolBadge } from '../tools/catalog'
import styles from './KeysDialog.module.css'

interface Binding {
    readonly keys: string
    readonly what: string
}

interface Group {
    readonly name: string
    readonly rows: readonly Binding[]
}

/**
 * Read off the catalogue rather than kept by hand: the toolbar badges come from
 * the same source, so the two cannot drift apart again.
 */
function toolRows(): readonly Binding[] {
    const byKey = new Map<string, string[]>()
    for (const tool of TOOL_CATALOG) {
        const key = toolBadge(tool)
        const labels = byKey.get(key)
        if (labels) labels.push(tool.label)
        else byKey.set(key, [tool.label])
    }
    return [...byKey].map(([keys, labels]) => ({
        keys,
        what:
            labels.length > 1 ? `${labels[0]}, again for ${labels[1]!.toLowerCase()}` : labels[0]!,
    }))
}

const GROUPS: readonly Group[] = [
    {
        name: 'Tools',
        rows: [...toolRows(), { keys: '[  ]', what: 'Brush smaller, larger' }],
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
        name: 'Paint',
        rows: [
            { keys: 'X', what: 'Swap foreground and background' },
            { keys: 'D', what: 'Reset to the default colours' },
            { keys: '1  2  3  4', what: 'Selection mode: replace, add, subtract, intersect' },
        ],
    },
    {
        name: 'Selection',
        rows: [
            { keys: 'Drag', what: 'Marquee, then drag inside it to move' },
            { keys: 'Shift drag', what: 'Add to the selection' },
            { keys: 'Alt drag', what: 'Subtract from the selection' },
            { keys: 'Arrows', what: 'Nudge by one pixel' },
            { keys: 'Enter', what: 'Stamp it down' },
            { keys: 'Delete', what: 'Stamp it down and clear the selection' },
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
