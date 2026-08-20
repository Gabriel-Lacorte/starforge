import type { TransformKind } from '@starforge/core'
import { FlipXIcon, FlipYIcon, RedoIcon, RotateIcon, UndoIcon } from './icons'
import styles from './Toolbar.module.css'
import { blurOnPointer } from './blurOnPointer'

const TRANSFORMS = [
    { kind: 'flip-h', key: 'h', label: 'Flip horizontally', Icon: FlipXIcon },
    { kind: 'flip-v', key: 'v', label: 'Flip vertically', Icon: FlipYIcon },
    { kind: 'rotate-cw', key: 'r', label: 'Rotate right', Icon: RotateIcon },
] as const

export function HistoryActions({
    canUndo,
    canRedo,
    onHistory,
    onTransform,
}: {
    canUndo: boolean
    canRedo: boolean
    onHistory: (direction: 'undo' | 'redo') => void
    onTransform: (kind: TransformKind) => void
}) {
    return (
        <>
            <button
                type="button"
                class={styles.iconBtn}
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
                data-testid="undo"
                disabled={!canUndo}
                onClick={(e) => {
                    onHistory('undo')
                    blurOnPointer(e)
                }}
            >
                <UndoIcon />
            </button>
            <button
                type="button"
                class={styles.iconBtn}
                title="Redo (Ctrl+Shift+Z)"
                aria-label="Redo"
                data-testid="redo"
                disabled={!canRedo}
                onClick={(e) => {
                    onHistory('redo')
                    blurOnPointer(e)
                }}
            >
                <RedoIcon />
            </button>
            <span class={styles.sep} />
            {TRANSFORMS.map((entry) => (
                <button
                    key={entry.kind}
                    type="button"
                    class={styles.iconBtn}
                    title={`${entry.label} (Shift+${entry.key.toUpperCase()})`}
                    aria-label={entry.label}
                    data-testid={`transform-${entry.kind}`}
                    onClick={(e) => {
                        onTransform(entry.kind)
                        blurOnPointer(e)
                    }}
                >
                    <entry.Icon />
                </button>
            ))}
        </>
    )
}
