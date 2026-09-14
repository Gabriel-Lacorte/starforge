import { useEffect, useState } from 'preact/hooks'
import type { ReadoutStore } from '../readout'
import { UndoIcon } from './icons'
import { useStore } from './useStore'
import styles from './FirstVisitHint.module.css'

const STORAGE_KEY = 'starforge:hint-dismissed'

function isDismissed(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
        return false
    }
}

function persist(): void {
    try {
        localStorage.setItem(STORAGE_KEY, '1')
    } catch {
        /* ignore */
    }
}

export function FirstVisitHint({ readout }: { readout: ReadoutStore }) {
    const [visible, setVisible] = useState(() => !isDismissed())
    const { canUndo } = useStore(readout)

    useEffect(() => {
        if (visible && canUndo) {
            persist()
            setVisible(false)
        }
    }, [canUndo, visible])

    if (!visible) return null

    const dismiss = () => {
        persist()
        setVisible(false)
    }

    const touch =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse)').matches

    return (
        <p role="status" class={styles.hint} data-testid="first-visit-hint">
            {touch ? (
                <>
                    pinch to zoom * <UndoIcon /> two-finger tap undoes
                </>
            ) : (
                <>
                    press <kbd>?</kbd> for shortcuts * <kbd>B</kbd> draws
                </>
            )}
            <button type="button" class={styles.close} aria-label="Dismiss hint" onClick={dismiss}>
                x
            </button>
        </p>
    )
}
