import type { Sha256Digest } from './projectFile'

export const PORTABLE_PNG_LIMITS = {
    maxPngBytes: 96 * 1024 * 1024,
    maxChunkBytes: 64 * 1024 * 1024,
    maxStoredPayloadBytes: 64 * 1024 * 1024,
    maxDecodedPayloadBytes: 128 * 1024 * 1024,
    maxChunks: 4_096,
} as const

export type PortablePngErrorCode = 'FORMAT' | 'VERSION' | 'LIMIT' | 'CHECKSUM' | 'CORRUPTION'

export class PortablePngError extends Error {
    readonly code: PortablePngErrorCode

    constructor(code: PortablePngErrorCode, detail: string) {
        super(`invalid portable PNG [${code.toLowerCase()}]: ${detail}`)
        this.name = 'PortablePngError'
        this.code = code
    }
}

interface PngChunk {
    readonly type: string
    readonly offset: number
    readonly dataOffset: number
    readonly dataLength: number
    readonly crcOffset: number
    readonly end: number
}

interface ParsedPng {
    readonly chunks: readonly PngChunk[]
    readonly lastIdatEnd: number
    readonly projectChunk: PngChunk | null
}

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
const PROJECT_CHUNK = 'sfPR'
const PROJECT_MAGIC = ascii('STARFORG')
const PROJECT_PAYLOAD_VERSION = 1
const PROJECT_ENCODING_JSON = 0
const PROJECT_HEADER_BYTES = 8 + 1 + 1 + 4 + 32

export function validatePng(bytes: Uint8Array): void {
    parsePng(bytes)
}

export async function embedProjectInPng(
    png: Uint8Array,
    project: Uint8Array,
    digest: Sha256Digest,
): Promise<Uint8Array<ArrayBuffer>> {
    const parsed = parsePng(png)
    if (parsed.projectChunk) portableFailure('FORMAT', 'PNG already contains editable project data')
    if (project.length > PORTABLE_PNG_LIMITS.maxStoredPayloadBytes - PROJECT_HEADER_BYTES) {
        portableFailure('LIMIT', 'project exceeds the portable payload limit')
    }

    const projectBytes = Uint8Array.from(project)
    const hash = await checkedDigest(digest, projectBytes)
    const payload = concat(
        PROJECT_MAGIC,
        Uint8Array.of(PROJECT_PAYLOAD_VERSION, PROJECT_ENCODING_JSON),
        u32(projectBytes.length),
        hash,
        projectBytes,
    )
    const chunk = encodeChunk(PROJECT_CHUNK, payload)
    const outputLength = png.length + chunk.length
    if (outputLength > PORTABLE_PNG_LIMITS.maxPngBytes) {
        portableFailure('LIMIT', 'portable PNG exceeds the 96 MiB file limit')
    }

    return concat(png.subarray(0, parsed.lastIdatEnd), chunk, png.subarray(parsed.lastIdatEnd))
}

export async function extractProjectFromPng(
    png: Uint8Array,
    digest: Sha256Digest,
): Promise<Uint8Array<ArrayBuffer> | null> {
    const parsed = parsePng(png)
    const chunk = parsed.projectChunk
    if (!chunk) return null

    const data = png.subarray(chunk.dataOffset, chunk.crcOffset)
    if (data.length < PROJECT_HEADER_BYTES) {
        portableFailure('CORRUPTION', 'sfPR payload is truncated')
    }
    if (!equalBytes(data.subarray(0, PROJECT_MAGIC.length), PROJECT_MAGIC)) {
        portableFailure('FORMAT', 'sfPR payload has an unknown signature')
    }
    if (data[8] !== PROJECT_PAYLOAD_VERSION) {
        portableFailure('VERSION', `unsupported sfPR payload version: ${String(data[8])}`)
    }
    if (data[9] !== PROJECT_ENCODING_JSON) {
        portableFailure('VERSION', `unsupported sfPR payload encoding: ${String(data[9])}`)
    }

    const declaredLength = readU32(data, 10)
    if (declaredLength > PORTABLE_PNG_LIMITS.maxDecodedPayloadBytes) {
        portableFailure('LIMIT', 'decoded sfPR payload exceeds the 128 MiB limit')
    }
    const body = data.subarray(PROJECT_HEADER_BYTES)
    if (body.length !== declaredLength) {
        portableFailure('CORRUPTION', 'sfPR payload length does not match its declaration')
    }

    const project = Uint8Array.from(body)
    const expectedHash = data.subarray(14, PROJECT_HEADER_BYTES)
    const actualHash = await checkedDigest(digest, project)
    if (!equalBytes(actualHash, expectedHash)) {
        portableFailure('CHECKSUM', 'sfPR payload checksum does not match')
    }

    return project
}

