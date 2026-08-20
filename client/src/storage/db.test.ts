import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { DOCUMENTS, StorageError, failureFrom, openDatabase, readWrite, request } from './db'

describe('failureFrom', () => {
    it('tells a full disk apart from a database it must not touch', () => {
        const named = (name: string) => Object.assign(new Error('detail'), { name })

        expect(failureFrom(named('QuotaExceededError')).reason).toBe('quota')
        expect(failureFrom(named('VersionError')).reason).toBe('version')
        expect(failureFrom(named('AbortError')).reason).toBe('aborted')
        expect(failureFrom('a bare string').reason).toBe('aborted')
    })

    it('passes a storage failure through rather than wrapping it twice', () => {
        const original = new StorageError('quota', 'full')
        expect(failureFrom(original)).toBe(original)
    })
})

describe('transactions', () => {
    it('resolves only after the write has committed', async () => {
        const factory = new IDBFactory()
        const db = await openDatabase(factory)

        await readWrite(db, [DOCUMENTS], (transaction) =>
            request(transaction.objectStore(DOCUMENTS).put({ id: 'a', updatedAt: 'now' })),
        )

        const reopened = await openDatabase(factory)
        const stored = await new Promise((resolve) => {
            const read = reopened.transaction([DOCUMENTS]).objectStore(DOCUMENTS).get('a')
            read.onsuccess = () => {
                resolve(read.result)
            }
        })
        expect(stored).toMatchObject({ id: 'a' })
        db.close()
        reopened.close()
    })

    it('reports a transaction that could not run, as a storage failure', async () => {
        const db = await openDatabase(new IDBFactory())
        db.close()

        await expect(
            readWrite(db, [DOCUMENTS], (transaction) =>
                request(transaction.objectStore(DOCUMENTS).put({ id: 'a' })),
            ),
        ).rejects.toBeInstanceOf(StorageError)
    })

    it('leaves nothing behind when the work inside a transaction throws', async () => {
        const factory = new IDBFactory()
        const db = await openDatabase(factory)

        await expect(
            readWrite(db, [DOCUMENTS], (transaction) => {
                transaction.objectStore(DOCUMENTS).put({ id: 'half', updatedAt: 'now' })
                throw new Error('changed my mind')
            }),
        ).rejects.toBeInstanceOf(StorageError)

        const stored = await new Promise((resolve) => {
            const read = db.transaction([DOCUMENTS]).objectStore(DOCUMENTS).get('half')
            read.onsuccess = () => {
                resolve(read.result)
            }
        })
        expect(stored).toBeUndefined()
        db.close()
    })
})
