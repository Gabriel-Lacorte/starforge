export const DATABASE_NAME = 'starforge'
export const DATABASE_VERSION = 1

export const DOCUMENTS = 'documents'
export const RECOVERY = 'recovery'
export const THUMBNAILS = 'thumbnails'

export type StorageFailure = 'unavailable' | 'blocked' | 'version' | 'quota' | 'aborted'

export class StorageError extends Error {
    readonly reason: StorageFailure

    constructor(reason: StorageFailure, detail: string) {
        super(`local storage ${reason}: ${detail}`)
        this.name = 'StorageError'
        this.reason = reason
    }
}

export interface StoredMeta {
    readonly id: string
    readonly title: string
    readonly width: number
    readonly height: number
    readonly updatedAt: string
}

export interface StoredThumbnail {
    readonly id: string
    readonly image: Blob
}

export interface StoredRecord extends StoredMeta {
    readonly snapshot: unknown
    readonly activeLayer: string
    readonly activeFrame: string
}

export function indexedDbFactory(): IDBFactory | null {
    try {
        return globalThis.indexedDB
    } catch {
        return null
    }
}

export function openDatabase(
    factory: IDBFactory | null = indexedDbFactory(),
): Promise<IDBDatabase> {
    if (!factory) {
        return Promise.reject(new StorageError('unavailable', 'this browser has no IndexedDB'))
    }

    return new Promise((resolve, reject) => {
        let request: IDBOpenDBRequest
        try {
            request = factory.open(DATABASE_NAME, DATABASE_VERSION)
        } catch (cause) {
            reject(failureFrom(cause))
            return
        }

        request.onupgradeneeded = () => {
            const db = request.result
            if (!db.objectStoreNames.contains(DOCUMENTS)) {
                db.createObjectStore(DOCUMENTS, { keyPath: 'id' }).createIndex(
                    'updatedAt',
                    'updatedAt',
                )
            }
            if (!db.objectStoreNames.contains(RECOVERY)) {
                db.createObjectStore(RECOVERY, { keyPath: 'id' })
            }
            if (!db.objectStoreNames.contains(THUMBNAILS)) {
                db.createObjectStore(THUMBNAILS, { keyPath: 'id' })
            }
        }

        request.onblocked = () => {
            reject(new StorageError('blocked', 'another tab is holding an older database open'))
        }
        request.onerror = () => {
            reject(failureFrom(request.error))
        }
        request.onsuccess = () => {
            const db = request.result
            db.onversionchange = () => {
                db.close()
            }
            resolve(db)
        }
    })
}

export function readWrite<T>(
    db: IDBDatabase,
    stores: readonly string[],
    work: (transaction: IDBTransaction) => Promise<T> | T,
): Promise<T> {
    return runTransaction(db, stores, 'readwrite', work)
}

export function readOnly<T>(
    db: IDBDatabase,
    stores: readonly string[],
    work: (transaction: IDBTransaction) => Promise<T> | T,
): Promise<T> {
    return runTransaction(db, stores, 'readonly', work)
}

async function runTransaction<T>(
    db: IDBDatabase,
    stores: readonly string[],
    mode: IDBTransactionMode,
    work: (transaction: IDBTransaction) => Promise<T> | T,
): Promise<T> {
    let transaction: IDBTransaction
    try {
        transaction = db.transaction([...stores], mode)
    } catch (cause) {
        throw failureFrom(cause)
    }

    const settled = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => {
            resolve()
        }
        transaction.onabort = () => {
            reject(failureFrom(transaction.error))
        }
        transaction.onerror = () => {
            reject(failureFrom(transaction.error))
        }
    })

    let result: T
    try {
        result = await work(transaction)
    } catch (cause) {
        settled.catch(() => undefined)
        try {
            transaction.abort()
        } catch {
            /* already finishing on its own */
        }
        throw failureFrom(cause)
    }

    await settled
    return result
}

export function request<T>(source: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        source.onsuccess = () => {
            resolve(source.result)
        }
        source.onerror = () => {
            reject(failureFrom(source.error))
        }
    })
}

export function failureFrom(cause: unknown): StorageError {
    if (cause instanceof StorageError) return cause

    const name = cause instanceof Error ? cause.name : ''
    const detail = cause instanceof Error ? cause.message : String(cause)

    if (name === 'QuotaExceededError') return new StorageError('quota', detail)
    if (name === 'VersionError') return new StorageError('version', detail)

    return new StorageError('aborted', detail || 'the transaction did not complete')
}
