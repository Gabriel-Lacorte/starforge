import { decodeSprite, encodeSprite, type Sprite } from '@starforge/core'

const KEY = 'starforge.document'

export interface StorageLike {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

export interface StoredDocument {
    sprite: Sprite
    activeLayer: string
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
    } catch {
        clearDocument(storage)
        return null
    }
}

export function saveDocument(
    doc: StoredDocument,
    storage: StorageLike | null = browserStorage(),
): boolean {
    if (!storage) return false

    try {
        storage.setItem(
            KEY,
            JSON.stringify({ sprite: encodeSprite(doc.sprite), activeLayer: doc.activeLayer }),
        )
        return true
    } catch {
        /* out of quota, or storage revoked mid-session. */
        return false
    }
}

export function clearDocument(storage: StorageLike | null = browserStorage()): void {
    try {
        storage?.removeItem(KEY)
    } catch {
        /* nothing left to do */
    }
}
