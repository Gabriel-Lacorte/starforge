import {
    SnapshotError,
    decodeSprite,
    encodeSprite,
    type SnapshotErrorCode,
    type Sprite,
} from '@starforge/core'

const KEY = 'starforge.document'
const RECOVERY_KEY = 'starforge.document.recovery'
const REPLACEMENT_RECOVERY_KEY = 'starforge.document.recovery.before-open'

export interface StorageLike {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

export interface StoredDocument {
    sprite: Sprite
    activeLayer: string
}

export interface DocumentRecovery {
    raw: string
    capturedAt: string
    reason: SnapshotErrorCode | 'PROJECT_OPEN'
}

export function browserStorage(): StorageLike | null {
    try {
        return globalThis.localStorage
    } catch {
        return null
    }
}

export function loadDocument(
    storage: StorageLike | null = browserStorage(),
): StoredDocument | null {
    if (!storage) return null

    let raw: string | null
    try {
        raw = storage.getItem(KEY)
    } catch {
        return null
    }
    if (!raw) return null

    try {
        const record = JSON.parse(raw) as { sprite?: unknown; activeLayer?: unknown }
        const sprite = decodeSprite(record.sprite)
        const wanted = record.activeLayer

        return {
            sprite,
            activeLayer: sprite.layers.some((layer) => layer.id === wanted)
                ? (wanted as string)
                : sprite.layers[sprite.layers.length - 1]!.id,
        }
    } catch (error) {
        preserveDocumentRecovery(storage, raw, error)
        return null
    }
}

export function loadDocumentRecovery(
    storage: StorageLike | null = browserStorage(),
): DocumentRecovery | null {
    return loadRecoveryAt(RECOVERY_KEY, storage)
}

export function saveDocument(
    doc: StoredDocument,
    storage: StorageLike | null = browserStorage(),
): boolean {
    if (!storage) return false

    try {
        storage.setItem(KEY, serializeDocument(doc))
        return true
    } catch {
        /* out of quota, or storage revoked mid-session. */
        return false
    }
}

export function saveReplacementRecovery(
    doc: StoredDocument,
    storage: StorageLike | null = browserStorage(),
): boolean {
    if (!storage) return false

    try {
        const recovery: DocumentRecovery = {
            raw: serializeDocument(doc),
            capturedAt: new Date().toISOString(),
            reason: 'PROJECT_OPEN',
        }
        storage.setItem(REPLACEMENT_RECOVERY_KEY, JSON.stringify(recovery))
        return true
    } catch {
        return false
    }
}

export function loadReplacementRecovery(
    storage: StorageLike | null = browserStorage(),
): DocumentRecovery | null {
    return loadRecoveryAt(REPLACEMENT_RECOVERY_KEY, storage)
}

export function clearDocument(storage: StorageLike | null = browserStorage()): void {
    try {
        storage?.removeItem(KEY)
    } catch {
        /* nothing left to do */
    }
}

export function clearDocumentRecovery(storage: StorageLike | null = browserStorage()): void {
    try {
        storage?.removeItem(RECOVERY_KEY)
    } catch {
        /* recovery remains available if storage cannot be changed */
    }
}

export function clearReplacementRecovery(storage: StorageLike | null = browserStorage()): void {
    try {
        storage?.removeItem(REPLACEMENT_RECOVERY_KEY)
    } catch {
        /* recovery remains available if storage cannot be changed */
    }
}

function preserveDocumentRecovery(storage: StorageLike, raw: string, error: unknown): void {
    try {
        const existing = loadDocumentRecovery(storage)
        if (existing?.raw === raw) return

        const recovery: DocumentRecovery = {
            raw,
            capturedAt: new Date().toISOString(),
            reason: error instanceof SnapshotError ? error.code : 'FORMAT',
        }
        storage.setItem(RECOVERY_KEY, JSON.stringify(recovery))
    } catch {
        /* the unreadable primary value is deliberately left untouched */
    }
}

function isSnapshotErrorCode(value: unknown): value is SnapshotErrorCode {
    return value === 'FORMAT' || value === 'VERSION' || value === 'LIMIT' || value === 'CORRUPTION'
}

function serializeDocument(doc: StoredDocument): string {
    return JSON.stringify({ sprite: encodeSprite(doc.sprite), activeLayer: doc.activeLayer })
}

function loadRecoveryAt(key: string, storage: StorageLike | null): DocumentRecovery | null {
    if (!storage) return null

    try {
        const raw = storage.getItem(key)
        if (!raw) return null

        const value = JSON.parse(raw) as Partial<DocumentRecovery>
        if (
            typeof value.raw !== 'string' ||
            typeof value.capturedAt !== 'string' ||
            !(isSnapshotErrorCode(value.reason) || value.reason === 'PROJECT_OPEN')
        ) {
            return null
        }
        return { raw: value.raw, capturedAt: value.capturedAt, reason: value.reason }
    } catch {
        return null
    }
}
