import { describe, expect, it } from 'vitest'
import alphaRaw from './fixtures/snapshots/alpha-rle-v1.json?raw'
import emptyRaw from './fixtures/snapshots/empty-v1.json?raw'
import layeredRaw from './fixtures/snapshots/layered-v1.json?raw'
import {
    PROJECT_FILE_LIMITS,
    ProjectFileError,
    decodeProject,
    encodeProject,
    type ProjectFileErrorCode,
    type ProjectWorkspace,
    type Sha256Digest,
} from './projectFile'
import { decodeSprite } from './serial'

const FIXTURES = [
    ['empty', emptyRaw],
    ['layered and multi-frame', layeredRaw],
    ['alpha-heavy RLE', alphaRaw],
] as const

describe('Starforge project files', () => {
    it.each(FIXTURES)('round-trips the %s snapshot', async (_name, raw) => {
        const sprite = decodeSprite(JSON.parse(raw) as unknown)
        const workspace = currentWorkspace(sprite)
        const bytes = await encodeProject({ sprite, workspace, appVersion: '0.1.0' }, sha256)
        const decoded = await decodeProject(bytes, sha256)

        expect(decoded.sprite).toEqual(sprite)
        expect(decoded.workspace).toEqual(workspace)
        expect(decoded.logicalHash).toMatch(/^sha256-[0-9a-f]{64}$/)
        expect(decoded.createdWithVersion).toBe('0.1.0')
    })

    it('keeps the logical hash stable across creator versions and re-export', async () => {
        const sprite = decodeSprite(JSON.parse(layeredRaw) as unknown)
        const workspace = currentWorkspace(sprite)
        const first = await encodeProject({ sprite, workspace, appVersion: '0.1.0' }, sha256)
        const second = await encodeProject({ sprite, workspace, appVersion: '0.2.0' }, sha256)

        const firstDecoded = await decodeProject(first, sha256)
        const secondDecoded = await decodeProject(second, sha256)
        const reexported = await encodeProject(
            {
                sprite: firstDecoded.sprite,
                workspace: firstDecoded.workspace,
                appVersion: '0.3.0',
            },
            sha256,
        )

        expect(firstDecoded.logicalHash).toBe(secondDecoded.logicalHash)
        expect((await decodeProject(reexported, sha256)).logicalHash).toBe(firstDecoded.logicalHash)
        expect(second).not.toEqual(first)
    })

    it('preserves Unicode metadata as canonical UTF-8', async () => {
        const sprite = decodeSprite(JSON.parse(emptyRaw) as unknown)
        sprite.meta.title = 'forja α céu'
        const workspace = currentWorkspace(sprite)

        const decoded = await decodeProject(
            await encodeProject({ sprite, workspace, appVersion: 'versão-α' }, sha256),
            sha256,
        )

        expect(decoded.sprite.meta.title).toBe('forja α céu')
        expect(decoded.createdWithVersion).toBe('versão-α')
    })

    it('uses deterministic active target fallbacks', async () => {
        const sprite = decodeSprite(JSON.parse(layeredRaw) as unknown)
        const bytes = await encodeProject(
            {
                sprite,
                workspace: { activeLayerId: 'missing-layer', activeFrameId: 'missing-frame' },
                appVersion: '0.1.0',
            },
            sha256,
        )

        expect((await decodeProject(bytes, sha256)).workspace).toEqual({
            activeLayerId: sprite.layers.at(-1)!.id,
            activeFrameId: sprite.frames[0]!.id,
        })
    })

    it('rejects tampering before constructing a Sprite', async () => {
        const envelope = await envelopeFrom(layeredRaw)
        ;(envelope.snapshot as { meta: { title: string } }).meta.title = 'tampered'

        await expectProjectError(decodeProject(jsonBytes(envelope), sha256), 'CHECKSUM')
    })

    it('rejects truncated JSON and invalid UTF-8', async () => {
        const bytes = await projectBytes(emptyRaw)

        await expectProjectError(
            decodeProject(bytes.subarray(0, bytes.length - 7), sha256),
            'FORMAT',
        )
        await expectProjectError(decodeProject(new Uint8Array([0xff]), sha256), 'CORRUPTION')
    })

    it('rejects duplicate JSON fields instead of accepting the last value', async () => {
        const text = bytesText(await projectBytes(emptyRaw)).replace(
            '"format":"starforge-project"',
            '"format":"starforge-project","format":"starforge-project"',
        )

        await expectProjectError(decodeProject(jsonBytes(text), sha256), 'FORMAT')
    })

    it('rejects future container and snapshot versions', async () => {
        const futureContainer = await envelopeFrom(emptyRaw)
        futureContainer.containerVersion = 2
        await expectProjectError(decodeProject(jsonBytes(futureContainer), sha256), 'VERSION')

        const futureSnapshot = await envelopeFrom(emptyRaw)
        futureSnapshot.snapshotVersion = 2
        await expectProjectError(decodeProject(jsonBytes(futureSnapshot), sha256), 'VERSION')
    })

    it('rejects unknown envelope and snapshot fields', async () => {
        const unknownEnvelope = await envelopeFrom(emptyRaw)
        unknownEnvelope.extra = true
        await expectProjectError(decodeProject(jsonBytes(unknownEnvelope), sha256), 'FORMAT')

        const unknownSnapshot = await envelopeFrom(emptyRaw)
        ;(unknownSnapshot.snapshot as Record<string, unknown>).extra = true
        await resign(unknownSnapshot)
        await expectProjectError(decodeProject(jsonBytes(unknownSnapshot), sha256), 'FORMAT')
    })

    it('rejects malformed hashes and invalid digest providers', async () => {
        const malformed = await envelopeFrom(emptyRaw)
        malformed.payloadSha256 = 'sha256-nope'
        await expectProjectError(decodeProject(jsonBytes(malformed), sha256), 'FORMAT')

        const badDigest: Sha256Digest = () => Promise.resolve(new Uint8Array(31))
        await expectProjectError(projectBytes(emptyRaw, badDigest), 'CORRUPTION')
    })

    it('rejects the file byte limit before parsing', async () => {
        const oversized = new Uint8Array(PROJECT_FILE_LIMITS.maxBytes + 1)
        await expectProjectError(decodeProject(oversized, sha256), 'LIMIT')
    })
})

