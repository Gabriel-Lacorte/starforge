import {
    BLEND_MODES,
    PALETTE_MAX_COLORS,
    SPRITE_MAX_SIZE,
    SPRITE_MIN_SIZE,
    createFrame,
    createLayer,
    type BlendMode,
    type Sprite,
} from './doc'
import { normalizeLayerName } from './layers'
import {
    CURRENT_SNAPSHOT_VERSION,
    migrateSnapshot,
    snapshotFailure,
    type SnapshotErrorCode,
} from './migrations'

export const SNAPSHOT_VERSION = CURRENT_SNAPSHOT_VERSION

export {
    SnapshotError,
    detectSnapshotVersion,
    migrateSnapshot,
    type SnapshotErrorCode,
} from './migrations'

export const SNAPSHOT_LIMITS = {
    maxFrames: 4_096,
    maxLayers: 256,
    maxCels: 16_384,
    maxPaletteColors: PALETTE_MAX_COLORS,
    maxDecodedPixelBytes: 128 * 1024 * 1024,
    maxIdLength: 256,
    maxLayerNameLength: 256,
    maxPaletteNameLength: 256,
    maxPaletteColorLength: 64,
    maxTitleLength: 4_096,
    maxTimestampLength: 128,
} as const

export interface CelSnapshot {
    frame: string
    x: number
    y: number
    pixels: string
}

export interface LayerSnapshot {
    id: string
    name: string
    opacity: number
    blendMode: string
    visible: boolean
    locked: boolean
    cels: CelSnapshot[]
}

export interface SpriteSnapshot {
    v: number
    id: string

    width: number
    height: number

    palette: { name: string; colors: string[] }
    frames: { id: string; duration: number }[]
    layers: LayerSnapshot[]

    meta: { title: string; createdAt: string; updatedAt: string }
}

export function encodeSprite(sprite: Sprite): SpriteSnapshot {
    return {
        v: SNAPSHOT_VERSION,
        id: sprite.id,

        width: sprite.width,
        height: sprite.height,

        palette: { name: sprite.palette.name, colors: [...sprite.palette.colors] },
        frames: sprite.frames.map((frame) => ({ id: frame.id, duration: frame.duration })),

        layers: sprite.layers.map((layer) => ({
            id: layer.id,
            name: layer.name,
            opacity: layer.opacity,
            blendMode: layer.blendMode,
            visible: layer.visible,
            locked: layer.locked,
            cels: [...layer.cels].map(([frame, cel]) => ({
                frame,
                x: cel.x,
                y: cel.y,
                pixels: encodePixels(cel.pixels),
            })),
        })),

        meta: { ...sprite.meta },
    }
}

export function decodeSprite(value: unknown): Sprite {
    const snapshot = validateSnapshot(migrateSnapshot(value, SNAPSHOT_VERSION))

    const frames = snapshot.frames.map((frame) => createFrame(frame.duration, frame.id))
    const layers = snapshot.layers.map((source) => {
        const layer = createLayer(normalizeLayerName(source.name), source.id)

        layer.opacity = source.opacity
        layer.blendMode = source.blendMode
        layer.visible = source.visible
        layer.locked = source.locked

        for (const cel of source.cels) {
            layer.cels.set(cel.frame, {
                x: cel.x,
                y: cel.y,
                pixels: decodePixels(cel.pixels, snapshot.celBytes),
                version: 0,
            })
        }

        return layer
    })

    return {
        id: snapshot.id,

        width: snapshot.width,
        height: snapshot.height,

        layers,
        frames,

        palette: {
            name: snapshot.palette.name,
            colors: snapshot.palette.colors,
        },

        meta: snapshot.meta,
        revision: 0,
    }
}

interface ValidatedLayerSnapshot extends Omit<LayerSnapshot, 'blendMode'> {
    blendMode: BlendMode
}

interface ValidatedSnapshot extends Omit<SpriteSnapshot, 'layers'> {
    layers: ValidatedLayerSnapshot[]
    celBytes: number
}

