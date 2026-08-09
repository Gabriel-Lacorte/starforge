import type { Sprite } from '@starforge/core'
import type { DocumentSession } from '../document/session'
import type { EditorStore } from '../editor/store'
import { saveDocument } from './localDoc'

export type SaveState = 'pending' | 'saved' | 'failed'

const DELAY_MS = 600

export interface AutosaveOptions {
    onState?: (state: SaveState) => void
    delayMs?: number
}

export function startAutosave(
    sprite: Sprite,
    session: DocumentSession,
    store: EditorStore,
    options: AutosaveOptions = {},
): () => void {
    const delay = options.delayMs ?? DELAY_MS
    let timer: ReturnType<typeof setTimeout> | null = null
    let activeLayer = store.state.activeLayer

    const flush = (): void => {
        if (timer !== null) {
            clearTimeout(timer)
            timer = null
        }
        activeLayer = store.state.activeLayer
        options.onState?.(saveDocument({ sprite, activeLayer }) ? 'saved' : 'failed')
    }

    const schedule = (): void => {
        if (timer !== null) return
        options.onState?.('pending')
        timer = setTimeout(flush, delay)
    }

    const onStoreChange = (): void => {
        if (store.state.activeLayer === activeLayer) return
        activeLayer = store.state.activeLayer
        schedule()
    }

    const onHide = (): void => {
        if (document.visibilityState === 'hidden') flush()
    }

    const unsubscribeSession = session.subscribe(schedule)
    const unsubscribeStore = store.subscribe(onStoreChange)

    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)

    flush()

    return () => {
        unsubscribeSession()
        unsubscribeStore()
        window.removeEventListener('pagehide', flush)
        document.removeEventListener('visibilitychange', onHide)
        flush()
    }
}
