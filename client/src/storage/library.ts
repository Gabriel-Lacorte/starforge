import { decodeSprite, encodeSprite, SnapshotError, type Sprite } from '@starforge/core'
import {
    DOCUMENTS,
    RECOVERY,
    THUMBNAILS,
    failureFrom,
    openDatabase,
    readOnly,
    readWrite,
    request,
    StorageError,
    type StoredMeta,
    type StoredRecord,
    type StoredThumbnail,
} from './db'
import {
    browserStorage,
    clearDocument,
    loadDocument,
    type StorageLike,
    type StoredDocument,
} from './localDoc'

export interface LibraryEntry extends StoredMeta {
    readonly activeLayer: string
    readonly activeFrame: string
}

export interface OpenedDocument {
    readonly sprite: Sprite
    readonly activeLayer: string
    readonly activeFrame: string
}

export interface SaveInput {
    readonly sprite: Sprite
    readonly activeLayer: string
    readonly activeFrame: string
    readonly thumbnail?: Blob
}

export class Library {
    readonly #db: IDBDatabase

    private constructor(db: IDBDatabase) {
        this.#db = db
    }

    static async open(factory?: IDBFactory): Promise<Library> {
        return new Library(await openDatabase(factory))
    }

    close(): void {
        this.#db.close()
    }

    async save(input: SaveInput, now = new Date()): Promise<void> {
        const record: StoredRecord = {
            id: input.sprite.id,
            title: input.sprite.meta.title,
            width: input.sprite.width,
            height: input.sprite.height,
            updatedAt: now.toISOString(),
            snapshot: encodeSprite(input.sprite),
            activeLayer: input.activeLayer,
            activeFrame: input.activeFrame,
        }

        const image = input.thumbnail
        await readWrite(
            this.#db,
            image ? [DOCUMENTS, THUMBNAILS] : [DOCUMENTS],
            async (transaction) => {
                await request(transaction.objectStore(DOCUMENTS).put(record))
                if (image) {
                    await request(transaction.objectStore(THUMBNAILS).put({ id: record.id, image }))
                }
            },
        )
    }

    async thumbnail(id: string): Promise<Blob | null> {
        const stored = await readOnly(this.#db, [THUMBNAILS], (transaction) =>
            request(
                transaction.objectStore(THUMBNAILS).get(id) as IDBRequest<
                    StoredThumbnail | undefined
                >,
            ),
        )

        return stored?.image ?? null
    }

    async list(): Promise<readonly LibraryEntry[]> {
        const records = await readOnly(this.#db, [DOCUMENTS], (transaction) =>
            request(transaction.objectStore(DOCUMENTS).getAll() as IDBRequest<StoredRecord[]>),
        )

        return records
            .map(({ id, title, width, height, updatedAt, activeLayer, activeFrame }) => ({
                id,
                title,
                width,
                height,
                updatedAt,
                activeLayer,
                activeFrame,
            }))
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    }

    async open(id: string): Promise<OpenedDocument | null> {
        const record = await readOnly(this.#db, [DOCUMENTS], (transaction) =>
            request(
                transaction.objectStore(DOCUMENTS).get(id) as IDBRequest<StoredRecord | undefined>,
            ),
        )
        if (!record) return null

        try {
            const sprite = decodeSprite(record.snapshot)
            return {
                sprite,
                activeLayer: resolve(sprite.layers, record.activeLayer),
                activeFrame: resolve(sprite.frames, record.activeFrame),
            }
        } catch (error) {
            await this.#preserve(record, error)
            return null
        }
    }

    async openLatest(): Promise<OpenedDocument | null> {
        for (const entry of await this.list()) {
            const opened = await this.open(entry.id)
            if (opened) return opened
        }

        return null
    }

    async remove(id: string): Promise<void> {
        await readWrite(this.#db, [DOCUMENTS, THUMBNAILS], async (transaction) => {
            await request(transaction.objectStore(DOCUMENTS).delete(id))
            await request(transaction.objectStore(THUMBNAILS).delete(id))
        })
    }

    async recoveryFile(id: string): Promise<Blob | null> {
        const kept = (await this.recoveries()).find((record) => record.id === id)
        if (!kept) return null

        return new Blob(
            [JSON.stringify({ sprite: kept.snapshot, activeLayer: kept.activeLayer })],
            {
                type: 'application/json',
            },
        )
    }

    async forgetRecovery(id: string): Promise<void> {
        await readWrite(this.#db, [RECOVERY], (transaction) =>
            request(transaction.objectStore(RECOVERY).delete(id)),
        )
    }

    async recoveries(): Promise<readonly StoredRecord[]> {
        return readOnly(this.#db, [RECOVERY], (transaction) =>
            request(transaction.objectStore(RECOVERY).getAll() as IDBRequest<StoredRecord[]>),
        )
    }

    async #preserve(record: StoredRecord, error: unknown): Promise<void> {
        const reason = error instanceof SnapshotError ? error.code : 'FORMAT'
        await readWrite(this.#db, [DOCUMENTS, RECOVERY], async (transaction) => {
            await request(
                transaction
                    .objectStore(RECOVERY)
                    .put({ ...record, title: `${record.title} (${reason})` }),
            )
            await request(transaction.objectStore(DOCUMENTS).delete(record.id))
        })
    }
}

export async function migrateLocalDocument(
    library: Library,
    storage: StorageLike | null = browserStorage(),
): Promise<boolean> {
    if (!storage) return false

    let stored: StoredDocument | null
    try {
        stored = loadDocument(storage)
    } catch {
        return false
    }
    if (!stored) return false

    try {
        await library.save({
            sprite: stored.sprite,
            activeLayer: stored.activeLayer,
            activeFrame: stored.sprite.frames[0]!.id,
        })
        if (!(await library.open(stored.sprite.id))) return false
    } catch (cause) {
        throw failureFrom(cause)
    }

    clearDocument(storage)
    return true
}

export { StorageError }

function resolve(items: readonly { id: string }[], wanted: string): string {
    return items.some((item) => item.id === wanted) ? wanted : items[items.length - 1]!.id
}
