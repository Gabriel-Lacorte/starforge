import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { CloseIcon } from './icons'
import styles from './MobileSheet.module.css'

export function MobileSheet({
    title,
    onClose,
    children,
}: {
    title: string
    onClose: () => void
    children: ComponentChildren
}) {
    const ref = useRef<HTMLDialogElement>(null)

    useEffect(() => {
        ref.current?.showModal()
    }, [])

    return (
        <dialog
            ref={ref}
            class={styles.sheet}
            aria-label={title}
            data-testid="mobile-sheet"
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
            <header class={styles.header}>
                {title}
                <button
                    type="button"
                    class={styles.close}
                    aria-label="Close"
                    data-testid="sheet-close"
                    onClick={onClose}
                >
                    <CloseIcon />
                </button>
            </header>
            <div class={styles.body}>{children}</div>
        </dialog>
    )
}