function validateSnapshot(value: unknown): ValidatedSnapshot {
    const root = asObject(value, 'snapshot')
    if (root.v !== SNAPSHOT_VERSION) {
        fail('VERSION', `unsupported version after migration: ${JSON.stringify(root.v)}`)
    }

    const width = asInt(root.width, 'width', SPRITE_MIN_SIZE, SPRITE_MAX_SIZE, 'LIMIT')
    const height = asInt(root.height, 'height', SPRITE_MIN_SIZE, SPRITE_MAX_SIZE, 'LIMIT')
    const celBytes = width * height * 4

    const rawFrames = asLimitedArray(root.frames, 'frames', 1, SNAPSHOT_LIMITS.maxFrames)
    const frameIds = new Set<string>()
    const frames = rawFrames.map((raw) => {
        const frame = asObject(raw, 'frame')
        const id = asString(frame.id, 'frame id', SNAPSHOT_LIMITS.maxIdLength, false)
        if (frameIds.has(id)) fail('FORMAT', `duplicate frame id: ${id}`)
        frameIds.add(id)

        return {
            id,
            duration: asInt(frame.duration, 'frame duration', 1, 60_000, 'LIMIT'),
        }
    })

    const rawLayers = asLimitedArray(root.layers, 'layers', 1, SNAPSHOT_LIMITS.maxLayers)
    const layerIds = new Set<string>()
    let totalCels = 0
    let totalDecodedBytes = 0

    const layers = rawLayers.map((raw) => {
        const source = asObject(raw, 'layer')
        const id = asString(source.id, 'layer id', SNAPSHOT_LIMITS.maxIdLength, false)
        if (layerIds.has(id)) fail('FORMAT', `duplicate layer id: ${id}`)
        layerIds.add(id)

        const rawCels = asLimitedArray(source.cels, 'cels', 0, SNAPSHOT_LIMITS.maxCels)
        totalCels += rawCels.length
        if (totalCels > SNAPSHOT_LIMITS.maxCels) fail('LIMIT', 'too many cels')

        totalDecodedBytes += rawCels.length * celBytes
        if (totalDecodedBytes > SNAPSHOT_LIMITS.maxDecodedPixelBytes) {
            fail('LIMIT', 'decoded cel pixels exceed the snapshot limit')
        }

        const celFrames = new Set<string>()
        const cels = rawCels.map((rawCel) => {
            const cel = asObject(rawCel, 'cel')
            const frame = asString(cel.frame, 'cel frame', SNAPSHOT_LIMITS.maxIdLength, false)
            if (!frameIds.has(frame)) fail('FORMAT', `cel on unknown frame: ${frame}`)
            if (celFrames.has(frame)) fail('FORMAT', `duplicate cel on frame: ${frame}`)
            celFrames.add(frame)

            const pixels = asString(cel.pixels, 'cel pixels', maxEncodedCelLength(celBytes), true)
            inspectBase64(pixels, celBytes * 5)

            return {
                frame,
                x: asInt(cel.x, 'cel x', -SPRITE_MAX_SIZE, SPRITE_MAX_SIZE, 'LIMIT'),
                y: asInt(cel.y, 'cel y', -SPRITE_MAX_SIZE, SPRITE_MAX_SIZE, 'LIMIT'),
                pixels,
            }
        })

        return {
            id,
            name: asString(source.name, 'layer name', SNAPSHOT_LIMITS.maxLayerNameLength, true),
            opacity: asInt(source.opacity, 'layer opacity', 0, 255),
            blendMode: asBlendMode(source.blendMode),
            visible: asBoolean(source.visible, 'layer visible'),
            locked: asBoolean(source.locked, 'layer locked'),
            cels,
        }
    })

    const rawPalette = asObject(root.palette, 'palette')
    const paletteColors = asLimitedArray(
        rawPalette.colors,
        'palette colors',
        0,
        SNAPSHOT_LIMITS.maxPaletteColors,
    ).map((color) => asString(color, 'palette color', SNAPSHOT_LIMITS.maxPaletteColorLength, true))
    const rawMeta = asObject(root.meta, 'meta')

    return {
        v: SNAPSHOT_VERSION,
        id: asString(root.id, 'id', SNAPSHOT_LIMITS.maxIdLength, false),
        width,
        height,
        palette: {
            name: asString(
                rawPalette.name,
                'palette name',
                SNAPSHOT_LIMITS.maxPaletteNameLength,
                true,
            ),
            colors: paletteColors,
        },
        frames,
        layers,
        meta: {
            title: asString(rawMeta.title, 'meta title', SNAPSHOT_LIMITS.maxTitleLength, true),
            createdAt: asString(
                rawMeta.createdAt,
                'meta createdAt',
                SNAPSHOT_LIMITS.maxTimestampLength,
                false,
            ),
            updatedAt: asString(
                rawMeta.updatedAt,
                'meta updatedAt',
                SNAPSHOT_LIMITS.maxTimestampLength,
                false,
            ),
        },
        celBytes,
    }
}

