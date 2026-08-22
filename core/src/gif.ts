import { medianCut } from './quantize'

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
    /* palette entries the animation actually needs, ≤ 256 (transparent slot counts) */
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

    /* the global color table, padded to gctSize entries with black */
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

/*
 * Growable byte buffer — avoids the number[] → Uint8Array.from() round-trip and
 * the spread-bomb that hits the engine arg limit on large outputs.
 */
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

    /*
     * A subarray here would alias the whole backing buffer, and any caller
     * reaching for `.buffer` would silently get the unused tail as trailing
     * garbage. Copy exactly what was written.
     */
    result(): Uint8Array<ArrayBuffer> {
        return this.#buf.slice(0, this.#pos)
    }
}

interface PaletteResult {
    rgbFlat: number[]
    paletteCount: number
    transparentIndex: number
    indexFor: Map<number, number> /* rgb24 → palette index */
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
                if (!uniqueRgb.has(rgb)) uniqueRgb.set(rgb, 0)
            }
        }
    }

    const opaqueCount = uniqueRgb.size
    const paletteCount = opaqueCount + (hasTransparency ? 1 : 0)

    /*
     * Past 256 entries the table can't hold every color, so median-cut collapses
     * them to representatives. This branch is the ONLY change from the direct path
     * below: with ≤256 colors nothing here runs and the bytes are untouched.
     */
    if (paletteCount > 256) {
        return quantizedPalette([...uniqueRgb.keys()], hasTransparency)
    }

    /* index 0 is reserved for the transparent slot when transparency is present */
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

function quantizedPalette(colors: number[], hasTransparency: boolean): PaletteResult {
    /* the transparent slot takes one of the 256 entries when it's needed */
    const maxOpaque = 256 - (hasTransparency ? 1 : 0)
    const { palette, map } = medianCut(colors, maxOpaque)

    const transparentIndex = hasTransparency ? 0 : -1
    const offset = hasTransparency ? 1 : 0

    /*
     * Every original color points at its representative's palette index, so
     * mapIndices resolves any pixel with the same lookup as the direct path.
     */
    const indexFor = new Map<number, number>()
    for (const [rgb, slot] of map) indexFor.set(rgb, slot + offset)

    const rgbFlat: number[] = []
    if (hasTransparency) rgbFlat.push(0, 0, 0)
    for (const rep of palette) {
        rgbFlat.push((rep >>> 16) & 0xff, (rep >>> 8) & 0xff, rep & 0xff)
    }

    return { rgbFlat, paletteCount: palette.length + offset, transparentIndex, indexFor }
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

            /*
             * Grow the code size when we've overflowed the current width. The
             * decoder adds entries one emission later, so the encoder bumps one
             * step later (>) while the decoder bumps one step earlier (===).
             * Get this off by one and the file dissolves into confetti.
             */
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
