import { medianCut, type Quantization } from './quantize'

export interface GifFrame {
    pixels: Uint8Array /* RGBA */
    durationMs: number
}

export interface GifOptions {
    loop?: boolean /* default true */
}

export class GifError extends Error {
    readonly code: 'BOUNDS'

    constructor(code: 'BOUNDS', detail: string) {
        super(detail)
        this.name = 'GifError'
        this.code = code
    }
}

export interface GifResult {
    bytes: Uint8Array<ArrayBuffer>
    colorsUsed: number
}

export function encodeGif(
    frames: readonly GifFrame[],
    width: number,
    height: number,
    opts?: GifOptions,
): Uint8Array<ArrayBuffer> {
    return encodeGifWithStats(frames, width, height, opts).bytes
}

export function encodeGifWithStats(
    frames: readonly GifFrame[],
    width: number,
    height: number,
    opts?: GifOptions,
): GifResult {
    const loop = opts?.loop ?? true
    const pixelCount = width * height

    for (const frame of frames) {
        if (frame.pixels.length !== pixelCount * 4) {
            throw new GifError(
                'BOUNDS',
                `frame pixel data length ${frame.pixels.length} does not match ${width}×${height} (expected ${pixelCount * 4} bytes)`,
            )
        }
    }

    const { rgbFlat, paletteCount, transparentIndex, indexFor } = buildPalette(frames)

    /* GCT must be a power of 2, minimum 2 entries */
    const gctSize = nextPow2(Math.max(2, paletteCount))
    /* GCT packed field n where entry count = 2^(n+1), so n = log2(gctSize) - 1 */
    const gctField = Math.log2(gctSize) - 1
    /* LZW min code size matches the bit-width of the GCT */
    const minCodeSize = Math.max(2, Math.log2(gctSize))

    const out = new ByteWriter()

    /* header */
    for (const c of 'GIF89a') out.write(c.charCodeAt(0))

    /* logical screen descriptor */
    out.writeU16LE(width)
    out.writeU16LE(height)
    /* GCT flag | colorResolution=7 | sort=0 | gctField */
    out.write(0x80 | 0x70 | gctField)
    out.write(0) /* background color index */
    out.write(0) /* pixel aspect ratio */

    for (let i = 0; i < gctSize; i++) {
        out.write(rgbFlat[i * 3] ?? 0)
        out.write(rgbFlat[i * 3 + 1] ?? 0)
        out.write(rgbFlat[i * 3 + 2] ?? 0)
    }

    /* NETSCAPE2.0 application extension, required for looping */
    if (loop) {
        out.write(0x21)
        out.write(0xff)
        out.write(0x0b)
        for (const c of 'NETSCAPE2.0') out.write(c.charCodeAt(0))
        out.write(0x03)
        out.write(0x01)
        out.writeU16LE(0) /* 0 = infinite loop */
        out.write(0x00)
    }

    const hasTransparency = transparentIndex !== -1

    for (const frame of frames) {
        const indices = mapIndices(frame.pixels, pixelCount, indexFor, transparentIndex)
        /* browsers treat delays of 0–1 centiseconds as 10cs, enforce a floor of 2cs */
        const delay = Math.max(2, Math.round(frame.durationMs / 10))

        /* graphic control extension */
        out.write(0x21)
        out.write(0xf9)
        out.write(0x04)
        /* disposal=2 (restore to background), transparent flag */
        out.write((2 << 2) | (hasTransparency ? 1 : 0))
        out.writeU16LE(delay)
        out.write(hasTransparency ? transparentIndex : 0)
        out.write(0x00)

        /* image descriptor */
        out.write(0x2c)
        out.writeU16LE(0)
        out.writeU16LE(0)
        out.writeU16LE(width)
        out.writeU16LE(height)
        out.write(0x00) /* no LCT, no interlace */

        /* LZW compressed image data */
        out.write(minCodeSize)
        lzwEncode(indices, minCodeSize, out)
    }

    out.write(0x3b) /* trailer */

    return { bytes: out.result(), colorsUsed: paletteCount }
}

class ByteWriter {
    #buf: Uint8Array
    #pos = 0

    constructor(capacity = 65536) {
        this.#buf = new Uint8Array(capacity)
    }

