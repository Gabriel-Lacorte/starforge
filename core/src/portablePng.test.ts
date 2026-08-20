import { describe, expect, it } from 'vitest'
import layeredRaw from './fixtures/snapshots/layered-v1.json?raw'
import { decodeProject, encodeProject, type Sha256Digest } from './projectFile'
import {
    PORTABLE_PNG_LIMITS,
    PortablePngError,
    embedProjectInPng,
    extractProjectFromPng,
    validatePng,
    type PortablePngErrorCode,
} from './portablePng'
import { decodeSprite } from './serial'

describe('portable project PNG', () => {
    it('round-trips the canonical project without changing the visual PNG', async () => {
        const source = fixturePng()
        const project = await projectBytes()
        const portable = await embedProjectInPng(source, project, sha256)
        const extracted = await extractProjectFromPng(portable, sha256)
        const original = await decodeProject(project, sha256)

        expect(extracted).not.toBeNull()
        expect(extracted).toEqual(project)
        const decoded = await decodeProject(extracted!, sha256)
        expect(decoded.sprite).toEqual(decodeSprite(JSON.parse(layeredRaw) as unknown))
        expect(decoded.logicalHash).toBe(original.logicalHash)
        expect(removeChunk(portable, 'sfPR')).toEqual(source)
        expect(() => validatePng(removeChunk(portable, 'sfPR'))).not.toThrow()
        await expect(
            extractProjectFromPng(removeChunk(portable, 'sfPR'), sha256),
        ).resolves.toBeNull()
    })

    it('writes sfPR immediately after the last IDAT and reads later ancillary chunks', async () => {
        const source = fixturePng([
            ['IDAT', Uint8Array.of(120, 156, 99, 96, 0)],
            ['IDAT', Uint8Array.of(2, 0, 0, 5, 0, 1)],
            ['aaAA', Uint8Array.of(3, 4)],
        ])
        const portable = await embedProjectInPng(source, await projectBytes(), sha256)

        expect(chunkTypes(portable)).toEqual(['IHDR', 'IDAT', 'IDAT', 'sfPR', 'aaAA', 'IEND'])
        await expect(extractProjectFromPng(portable, sha256)).resolves.not.toBeNull()
    })

    it('rejects duplicate sfPR chunks', async () => {
        const portable = await embedProjectInPng(fixturePng(), await projectBytes(), sha256)
        const duplicate = duplicateChunk(portable, 'sfPR')

        await expectPortableError(extractProjectFromPng(duplicate, sha256), 'FORMAT')
    })

    it('validates every chunk CRC before inspecting private data', async () => {
        const portable = await embedProjectInPng(fixturePng(), await projectBytes(), sha256)
        const corrupted = portable.slice()
        const idat = findChunk(corrupted, 'IDAT')
        corrupted[idat.dataOffset] = corrupted[idat.dataOffset]! ^ 0xff

        await expectPortableError(extractProjectFromPng(corrupted, sha256), 'CHECKSUM')
    })

    it('rejects a tampered payload even when its PNG CRC is valid', async () => {
        const portable = await embedProjectInPng(fixturePng(), await projectBytes(), sha256)
        const sfpr = findChunk(portable, 'sfPR')
        const data = portable.slice(sfpr.dataOffset, sfpr.crcOffset)
        data[data.length - 1] = data[data.length - 1]! ^ 1
        const tampered = replaceChunk(portable, sfpr, pngChunk('sfPR', data))

        await expectPortableError(extractProjectFromPng(tampered, sha256), 'CHECKSUM')
    })

    it('rejects unsupported payload versions and encodings', async () => {
        const portable = await embedProjectInPng(fixturePng(), await projectBytes(), sha256)
        const sfpr = findChunk(portable, 'sfPR')
        const original = portable.slice(sfpr.dataOffset, sfpr.crcOffset)

        const future = original.slice()
        future[8] = 2
        await expectPortableError(
            extractProjectFromPng(replaceChunk(portable, sfpr, pngChunk('sfPR', future)), sha256),
            'VERSION',
        )

        const unknownEncoding = original.slice()
        unknownEncoding[9] = 2
        await expectPortableError(
            extractProjectFromPng(
                replaceChunk(portable, sfpr, pngChunk('sfPR', unknownEncoding)),
                sha256,
            ),
            'VERSION',
        )
    })

    it('rejects truncation, missing IEND and a chunk length over the limit', async () => {
        const source = fixturePng()

        await expectPortableError(
            extractProjectFromPng(source.subarray(0, source.length - 1), sha256),
            'CORRUPTION',
        )
        const iend = findChunk(source, 'IEND')
        await expectPortableError(
            extractProjectFromPng(source.subarray(0, iend.offset), sha256),
            'FORMAT',
        )

        const declaredOversize = concat(
            PNG_SIGNATURE,
            u32(PORTABLE_PNG_LIMITS.maxChunkBytes + 1),
            ascii('aaAA'),
            u32(0),
        )
        await expectPortableError(extractProjectFromPng(declaredOversize, sha256), 'LIMIT')
    })

    it('rejects an excessive declared payload before hashing it', async () => {
        const portable = await embedProjectInPng(fixturePng(), await projectBytes(), sha256)
        const sfpr = findChunk(portable, 'sfPR')
        const data = portable.slice(sfpr.dataOffset, sfpr.crcOffset)
        data.set(u32(PORTABLE_PNG_LIMITS.maxDecodedPayloadBytes + 1), 10)

        await expectPortableError(
            extractProjectFromPng(replaceChunk(portable, sfpr, pngChunk('sfPR', data)), sha256),
            'LIMIT',
        )
    })

    it('checks the total PNG limit before parsing', async () => {
        const oversized = new Uint8Array(PORTABLE_PNG_LIMITS.maxPngBytes + 1)
        await expectPortableError(extractProjectFromPng(oversized, sha256), 'LIMIT')
    })
})

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)