function maxEncodedCelLength(celBytes: number): number {
    const pixels = celBytes / 4
    return Math.ceil((pixels * 5) / 3) * 4
}

function encodePixels(pixels: Uint8Array): string {
    const count = pixels.length >>> 2
    const out = new Uint8Array(count * 5)
    let n = 0

    for (let i = 0; i < count;) {
        const o = i << 2
        let run = 1
        while (i + run < count && samePixel(pixels, o, (i + run) << 2)) run++

        for (let left = run; ;) {
            if (left < 0x80) {
                out[n++] = left
                break
            }
            out[n++] = (left & 0x7f) | 0x80
            left >>>= 7
        }

        out[n++] = pixels[o]!
        out[n++] = pixels[o + 1]!
        out[n++] = pixels[o + 2]!
        out[n++] = pixels[o + 3]!
        i += run
    }

    return toBase64(out.subarray(0, n))
}

function decodePixels(text: string, byteLength: number): Uint8Array<ArrayBuffer> {
    const bytes = fromBase64(text)
    const pixels = new Uint8Array(byteLength)

    let at = 0
    let out = 0

    while (at < bytes.length) {
        let run = 0
        let multiplier = 1
        let groups = 0
        for (;;) {
            if (at >= bytes.length) fail('CORRUPTION', 'truncated run length')
            const byte = bytes[at++]!
            const payload = byte & 0x7f
            run += payload * multiplier
            groups++

            if (!Number.isSafeInteger(run) || groups > 5) {
                fail('CORRUPTION', 'run length overflow')
            }
            if ((byte & 0x80) === 0) {
                if (groups > 1 && payload === 0) fail('CORRUPTION', 'non-canonical run length')
                break
            }
            multiplier *= 0x80
        }
        if (run <= 0) fail('CORRUPTION', 'empty run')
        if (at + 4 > bytes.length) fail('CORRUPTION', 'truncated run')
        if (run > (byteLength - out) / 4) fail('CORRUPTION', 'run overflows the cel')

        const r = bytes[at++]!
        const g = bytes[at++]!
        const b = bytes[at++]!
        const a = bytes[at++]!

        for (let k = 0; k < run; k++) {
            pixels[out++] = r
            pixels[out++] = g
            pixels[out++] = b
            pixels[out++] = a
        }
    }

    if (out !== byteLength) fail('CORRUPTION', 'cel is the wrong size')
    return pixels
}

function samePixel(pixels: Uint8Array, a: number, b: number): boolean {
    return (
        pixels[a] === pixels[b] &&
        pixels[a + 1] === pixels[b + 1] &&
        pixels[a + 2] === pixels[b + 2] &&
        pixels[a + 3] === pixels[b + 3]
    )
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const B64_REVERSE = new Int8Array(128).fill(-1)
for (let i = 0; i < B64.length; i++) B64_REVERSE[B64.charCodeAt(i)] = i

function toBase64(bytes: Uint8Array): string {
    let out = ''
    let i = 0

    for (; i + 2 < bytes.length; i += 3) {
        const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
        out += B64[(n >>> 18) & 63]! + B64[(n >>> 12) & 63]! + B64[(n >>> 6) & 63]! + B64[n & 63]!
    }

    const rest = bytes.length - i
    if (rest === 1) {
        const n = bytes[i]! << 16
        out += `${B64[(n >>> 18) & 63]!}${B64[(n >>> 12) & 63]!}==`
    } else if (rest === 2) {
        const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8)
        out += `${B64[(n >>> 18) & 63]!}${B64[(n >>> 12) & 63]!}${B64[(n >>> 6) & 63]!}=`
    }

    return out
}

interface Base64Info {
    decodedLength: number
    padding: number
}