function parsePng(bytes: Uint8Array): ParsedPng {
    if (bytes.length > PORTABLE_PNG_LIMITS.maxPngBytes) {
        portableFailure('LIMIT', 'portable PNG exceeds the 96 MiB file limit')
    }
    if (bytes.length < PNG_SIGNATURE.length || !equalBytes(bytes.subarray(0, 8), PNG_SIGNATURE)) {
        portableFailure('FORMAT', 'PNG signature is missing')
    }

    const chunks: PngChunk[] = []
    let offset = PNG_SIGNATURE.length
    let sawIhdr = false
    let sawIdat = false
    let idatEnded = false
    let sawIend = false
    let sawPlte = false
    let lastIdatEnd = -1
    let projectChunk: PngChunk | null = null

    while (offset < bytes.length) {
        if (chunks.length >= PORTABLE_PNG_LIMITS.maxChunks) {
            portableFailure('LIMIT', 'PNG contains more than 4,096 chunks')
        }
        if (bytes.length - offset < 12) portableFailure('CORRUPTION', 'PNG chunk is truncated')

        const dataLength = readU32(bytes, offset)
        if (dataLength > PORTABLE_PNG_LIMITS.maxChunkBytes) {
            portableFailure('LIMIT', 'PNG chunk exceeds the 64 MiB limit')
        }
        const dataOffset = offset + 8
        const crcOffset = dataOffset + dataLength
        const end = crcOffset + 4
        if (end > bytes.length) portableFailure('CORRUPTION', 'PNG chunk length exceeds the file')

        const typeBytes = bytes.subarray(offset + 4, dataOffset)
        const type = decodeChunkType(typeBytes)
        const expectedCrc = readU32(bytes, crcOffset)
        const actualCrc = crc32([typeBytes, bytes.subarray(dataOffset, crcOffset)])
        if (actualCrc !== expectedCrc) {
            portableFailure('CHECKSUM', `${type} chunk CRC does not match`)
        }

        const chunk = { type, offset, dataOffset, dataLength, crcOffset, end }
        chunks.push(chunk)

        if (!sawIhdr) {
            if (type !== 'IHDR') portableFailure('FORMAT', 'IHDR must be the first PNG chunk')
            validateIhdr(bytes.subarray(dataOffset, crcOffset))
            sawIhdr = true
        } else if (type === 'IHDR') {
            portableFailure('FORMAT', 'PNG contains more than one IHDR chunk')
        }

        if (type === 'PLTE') {
            if (sawPlte) portableFailure('FORMAT', 'PNG contains more than one PLTE chunk')
            if (sawIdat) portableFailure('FORMAT', 'PLTE appears after IDAT')
            sawPlte = true
        }

        if (type === 'IDAT') {
            if (idatEnded) portableFailure('FORMAT', 'PNG IDAT chunks are not consecutive')
            sawIdat = true
            lastIdatEnd = end
        } else if (sawIdat && type !== 'IEND') {
            idatEnded = true
        }

        if (type === PROJECT_CHUNK) {
            if (!sawIdat) portableFailure('FORMAT', 'sfPR appears before image data')
            if (projectChunk) portableFailure('FORMAT', 'PNG contains more than one sfPR chunk')
            projectChunk = chunk
        }

        if (type === 'IEND') {
            if (!sawIdat) portableFailure('FORMAT', 'PNG has no image data')
            if (dataLength !== 0) portableFailure('FORMAT', 'IEND chunk must be empty')
            if (sawIend) portableFailure('FORMAT', 'PNG contains more than one IEND chunk')
            sawIend = true
            if (end !== bytes.length) portableFailure('FORMAT', 'PNG contains data after IEND')
        }

        offset = end
    }

    if (!sawIhdr) portableFailure('FORMAT', 'PNG has no IHDR chunk')
    if (!sawIdat) portableFailure('FORMAT', 'PNG has no IDAT chunk')
    if (!sawIend) portableFailure('FORMAT', 'PNG has no IEND chunk')

    return { chunks, lastIdatEnd, projectChunk }
}