function fixturePng(
    middle: readonly (readonly [string, Uint8Array])[] = [
        ['IDAT', Uint8Array.of(120, 156, 99, 96, 0, 2, 0, 0, 5, 0, 1)],
    ],
): Uint8Array<ArrayBuffer> {
    const ihdr = Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0)
    return concat(
        PNG_SIGNATURE,
        pngChunk('IHDR', ihdr),
        ...middle.map(([type, data]) => pngChunk(type, data)),
        pngChunk('IEND', new Uint8Array()),
    )
}

async function projectBytes(): Promise<Uint8Array<ArrayBuffer>> {
    const sprite = decodeSprite(JSON.parse(layeredRaw) as unknown)
    return encodeProject(
        {
            sprite,
            workspace: {
                activeLayerId: sprite.layers[0]!.id,
                activeFrameId: sprite.frames.at(-1)!.id,
            },
            appVersion: '0.1.0',
        },
        sha256,
    )
}

interface LocatedChunk {
    readonly offset: number
    readonly dataOffset: number
    readonly crcOffset: number
    readonly end: number
}

function findChunk(bytes: Uint8Array, wanted: string): LocatedChunk {
    let offset = PNG_SIGNATURE.length
    while (offset < bytes.length) {
        const length = readU32(bytes, offset)
        const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
        const located = {
            offset,
            dataOffset: offset + 8,
            crcOffset: offset + 8 + length,
            end: offset + 12 + length,
        }
        if (type === wanted) return located
        offset = located.end
    }
    throw new Error(`missing ${wanted} test chunk`)
}

function chunkTypes(bytes: Uint8Array): string[] {
    const types: string[] = []
    let offset = PNG_SIGNATURE.length
    while (offset < bytes.length) {
        const length = readU32(bytes, offset)
        types.push(String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)))
        offset += 12 + length
    }
    return types
}

function removeChunk(bytes: Uint8Array, type: string): Uint8Array<ArrayBuffer> {
    const chunk = findChunk(bytes, type)
    return concat(bytes.subarray(0, chunk.offset), bytes.subarray(chunk.end))
}

function duplicateChunk(bytes: Uint8Array, type: string): Uint8Array<ArrayBuffer> {
    const chunk = findChunk(bytes, type)
    return concat(
        bytes.subarray(0, chunk.end),
        bytes.subarray(chunk.offset, chunk.end),
        bytes.subarray(chunk.end),
    )
}

function replaceChunk(
    bytes: Uint8Array,
    chunk: LocatedChunk,
    replacement: Uint8Array,
): Uint8Array<ArrayBuffer> {
    return concat(bytes.subarray(0, chunk.offset), replacement, bytes.subarray(chunk.end))
}

function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
    const typeBytes = ascii(type)
    return concat(u32(data.length), typeBytes, data, u32(crc32(concat(typeBytes, data))))
}

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff
    for (const byte of bytes) {
        crc ^= byte
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
        }
    }
    return (crc ^ 0xffffffff) >>> 0
}

function readU32(bytes: Uint8Array, offset: number): number {
    return (
        ((bytes[offset]! << 24) |
            (bytes[offset + 1]! << 16) |
            (bytes[offset + 2]! << 8) |
            bytes[offset + 3]!) >>>
        0
    )
}

function u32(value: number): Uint8Array<ArrayBuffer> {
    return Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value)
}

function ascii(value: string): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(value, (character) => character.charCodeAt(0))
}

function concat(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
    const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of parts) {
        output.set(part, offset)
        offset += part.length
    }
    return output
}

async function expectPortableError(
    promise: Promise<unknown>,
    code: PortablePngErrorCode,
): Promise<void> {
    try {
        await promise
        throw new Error('expected a PortablePngError')
    } catch (error) {
        expect(error).toBeInstanceOf(PortablePngError)
        expect((error as PortablePngError).code).toBe(code)
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