    write(byte: number): void {
        if (this.#pos === this.#buf.length) this.#grow()
        this.#buf[this.#pos++] = byte & 0xff
    }

    writeU16LE(val: number): void {
        this.write(val)
        this.write(val >>> 8)
    }

    writeBytes(src: Uint8Array): void {
        if (this.#pos + src.length > this.#buf.length) this.#grow(src.length)
        this.#buf.set(src, this.#pos)
        this.#pos += src.length
    }

    #grow(extra = 0): void {
        const next = new Uint8Array(Math.max(this.#buf.length * 2, this.#pos + extra))
        next.set(this.#buf)
        this.#buf = next
    }

    result(): Uint8Array<ArrayBuffer> {
        return this.#buf.slice(0, this.#pos)
    }
}

interface PaletteResult {
    rgbFlat: number[]
    paletteCount: number
    transparentIndex: number
    indexFor: Map<number, number> /* rgb24 -> palette index */
}

function buildPalette(frames: readonly GifFrame[]): PaletteResult {
    const uniqueRgb = new Map<number, number>()
    let hasTransparency = false

    for (const frame of frames) {
        const px = frame.pixels
        for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3]! < 128) {
                hasTransparency = true
            } else {
                const rgb = (px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!
                uniqueRgb.set(rgb, (uniqueRgb.get(rgb) ?? 0) + 1)
            }
        }
    }

    const opaqueCount = uniqueRgb.size
    const paletteCount = opaqueCount + (hasTransparency ? 1 : 0)

    if (paletteCount > 256) {
        return quantizedPalette(uniqueRgb, hasTransparency)
    }

    const transparentIndex = hasTransparency ? 0 : -1
    let nextIdx = hasTransparency ? 1 : 0

    for (const rgb of uniqueRgb.keys()) uniqueRgb.set(rgb, nextIdx++)

    const rgbFlat: number[] = []
    if (hasTransparency) rgbFlat.push(0, 0, 0)
    for (const rgb of uniqueRgb.keys()) {
        rgbFlat.push((rgb >>> 16) & 0xff, (rgb >>> 8) & 0xff, rgb & 0xff)
    }

    return { rgbFlat, paletteCount, transparentIndex, indexFor: uniqueRgb }
}

const PINNED_COLORS = 192

function quantizedPalette(
    population: Map<number, number>,
    hasTransparency: boolean,
): PaletteResult {
    const maxOpaque = 256 - (hasTransparency ? 1 : 0)

    const byPopulation = [...population.entries()].sort((a, b) => b[1] - a[1])
    const pinned = byPopulation.slice(0, Math.min(PINNED_COLORS, byPopulation.length))
    const tail = byPopulation.slice(pinned.length).map(([rgb]) => rgb)
    const slots = Math.max(1, maxOpaque - pinned.length)

    const quantized: Quantization =
        tail.length > 0 ? medianCut(tail, slots) : { palette: [], map: new Map() }

    const transparentIndex = hasTransparency ? 0 : -1
    const offset = hasTransparency ? 1 : 0

    const indexFor = new Map<number, number>()
    const rgbFlat: number[] = []
    if (hasTransparency) rgbFlat.push(0, 0, 0)

    let slot = offset
    for (const [rgb] of pinned) {
        indexFor.set(rgb, slot++)
        rgbFlat.push((rgb >>> 16) & 0xff, (rgb >>> 8) & 0xff, rgb & 0xff)
    }
    for (const [rgb, box] of quantized.map) indexFor.set(rgb, slot + box)
    for (const rep of quantized.palette) {
        rgbFlat.push((rep >>> 16) & 0xff, (rep >>> 8) & 0xff, rep & 0xff)
    }

    return {
        rgbFlat,
        paletteCount: slot + quantized.palette.length,
        transparentIndex,
        indexFor,
    }
}

function mapIndices(
    pixels: Uint8Array,
    pixelCount: number,
    indexFor: Map<number, number>,
    transparentIndex: number,
): Uint8Array<ArrayBuffer> {
    const result = new Uint8Array(pixelCount)
    for (let i = 0; i < pixelCount; i++) {
        const o = i * 4
        if (pixels[o + 3]! < 128) {
            result[i] = transparentIndex >= 0 ? transparentIndex : 0
        } else {
            result[i] = indexFor.get((pixels[o]! << 16) | (pixels[o + 1]! << 8) | pixels[o + 2]!)!
        }
    }
    return result
}

function lzwEncode(indices: Uint8Array, minCodeSize: number, out: ByteWriter): void {
    const clearCode = 1 << minCodeSize
    const eoiCode = clearCode + 1

    let dict = new Map<number, number>() /* (prefix<<8)|sym -> code */
    let nextCode = eoiCode + 1
    let codeSize = minCodeSize + 1

    const bits = new BitPacker(out)
    bits.write(clearCode, codeSize)

    if (indices.length === 0) {
        bits.write(eoiCode, codeSize)
        bits.flush()
        return
    }

    let prefix = indices[0]!

    for (let i = 1; i < indices.length; i++) {
        const sym = indices[i]!
        const key = (prefix << 8) | sym
        const found = dict.get(key)

        if (found !== undefined) {
            prefix = found
        } else {
            bits.write(prefix, codeSize)
            dict.set(key, nextCode++)

            if (codeSize < 12 && nextCode > 1 << codeSize) codeSize++

            if (nextCode > 4095) {
                bits.write(clearCode, codeSize)
                dict = new Map()
                nextCode = eoiCode + 1
                codeSize = minCodeSize + 1
            }

            prefix = sym
        }
    }

    bits.write(prefix, codeSize)
    bits.write(eoiCode, codeSize)
    bits.flush()
}

class BitPacker {
    #pending = 0
    #count = 0
    #block = new Uint8Array(255)
    #blockLen = 0
    readonly #out: ByteWriter

    constructor(out: ByteWriter) {
        this.#out = out
    }

    write(code: number, bits: number): void {
        this.#pending |= code << this.#count
        this.#count += bits
        while (this.#count >= 8) {
            this.#block[this.#blockLen++] = this.#pending & 0xff
            this.#pending >>>= 8
            this.#count -= 8
            if (this.#blockLen === 255) this.#flushBlock()
        }
    }

    #flushBlock(): void {
        this.#out.write(this.#blockLen)
        this.#out.writeBytes(this.#block.subarray(0, this.#blockLen))
        this.#blockLen = 0
    }

    flush(): void {
        if (this.#count > 0) this.#block[this.#blockLen++] = this.#pending & 0xff
        if (this.#blockLen > 0) this.#flushBlock()
        this.#out.write(0x00)
    }
}

function nextPow2(n: number): number {
    let p = 1
    while (p < n) p <<= 1
    return p
}
