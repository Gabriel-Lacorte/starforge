import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { LibraryEntry } from '../../storage/library'
import { TrashIcon } from './icons'
import styles from './LibraryDialog.module.css'

export interface RecoveredDocument {
    readonly id: string
    readonly title: string
    readonly updatedAt: string
}

export function LibraryDialog({
    entries,
    recoveries,
    openId,
    thumbnail,
    onOpen,
    onRemove,
    onDownloadRecovery,
    onForgetRecovery,
    onClose,
}: {
    entries: readonly LibraryEntry[]
    recoveries: readonly RecoveredDocument[]
    openId: string
    thumbnail: (id: string) => Promise<Blob | null>
    onOpen: (id: string) => void
    onRemove: (id: string) => void
    onDownloadRecovery: (id: string) => void
    onForgetRecovery: (id: string) => void
    onClose: () => void
}) {
    const ref = useRef<HTMLDialogElement>(null)
    const [query, setQuery] = useState('')

    useEffect(() => {
        ref.current?.showModal()
    }, [])

    const found = useMemo(() => {
        const needle = query.trim().toLowerCase()
        if (!needle) return entries

        return entries.filter((entry) => entry.title.toLowerCase().includes(needle))
    }, [entries, query])

    return (
        <dialog
            ref={ref}
            class={styles.dialog}
            aria-label="Your drawings"
            data-testid="library-dialog"
            onCancel={(e) => {
                e.preventDefault()
                onClose()
            }}
            onClick={(e) => {
                if (e.target === ref.current) onClose()
            }}
            onKeyDown={(e) => {
                e.stopPropagation()
            }}
        >
            <header class={styles.header}>Your drawings</header>

            <div class={styles.body}>
                <label class={styles.search}>
                    <span class="sr-only">Search your drawings by name</span>
                    <input
                        type="search"
                        value={query}
                        placeholder="search by name"
                        spellcheck={false}
                        autocomplete="off"
                        data-testid="library-search"
                        onInput={(e) => {
                            setQuery(e.currentTarget.value)
                        }}
                    />
                </label>

                {found.length === 0 ? (
                    <p class={styles.empty} data-testid="library-empty">
                        {entries.length === 0
                            ? 'Nothing saved here yet. Whatever you draw is kept as you go.'
                            : 'No drawing here goes by that name.'}
                    </p>
                ) : (
                    <ul class={styles.list}>
                        {found.map((entry) => (
                            <li
                                key={entry.id}
                                class={`${styles.row}${entry.id === openId ? ` ${styles.on}` : ''}`}
                                data-testid="library-row"
                            >
                                <Thumb id={entry.id} title={entry.title} thumbnail={thumbnail} />
                                <button
                                    type="button"
                                    class={styles.pick}
                                    data-testid="library-open"
                                    aria-current={entry.id === openId}
                                    onClick={() => {
                                        onOpen(entry.id)
                                    }}
                                >
                                    <span class={styles.title} dir="auto">
                                        {entry.title}
                                    </span>
                                    <span class={`mono dim ${styles.meta}`}>
                                        {entry.width}x{entry.height} · {day(entry.updatedAt)}
                                        {entry.id === openId ? ' · open' : ''}
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    class={styles.icon}
                                    title={`Forget "${entry.title}"`}
                                    aria-label={`Forget ${entry.title}`}
                                    data-testid="library-remove"
                                    disabled={entry.id === openId}
                                    onClick={() => {
                                        onRemove(entry.id)
                                    }}
                                >
                                    <TrashIcon />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                {recoveries.length > 0 && (
                    <section class={styles.recovery} data-testid="library-recovery">
                        <h2 class={styles.recoveryTitle}>Could not be opened</h2>
                        <p class={styles.detail}>
                            Starforge kept these exactly as they were found. Download one to keep it
                            somewhere safe before letting it go.
                        </p>
                        {recoveries.map((entry) => (
                            <div key={entry.id} class={styles.row}>
                                <span class={styles.title} dir="auto">
                                    {entry.title}
                                </span>
                                <button
                                    type="button"
                                    class={styles.action}
                                    data-testid="recovery-download"
                                    onClick={() => {
                                        onDownloadRecovery(entry.id)
                                    }}
                                >
                                    Download
                                </button>
                                <button
                                    type="button"
                                    class={styles.icon}
                                    title="Let this one go"
                                    aria-label={`Let ${entry.title} go`}
                                    data-testid="recovery-forget"
                                    onClick={() => {
                                        onForgetRecovery(entry.id)
                                    }}
                                >
                                    <TrashIcon />
                                </button>
                            </div>
                        ))}
                    </section>
                )}
            </div>

            <div class={styles.actions}>
                <button
                    type="button"
                    class={`${styles.action} ${styles.primary}`}
                    data-testid="library-done"
                    onClick={onClose}
                >
                    Done
                </button>
            </div>
        </dialog>
    )
}

function Thumb({
    id,
    title,
    thumbnail,
}: {
    id: string
    title: string
    thumbnail: (id: string) => Promise<Blob | null>
}) {
    const [url, setUrl] = useState<string | null>(null)

    useEffect(() => {
        let live = true
        let created: string | null = null

        void thumbnail(id).then((blob) => {
            if (!live || !blob) return
            created = URL.createObjectURL(blob)
            setUrl(created)
        })

        return () => {
            live = false
            if (created) URL.revokeObjectURL(created)
        }
    }, [id, thumbnail])

    return url ? (
        <img class={`chip-empty ${styles.thumb}`} src={url} alt="" width="48" height="48" />
    ) : (
        <span class={`chip-empty ${styles.thumb}`} aria-hidden="true" title={title} />
    )
}

function day(iso: string): string {
    const when = new Date(iso)
    if (Number.isNaN(when.getTime())) return 'unknown'

    return when.toISOString().slice(0, 10)
}