function currentWorkspace(sprite: ReturnType<typeof decodeSprite>): ProjectWorkspace {
    return {
        activeLayerId: sprite.layers[0]!.id,
        activeFrameId: sprite.frames.at(-1)!.id,
    }
}

async function projectBytes(raw: string, digest: Sha256Digest = sha256): Promise<Uint8Array> {
    const sprite = decodeSprite(JSON.parse(raw) as unknown)
    return encodeProject(
        { sprite, workspace: currentWorkspace(sprite), appVersion: '0.1.0' },
        digest,
    )
}

async function envelopeFrom(raw: string): Promise<Record<string, unknown>> {
    return JSON.parse(bytesText(await projectBytes(raw))) as Record<string, unknown>
}

async function resign(envelope: Record<string, unknown>): Promise<void> {
    const payload = stableJson({
        snapshotVersion: envelope.snapshotVersion,
        snapshot: envelope.snapshot,
        workspace: envelope.workspace,
    })
    envelope.payloadSha256 = `sha256-${hex(await sha256(jsonBytes(payload)))}`
}

async function expectProjectError(
    promise: Promise<unknown>,
    code: ProjectFileErrorCode,
): Promise<void> {
    try {
        await promise
        throw new Error('expected a ProjectFileError')
    } catch (error) {
        expect(error).toBeInstanceOf(ProjectFileError)
        expect((error as ProjectFileError).code).toBe(code)
    }
}

const sha256: Sha256Digest = async (bytes) => {
    const subtle = (
        globalThis as unknown as {
            crypto: { subtle: { digest(name: string, data: Uint8Array): Promise<ArrayBuffer> } }
        }
    ).crypto.subtle
    return new Uint8Array(await subtle.digest('SHA-256', bytes))
}

function jsonBytes(value: unknown): Uint8Array<ArrayBuffer> {
    const text = typeof value === 'string' ? value : stableJson(value)
    const bytes: number[] = []
    for (const character of text) {
        const point = character.codePointAt(0)!
        if (point <= 0x7f) bytes.push(point)
        else if (point <= 0x7ff) bytes.push(0xc0 | (point >>> 6), 0x80 | (point & 0x3f))
        else if (point <= 0xffff) {
            bytes.push(0xe0 | (point >>> 12), 0x80 | ((point >>> 6) & 0x3f), 0x80 | (point & 0x3f))
        } else {
            bytes.push(
                0xf0 | (point >>> 18),
                0x80 | ((point >>> 12) & 0x3f),
                0x80 | ((point >>> 6) & 0x3f),
                0x80 | (point & 0x3f),
            )
        }
    }
    return Uint8Array.from(bytes)
}

function bytesText(bytes: Uint8Array): string {
    let text = ''
    for (const byte of bytes) text += String.fromCharCode(byte)
    return text
}

function stableJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
        .join(',')}}`
}

function hex(bytes: Uint8Array): string {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
