import type { Sprite } from '@starforge/core'
import type { DocumentSession } from '../document/session'
import { renderThumbnail } from '../export/thumbnail'
import { StorageError } from './db'
import type { Library } from './library'

export type SaveState = 'pending' | 'saved' | 'failed'

const DELAY_MS = 600

export interface AutosaveOptions {
    onState?: (state: SaveState, reason?: StorageError) => void
    delayMs?: number
}

export function startAutosave(
    sprite: Sprite,
    session: DocumentSession,
    library: Library,
    options: AutosaveOptions = {},
): () => void {
    const delay = options.delayMs ?? DELAY_MS
    let timer: ReturnType<typeof setTimeout> | null = null
    let writing: Promise<void> = Promise.resolve()
    let disposed = false

    const write = (): void => {
        if (timer !== null) {
            clearTimeout(timer)
            timer = null
        }

        const { layer, frame } = session.target.state
        writing = writing
            .catch(() => undefined)
            .then(() => renderThumbnail(sprite, frame).catch(() => null))
            .then((thumbnail) =>
                library.save({
                    sprite,
                    activeLayer: layer,
                    activeFrame: frame,
                    ...(thumbnail ? { thumbnail } : {}),
                }),
            )
            .then(
                () => {
                    if (!disposed) options.onState?.('saved')
                },
                (cause: unknown) => {
                    if (!disposed) {
                        options.onState?.(
                            'failed',
                            cause instanceof StorageError ? cause : undefined,
                        )
                    }
                },
            )
    }

    const schedule = (): void => {
        if (timer !== null) return
        options.onState?.('pending')
        timer = setTimeout(write, delay)
    }

    const onHide = (): void => {
        if (document.visibilityState === 'hidden') write()
    }

    const unsubscribeSession = session.subscribe(schedule)
    const unsubscribeTarget = session.target.subscribe(schedule)

    window.addEventListener('pagehide', write)
    document.addEventListener('visibilitychange', onHide)

    write()

    return () => {
        disposed = true
        unsubscribeSession()
        unsubscribeTarget()
        window.removeEventListener('pagehide', write)
        document.removeEventListener('visibilitychange', onHide)
        write()
    }
}
