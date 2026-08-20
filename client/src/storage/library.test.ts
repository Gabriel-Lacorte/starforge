import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { createSprite, encodeSprite, rgba, writePixel, type Sprite } from '@starforge/core'
import { DATABASE_NAME, DOCUMENTS, StorageError, openDatabase } from './db'
import { Library, migrateLocalDocument } from './library'
import type { StorageLike } from './localDoc'

const RED = rgba(255, 0, 0)

let factory: IDBFactory

beforeEach(() => {
    factory = new IDBFactory()
})

function drawing(title = 'kept'): Sprite {
    const sprite = createSprite({ width: 16, height: 16, title })
    writePixel(sprite, sprite.layers[0]!.id, sprite.frames[0]!.id, 3, 4, RED)
    return sprite
}

function saveOf(sprite: Sprite) {
    return {
        sprite,
        activeLayer: sprite.layers[0]!.id,
        activeFrame: sprite.frames[0]!.id,
    }
}

function fakeLocalStorage(entries: Record<string, string> = {}): StorageLike & {
    read: Map<string, string>
} {
    const read = new Map(Object.entries(entries))
    return {
        read,
        getItem: (key) => read.get(key) ?? null,
        setItem: (key, value) => {
            read.set(key, value)
        },
        removeItem: (key) => {
            read.delete(key)
        },
    }
}

describe('Library', () => {
    it('keeps a document and hands it back with its pixels', async () => {
        const library = await Library.open(factory)
        const sprite = drawing()
        await library.save(saveOf(sprite))

        const opened = await library.open(sprite.id)
        expect(opened?.sprite.meta.title).toBe('kept')
        expect(opened?.sprite.layers[0]!.cels.get(sprite.frames[0]!.id)).toBeDefined()
        expect(opened?.activeLayer).toBe(sprite.layers[0]!.id)
    })

    it('lists metadata newest first, without decoding a pixel', async () => {
        const library = await Library.open(factory)
        const older = drawing('older')
        const newer = drawing('newer')

        await library.save(saveOf(older), new Date('2026-01-01T00:00:00.000Z'))
        await library.save(saveOf(newer), new Date('2026-06-01T00:00:00.000Z'))

        const listed = await library.list()
        expect(listed.map((entry) => entry.title)).toEqual(['newer', 'older'])
        expect(listed[0]).not.toHaveProperty('snapshot')
    })

    it('reopens the document last worked on', async () => {
        const library = await Library.open(factory)
        await library.save(saveOf(drawing('first')), new Date('2026-01-01T00:00:00.000Z'))
        await library.save(saveOf(drawing('last')), new Date('2026-09-01T00:00:00.000Z'))

        expect((await library.openLatest())?.sprite.meta.title).toBe('last')
    })

    it('replaces a document rather than piling copies of it up', async () => {
        const library = await Library.open(factory)
        const sprite = drawing()

        await library.save(saveOf(sprite))
        sprite.meta.title = 'renamed'
        await library.save(saveOf(sprite))

        const listed = await library.list()
        expect(listed).toHaveLength(1)
        expect(listed[0]!.title).toBe('renamed')
    })

    it('falls back to a target the document still has', async () => {
        const library = await Library.open(factory)
        const sprite = drawing()
        await library.save({ sprite, activeLayer: 'gone', activeFrame: 'gone' })

        const opened = await library.open(sprite.id)
        expect(opened?.activeLayer).toBe(sprite.layers.at(-1)!.id)
        expect(opened?.activeFrame).toBe(sprite.frames.at(-1)!.id)
    })

    it('forgets a document on request', async () => {
        const library = await Library.open(factory)
        const sprite = drawing()
        await library.save(saveOf(sprite))

        await library.remove(sprite.id)
        expect(await library.list()).toEqual([])
    })
})

describe('Library failure paths', () => {
    it('moves a snapshot that no longer decodes into recovery instead of losing it', async () => {
        const library = await Library.open(factory)
        const sprite = drawing('damaged')
        await library.save(saveOf(sprite))

        /* corrupt the stored snapshot the way a bad write or a future version would */
        const db = await openDatabase(factory)
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction([DOCUMENTS], 'readwrite')
            const store = transaction.objectStore(DOCUMENTS)
            const read = store.get(sprite.id)
            read.onsuccess = () => {
                const record = read.result as { snapshot: { layers: unknown } }
                record.snapshot.layers = 'not layers at all'
                store.put(record)
            }
            transaction.oncomplete = () => {
                resolve()
            }
            transaction.onerror = () => {
                reject(transaction.error ?? new Error('transaction failed'))
            }
        })
        db.close()

        expect(await library.open(sprite.id)).toBeNull()
        expect(await library.list()).toEqual([])

        const kept = await library.recoveries()
        expect(kept).toHaveLength(1)
        expect(kept[0]!.title).toContain('damaged')
        expect(kept[0]!.snapshot).toBeDefined()
    })

    it('refuses a database written by a newer Starforge instead of reshaping it', async () => {
        await new Promise<void>((resolve, reject) => {
            const request = factory.open(DATABASE_NAME, 99)
            request.onupgradeneeded = () => request.result.createObjectStore('later')
            request.onsuccess = () => {
                request.result.close()
                resolve()
            }
            request.onerror = () => {
                reject(request.error ?? new Error('open failed'))
            }
        })

        await expect(Library.open(factory)).rejects.toMatchObject({ reason: 'version' })
    })

    it('says so plainly when the browser has no IndexedDB at all', async () => {
        await expect(Library.open(null as unknown as IDBFactory)).rejects.toMatchObject({
            reason: 'unavailable',
        })
    })
})

describe('migrating off localStorage', () => {
    const KEY = 'starforge.document'

    it('moves the old document across and only then forgets it', async () => {
        const library = await Library.open(factory)
        const sprite = drawing('from local storage')
        const storage = fakeLocalStorage({
            [KEY]: JSON.stringify({
                sprite: encodeSprite(sprite),
                activeLayer: sprite.layers[0]!.id,
            }),
        })

        expect(await migrateLocalDocument(library, storage)).toBe(true)
        expect((await library.openLatest())?.sprite.meta.title).toBe('from local storage')
        expect(storage.read.has(KEY)).toBe(false)
    })

    it('keeps the old document when the new one cannot be read back', async () => {
        const library = await Library.open(factory)
        const sprite = drawing()
        const storage = fakeLocalStorage({
            [KEY]: JSON.stringify({
                sprite: encodeSprite(sprite),
                activeLayer: sprite.layers[0]!.id,
            }),
        })

        library.close()
        await expect(migrateLocalDocument(library, storage)).rejects.toBeInstanceOf(StorageError)
        expect(storage.read.has(KEY)).toBe(true)
    })

    it('does nothing when there is nothing to move', async () => {
        const library = await Library.open(factory)

        expect(await migrateLocalDocument(library, fakeLocalStorage())).toBe(false)
        expect(await migrateLocalDocument(library, null)).toBe(false)
    })
})