function validateIhdr(data: Uint8Array): void {
    if (data.length !== 13) portableFailure('FORMAT', 'IHDR chunk must contain 13 bytes')
    if (readU32(data, 0) === 0 || readU32(data, 4) === 0) {
        portableFailure('FORMAT', 'PNG dimensions must be positive')
    }
    const bitDepth = data[8]!
    const colorType = data[9]!
    const validDepth =
        (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth)) ||
        (colorType === 2 && [8, 16].includes(bitDepth)) ||
        (colorType === 3 && [1, 2, 4, 8].includes(bitDepth)) ||
        ((colorType === 4 || colorType === 6) && [8, 16].includes(bitDepth))
    if (!validDepth) portableFailure('FORMAT', 'IHDR bit depth and color type are invalid')
    if (data[10] !== 0 || data[11] !== 0 || (data[12] !== 0 && data[12] !== 1)) {
        portableFailure('FORMAT', 'IHDR uses unsupported PNG methods')
    }
}

function decodeChunkType(bytes: Uint8Array): string {
    if (bytes.length !== 4) portableFailure('CORRUPTION', 'PNG chunk type is truncated')
    for (const byte of bytes) {
        const isLetter = (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122)
        if (!isLetter) portableFailure('FORMAT', 'PNG chunk type is invalid')
    }
    if ((bytes[2]! & 0x20) !== 0) portableFailure('FORMAT', 'PNG reserved chunk bit is invalid')

    const type = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)
    if ((bytes[0]! & 0x20) === 0 && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type)) {
        portableFailure('FORMAT', `PNG contains unsupported critical chunk ${type}`)
    }
    return type
}

function encodeChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
    const typeBytes = ascii(type)
    return concat(u32(data.length), typeBytes, data, u32(crc32([typeBytes, data])))
}

async function checkedDigest(
    digest: Sha256Digest,
    bytes: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
    const result = await digest(bytes)
    if (!(result instanceof Uint8Array) || result.length !== 32) {
        portableFailure('CORRUPTION', 'SHA-256 provider returned an invalid digest')
    }
    return Uint8Array.from(result)
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
    let current = value
    for (let bit = 0; bit < 8; bit++) {
        current = (current >>> 1) ^ (current & 1 ? 0xedb88320 : 0)
    }
    return current >>> 0
})

function crc32(parts: readonly Uint8Array[]): number {
    let value = 0xffffffff
    for (const part of parts) {
        for (const byte of part) value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8)
    }
    return (value ^ 0xffffffff) >>> 0
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
    return Uint8Array.of(
        (value >>> 24) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 8) & 0xff,
        value & 0xff,
    )
}

function ascii(value: string): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(value, (character) => character.charCodeAt(0))
}

function concat(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
    const length = parts.reduce((total, part) => total + part.length, 0)
    const output = new Uint8Array(length)
    let offset = 0
    for (const part of parts) {
        output.set(part, offset)
        offset += part.length
    }
    return output
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
    if (left.length !== right.length) return false
    let difference = 0
    for (let index = 0; index < left.length; index++) difference |= left[index]! ^ right[index]!
    return difference === 0
}

function portableFailure(code: PortablePngErrorCode, detail: string): never {
    throw new PortablePngError(code, detail)
}
