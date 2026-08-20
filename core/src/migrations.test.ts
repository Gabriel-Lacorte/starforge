import { describe, expect, it } from 'vitest'
import alphaRaw from './fixtures/snapshots/alpha-rle-v1.json?raw'
import emptyRaw from './fixtures/snapshots/empty-v1.json?raw'
import layeredRaw from './fixtures/snapshots/layered-v1.json?raw'
import checksumsRaw from './fixtures/snapshots/SHA256SUMS?raw'
import {
    SnapshotError,
    detectSnapshotVersion,
    migrateSnapshot,
    type SnapshotErrorCode,
} from './migrations'
import { decodeSprite, encodeSprite } from './serial'

const FIXTURES = [
    ['alpha-rle-v1.json', alphaRaw],
    ['empty-v1.json', emptyRaw],
    ['layered-v1.json', layeredRaw],
] as const

describe('snapshot compatibility fixtures', () => {
    it.each(FIXTURES)('opens and round-trips %s', (_name, raw) => {
        const snapshot = JSON.parse(raw) as unknown
        const sprite = decodeSprite(snapshot)

        expect(encodeSprite(sprite)).toEqual(snapshot)
    })

    it('keeps fixture SHA-256 checksums frozen', async () => {
        const expected = new Map(
            checksumsRaw
                .trim()
                .split('\n')
                .map((line) => {
                    const [checksum, name] = line.split(/\s+/)
                    return [name!, checksum!] as const
                }),
        )

        for (const [name, raw] of FIXTURES) {
            expect(await sha256(raw), name).toBe(expected.get(name))
        }
    })
})

describe('snapshot migrations', () => {
    it('detects the version without traversing pixel data', () => {
        const value = {
            v: 1,
            get layers(): never {
                throw new Error('must not inspect layers')
            },
        }

        expect(detectSnapshotVersion(value)).toBe(1)
    })

    it('returns a detached copy when the source already matches the target', () => {
        const source = JSON.parse(layeredRaw) as Record<string, unknown>
        const migrated = migrateSnapshot(source, 1) as Record<string, unknown>

        expect(migrated).toEqual(source)
        expect(migrated).not.toBe(source)
        expect(migrated.layers).not.toBe(source.layers)

        ;(migrated.layers as { name: string }[])[0]!.name = 'Changed'
        expect((source.layers as { name: string }[])[0]!.name).toBe('Base')
    })

    it('rejects a future version with a typed error', () => {
        expectSnapshotError(() => migrateSnapshot({ v: 2 }), 'VERSION')
    })

    it('rejects a missing version with a typed error', () => {
        expectSnapshotError(() => detectSnapshotVersion({}), 'VERSION')
    })

    it('does not invoke a version accessor', () => {
        const value = Object.defineProperty({}, 'v', {
            enumerable: true,
            get: () => {
                throw new Error('must not invoke the version accessor')
            },
        })

        expectSnapshotError(() => detectSnapshotVersion(value), 'FORMAT')
    })

    it('rejects non-JSON values without invoking accessors', () => {
        const value = Object.defineProperty({ v: 1 }, 'payload', {
            enumerable: true,
            get: () => {
                throw new Error('must not invoke accessors')
            },
        })

        expectSnapshotError(() => migrateSnapshot(value), 'FORMAT')
    })
})

function expectSnapshotError(run: () => unknown, code: SnapshotErrorCode): void {
    try {
        run()
        throw new Error('expected a SnapshotError')
    } catch (error) {
        expect(error).toBeInstanceOf(SnapshotError)
        expect((error as SnapshotError).code).toBe(code)
    }
}

async function sha256(text: string): Promise<string> {
    const bytes = Uint8Array.from(text, (character) => character.charCodeAt(0))
    const subtle = (
        globalThis as unknown as {
            crypto: { subtle: { digest(name: string, data: Uint8Array): Promise<ArrayBuffer> } }
        }
    ).crypto.subtle
    const digest = new Uint8Array(await subtle.digest('SHA-256', bytes))
    return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