function inspectBase64(text: string, maxDecodedLength: number): Base64Info {
    if (text.length % 4 !== 0) fail('CORRUPTION', 'base64 length')

    let padding = 0
    if (text.endsWith('==')) padding = 2
    else if (text.endsWith('=')) padding = 1

    const end = text.length - padding
    for (let i = 0; i < end; i++) {
        const code = text.charCodeAt(i)
        if (code >= B64_REVERSE.length || B64_REVERSE[code] === -1) {
            fail('CORRUPTION', `base64 character: ${JSON.stringify(text[i])}`)
        }
    }
    for (let i = end; i < text.length; i++) {
        if (text[i] !== '=') fail('CORRUPTION', 'base64 padding')
    }

    if (padding === 2 && end > 0) {
        const value = B64_REVERSE[text.charCodeAt(end - 1)]!
        if ((value & 0x0f) !== 0) fail('CORRUPTION', 'base64 has non-zero padding bits')
    } else if (padding === 1 && end > 0) {
        const value = B64_REVERSE[text.charCodeAt(end - 1)]!
        if ((value & 0x03) !== 0) fail('CORRUPTION', 'base64 has non-zero padding bits')
    }

    const decodedLength = (text.length / 4) * 3 - padding
    if (decodedLength > maxDecodedLength) fail('LIMIT', 'encoded cel exceeds the snapshot limit')

    return { decodedLength, padding }
}

function fromBase64(text: string): Uint8Array {
    const { decodedLength } = inspectBase64(text, Number.MAX_SAFE_INTEGER)
    const bytes = new Uint8Array(decodedLength)
    let out = 0

    for (let i = 0; i < text.length; i += 4) {
        const a = B64_REVERSE[text.charCodeAt(i)]!
        const b = B64_REVERSE[text.charCodeAt(i + 1)]!
        const c = text[i + 2] === '=' ? 0 : B64_REVERSE[text.charCodeAt(i + 2)]!
        const d = text[i + 3] === '=' ? 0 : B64_REVERSE[text.charCodeAt(i + 3)]!
        const packed = (a << 18) | (b << 12) | (c << 6) | d

        if (out < decodedLength) bytes[out++] = (packed >>> 16) & 0xff
        if (out < decodedLength) bytes[out++] = (packed >>> 8) & 0xff
        if (out < decodedLength) bytes[out++] = packed & 0xff
    }

    return bytes
}

function fail(code: SnapshotErrorCode, what: string): never {
    snapshotFailure(code, what)
}

function asObject(value: unknown, what: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        fail('FORMAT', `${what} is not an object`)
    }

    const prototype: unknown = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
        fail('FORMAT', `${what} has an unsupported prototype`)
    }

    return value as Record<string, unknown>
}

function asLimitedArray(value: unknown, what: string, minimum: number, maximum: number): unknown[] {
    if (!Array.isArray(value)) fail('FORMAT', `${what} is not an array`)

    if (value.length < minimum) {
        fail('FORMAT', minimum === 1 ? `no ${what}` : `${what} must contain ${minimum} items`)
    }
    if (value.length > maximum) fail('LIMIT', `${what} exceeds the limit of ${maximum}`)

    return value
}

function asString(value: unknown, what: string, maximum: number, allowEmpty: boolean): string {
    if (typeof value !== 'string') fail('FORMAT', `${what} is not a string`)
    if (!allowEmpty && value.length === 0) fail('FORMAT', `${what} is empty`)

    if (utf8ByteLength(value, maximum) > maximum) {
        fail('LIMIT', `${what} exceeds the byte limit of ${maximum}`)
    }

    return value
}

function utf8ByteLength(value: string, stopAfter: number): number {
    let bytes = 0

    for (let index = 0; index < value.length; index++) {
        const unit = value.charCodeAt(index)

        if (unit <= 0x7f) bytes++
        else if (unit <= 0x7ff) bytes += 2
        else if (unit >= 0xd800 && unit <= 0xdbff) {
            const next = value.charCodeAt(index + 1)
            if (next >= 0xdc00 && next <= 0xdfff) {
                bytes += 4
                index++
            } else {
                bytes += 3
            }
        } else bytes += 3

        if (bytes > stopAfter) return bytes
    }

    return bytes
}

function asBoolean(value: unknown, what: string): boolean {
    if (typeof value !== 'boolean') fail('FORMAT', `${what} is not a boolean`)
    return value
}

function asInt(
    value: unknown,
    what: string,
    low: number,
    high: number,
    code: SnapshotErrorCode = 'FORMAT',
): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > high) {
        fail(code, `${what} is not an integer in ${low}..${high}`)
    }
    return value
}

function asBlendMode(value: unknown): BlendMode {
    const mode = asString(value, 'layer blendMode', 32, false)
    if (!(BLEND_MODES as readonly string[]).includes(mode)) fail('FORMAT', `blend mode: ${mode}`)
    return mode as BlendMode
}
