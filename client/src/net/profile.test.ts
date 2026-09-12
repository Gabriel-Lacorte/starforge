import { describe, expect, it } from 'vitest'
import { loadProfile, PROFILE_STORAGE_KEY, saveProfile } from './profile'

type FakeStorage = Pick<Storage, 'getItem' | 'setItem'>

function fakeStorage(initial: Record<string, string> = {}): FakeStorage {
    const data: Record<string, string> = { ...initial }
    return {
        getItem(key: string): string | null {
            return data[key] ?? null
        },
        setItem(key: string, value: string): void {
            data[key] = value
        },
    }
}

describe('room profile', () => {
    it('returns defaults when storage is empty', () => {
        const profile = loadProfile(fakeStorage())
        expect(profile.nickname).toMatch(/^painter-\d{4}$/)
        expect(profile.color).toBe(0xffcc33ff)
    })

    it('round-trips a saved profile', () => {
        const storage = fakeStorage()
        saveProfile({ nickname: 'ada', color: 42 }, storage)
        expect(loadProfile(storage)).toEqual({ nickname: 'ada', color: 42 })
    })

    it('stores under the shared profile key', () => {
        const storage = fakeStorage()
        saveProfile({ nickname: 'ada', color: 42 }, storage)
        expect(storage.getItem(PROFILE_STORAGE_KEY)).toBe(
            JSON.stringify({ nickname: 'ada', color: 42 }),
        )
    })

    it('falls back to defaults on corrupt JSON', () => {
        const profile = loadProfile(fakeStorage({ [PROFILE_STORAGE_KEY]: '{nope' }))
        expect(profile.nickname).toMatch(/^painter-\d{4}$/)
        expect(profile.color).toBe(0xffcc33ff)
    })

    it('does not throw when setItem throws (private-mode storage)', () => {
        const throwing: FakeStorage = {
            getItem: (): string | null => null,
            setItem: (): void => {
                throw new Error('denied')
            },
        }
        expect(() => saveProfile({ nickname: 'ada', color: 42 }, throwing)).not.toThrow()
    })
})
