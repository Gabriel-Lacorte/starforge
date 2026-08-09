import {
    BLEND_MODES,
    SPRITE_MAX_SIZE,
    SPRITE_MIN_SIZE,
    createFrame,
    createLayer,
    type BlendMode,
    type Sprite,
} from './doc'
import { normalizeLayerName } from './layers'

export const SNAPSHOT_VERSION = 1

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
    const root = asObject(value, 'snapshot')
    if (root.v !== SNAPSHOT_VERSION) fail(`unsupported version: ${JSON.stringify(root.v)}`)

    const width = asInt(root.width, 'width', SPRITE_MIN_SIZE, SPRITE_MAX_SIZE)
    const height = asInt(root.height, 'height', SPRITE_MIN_SIZE, SPRITE_MAX_SIZE)

    const frames = asArray(root.frames, 'frames').map((raw) => {
        const frame = asObject(raw, 'frame')
        return createFrame(
            asInt(frame.duration, 'frame duration', 1, 60_000),
            asString(frame.id, 'frame id'),
        )
    })
    if (frames.length === 0) fail('no frames')
    const frameIds = new Set(frames.map((frame) => frame.id))
    if (frameIds.size !== frames.length) fail('duplicate frame id')

    const celBytes = width * height * 4
    const layers = asArray(root.layers, 'layers').map((raw) => {
        const source = asObject(raw, 'layer')

        const layer = createLayer(
            normalizeLayerName(asString(source.name, 'layer name')),
            asString(source.id, 'layer id'),
        )

        layer.opacity = asInt(source.opacity, 'layer opacity', 0, 255)
        layer.blendMode = asBlendMode(source.blendMode)
        layer.visible = asBoolean(source.visible, 'layer visible')
        layer.locked = asBoolean(source.locked, 'layer locked')

        for (const rawCel of asArray(source.cels, 'cels')) {
            const cel = asObject(rawCel, 'cel')
            const frame = asString(cel.frame, 'cel frame')
            if (!frameIds.has(frame)) fail(`cel on unknown frame: ${frame}`)

            layer.cels.set(frame, {
                x: asInt(cel.x, 'cel x', -SPRITE_MAX_SIZE, SPRITE_MAX_SIZE),
                y: asInt(cel.y, 'cel y', -SPRITE_MAX_SIZE, SPRITE_MAX_SIZE),
                pixels: decodePixels(asString(cel.pixels, 'cel pixels'), celBytes),
                version: 0,
            })
        }

        return layer
    })
    if (layers.length === 0) fail('no layers')
    if (new Set(layers.map((layer) => layer.id)).size !== layers.length) fail('duplicate layer id')

    const palette = asObject(root.palette, 'palette')
    const meta = asObject(root.meta, 'meta')

    return {
        id: asString(root.id, 'id'),

        width,
        height,

        layers,
        frames,

        palette: {
            name: asString(palette.name, 'palette name'),
            colors: asArray(palette.colors, 'palette colors').map((color) =>
                asString(color, 'palette color'),
            ),
        },

        meta: {
            title: asString(meta.title, 'meta title'),
            createdAt: asString(meta.createdAt, 'meta createdAt'),
            updatedAt: asString(meta.updatedAt, 'meta updatedAt'),
        },
        revision: 0,
    }
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
        let shift = 0
        for (;;) {
            if (at >= bytes.length) fail('truncated run length')
            const byte = bytes[at++]!
            run |= (byte & 0x7f) << shift
            if ((byte & 0x80) === 0) break
            shift += 7
            if (shift > 28) fail('run length overflow')
        }
        if (run <= 0) fail('empty run')
        if (at + 4 > bytes.length) fail('truncated run')

        const r = bytes[at++]!
        const g = bytes[at++]!
        const b = bytes[at++]!
        const a = bytes[at++]!
        if (out + run * 4 > byteLength) fail('run overflows the cel')

        for (let k = 0; k < run; k++) {
            pixels[out++] = r
            pixels[out++] = g
            pixels[out++] = b
            pixels[out++] = a
        }
    }

    if (out !== byteLength) fail('cel is the wrong size')
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

function fromBase64(text: string): Uint8Array {
    let end = text.length
    while (end > 0 && text[end - 1] === '=') end--
    if (end % 4 === 1) fail('base64 length')

    const bytes = new Uint8Array((end * 3) >> 2)
    let out = 0
    let acc = 0
    let bits = 0

    for (let i = 0; i < end; i++) {
        const code = text.charCodeAt(i)
        const value = code < 128 ? B64_REVERSE[code]! : -1
        if (value < 0) fail(`base64 character: ${JSON.stringify(text[i])}`)

        acc = (acc << 6) | value
        bits += 6
        if (bits >= 8) {
            bits -= 8
            bytes[out++] = (acc >>> bits) & 0xff
        }
    }

    return bytes
}

function fail(what: string): never {
    throw new Error(`invalid sprite snapshot: ${what}`)
}

function asObject(value: unknown, what: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        fail(`${what} is not an object`)
    return value as Record<string, unknown>
}

function asArray(value: unknown, what: string): unknown[] {
    if (!Array.isArray(value)) fail(`${what} is not an array`)
    return value as unknown[]
}

function asString(value: unknown, what: string): string {
    if (typeof value !== 'string') fail(`${what} is not a string`)
    return value
}

function asBoolean(value: unknown, what: string): boolean {
    if (typeof value !== 'boolean') fail(`${what} is not a boolean`)
    return value
}

function asInt(value: unknown, what: string, low: number, high: number): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > high) {
        fail(`${what} is not an integer in ${low}..${high}`)
    }
    return value
}

function asBlendMode(value: unknown): BlendMode {
    const mode = asString(value, 'layer blendMode')
    if (!(BLEND_MODES as readonly string[]).includes(mode)) fail(`blend mode: ${mode}`)
    return mode as BlendMode
}
