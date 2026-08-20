import type { ReadoutStore } from '../readout'
import { useStore } from './useStore'
import styles from './EditorCrash.module.css'

export type CrashKind = 'render' | 'document'

const EXPORT_NOTE = {
    working: 'Building the PNG...',
    done: 'Exported. Check your downloads.',
    failed: 'The export failed too. Reload and try again, your drawing is saved.',
} as const

const HEADLINE: Record<CrashKind, string> = {
    render: 'The editor stopped.',
    document: 'This document cannot be opened.',
}

const BODY: Record<CrashKind, string> = {
    render: 'Your drawing is still here and still saved in this browser. Export it before you reload.',
    document:
        'It has no layers or no frames, so there is nothing to draw on. Starting a new sprite replaces it.',
}

export function EditorCrash({
    kind,
    detail,
    canExport,
    readout,
    onExport,
    onRetry,
    onNew,
}: {
    kind: CrashKind
    detail?: string | undefined
    canExport: boolean
    readout: ReadoutStore
    onExport: () => void
    onRetry: (() => void) | null
    onNew: () => void
}) {
    const { exportState } = useStore(readout)

    return (
        <div class={styles.crash} role="alert" data-testid="editor-crash">
            <div class={styles.panel}>
                <h2 class={styles.headline}>{HEADLINE[kind]}</h2>
                <p class={styles.body}>{BODY[kind]}</p>

                <div class={styles.actions}>
                    {canExport && (
                        <button
                            type="button"
                            class={`${styles.action} ${styles.primary}`}
                            data-testid="crash-export"
                            disabled={exportState === 'working'}
                            onClick={onExport}
                        >
                            Export PNG
                        </button>
                    )}
                    {onRetry && (
                        <button
                            type="button"
                            class={styles.action}
                            data-testid="crash-retry"
                            onClick={onRetry}
                        >
                            Try again
                        </button>
                    )}
                    <button
                        type="button"
                        class={styles.action}
                        data-testid="crash-new"
                        onClick={onNew}
                    >
                        New sprite
                    </button>
                </div>

                {exportState && (
                    <p
                        class={`${styles.note}${exportState === 'failed' ? ` ${styles.noteFailed}` : ''}`}
                        data-testid="crash-export-note"
                        role="status"
                    >
                        {EXPORT_NOTE[exportState]}
                    </p>
                )}

                {detail && (
                    <p class={`mono ${styles.detail}`} data-testid="crash-detail">
                        {detail}
                    </p>
                )}
            </div>
        </div>
    )
}
