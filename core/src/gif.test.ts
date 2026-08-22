import { describe, expect, it } from 'vitest'
import { GifError, encodeGif, type GifFrame } from './gif'

function decodeLzwStream(data: Uint8Array, minCodeSize: number): Uint8Array {
    const bytes: number[] = []
    let pos = 0
    while (pos < data.length) {
        const len = data[pos++]!
        if (len === 0) break
        for (let i = 0; i < len; i++) bytes.push(data[pos++]!)
    }

    const clearCode = 1 << minCodeSize
    const eoiCode = clearCode + 1

    let bitBuf = 0
    let bitCount = 0
    let bytePos = 0
    function readCode(bits: number): number {
        while (bitCount < bits) {
            bitBuf |= (bytes[bytePos++] ?? 0) << bitCount
            bitCount += 8
        }
        const code = bitBuf & ((1 << bits) - 1)
        bitBuf >>>= bits
        bitCount -= bits
        return code
    }

    let codeSize = minCodeSize + 1
    if (readCode(codeSize) !== clearCode) throw new Error('expected initial clear code')

    let nextCode = eoiCode + 1
    const dict = new Map<number, number[]>()
    const result: number[] = []
    let prevSeq: number[] | null = null

    for (;;) {
        const code = readCode(codeSize)
        if (code === eoiCode) break

        if (code === clearCode) {
            dict.clear()
            nextCode = eoiCode + 1
            codeSize = minCodeSize + 1
            prevSeq = null
            continue
        }

        let seq: number[]
        if (code < clearCode) {
            seq = [code]
        } else if (dict.has(code)) {
            seq = dict.get(code)!
        } else if (code === nextCode && prevSeq !== null) {
            seq = [...prevSeq, prevSeq[0]!]
        } else {
            throw new Error(`invalid code ${code} at nextCode=${nextCode}`)
        }

        result.push(...seq)

        if (prevSeq !== null && nextCode <= 4095) {
            dict.set(nextCode++, [...prevSeq, seq[0]!])
            if (codeSize < 12 && nextCode === 1 << codeSize) codeSize++
        }

        prevSeq = seq
    }

    return Uint8Array.from(result)
}

interface ParsedFrame {
    delay: number
    transparentIndex: number
    indices: Uint8Array
}

interface ParsedGif {
    width: number
    height: number
    gct: Uint8Array
    gctSize: number
    frames: ParsedFrame[]
    hasLoop: boolean
}

function parseGif(gif: Uint8Array): ParsedGif {
    let pos = 6

    const width = gif[pos]! | (gif[pos + 1]! << 8)
    pos += 2
    const height = gif[pos]! | (gif[pos + 1]! << 8)
    pos += 2
    const packed = gif[pos++]!
    const gctFlag = (packed >> 7) & 1
    const gctN = packed & 0x07
    pos++
    pos++

    const gctSize = gctFlag ? 2 << gctN : 0
    const gct = gif.slice(pos, pos + gctSize * 3)
    pos += gctSize * 3

    const frames: ParsedFrame[] = []
    let hasLoop = false
    let pendingDelay = 0
    let pendingTransIdx = -1

    while (pos < gif.length) {
        const byte = gif[pos++]!
        if (byte === 0x3b) break

        if (byte === 0x21) {
            const label = gif[pos++]!

            if (label === 0xf9) {
                pos++
                const gcePacked = gif[pos++]!
                pendingDelay = gif[pos]! | (gif[pos + 1]! << 8)
                pos += 2
                const transIdx = gif[pos++]!
                pendingTransIdx = gcePacked & 1 ? transIdx : -1
                pos++
            } else {
                for (;;) {
                    const blockSize = gif[pos++]!
                    if (blockSize === 0) break
                    if (label === 0xff && blockSize === 11) {
                        const appId = String.fromCharCode(...gif.slice(pos, pos + blockSize))
                        if (appId === 'NETSCAPE2.0') hasLoop = true
                    }
                    pos += blockSize
                }
            }
        } else if (byte === 0x2c) {
            pos += 8
            pos++
            const minCodeSize = gif[pos++]!

            const subStart = pos
            for (;;) {
                const blockLen = gif[pos++]!
                if (blockLen === 0) break
                pos += blockLen
            }

            const indices = decodeLzwStream(gif.slice(subStart, pos), minCodeSize)
            frames.push({ delay: pendingDelay, transparentIndex: pendingTransIdx, indices })
            pendingDelay = 0
            pendingTransIdx = -1
        }
    }

    return { width, height, gct, gctSize, frames, hasLoop }
}

function makeRng(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (state * 1_664_525 + 1_013_904_223) >>> 0
        return state
    }
}

function byte(rng: () => number): number {
    return rng() & 0xff
}

function makeFrame(width: number, height: number, colors: number[]): GifFrame {
    const pixels = new Uint8Array(width * height * 4)
    const rng = makeRng(0x1337cafe + colors.length)
    for (let i = 0; i < width * height; i++) {
        const rgb = colors[rng() % colors.length]!
        pixels[i * 4] = (rgb >>> 16) & 0xff
        pixels[i * 4 + 1] = (rgb >>> 8) & 0xff
        pixels[i * 4 + 2] = rgb & 0xff
        pixels[i * 4 + 3] = 255
    }
    return { pixels, durationMs: 100 }
}

function makeNoiseFrame(width: number, height: number, colorCount: number, seed: number): GifFrame {
    const rng = makeRng(seed)
    const palette: number[] = []
    for (let i = 0; i < colorCount; i++) {
        palette.push(((rng() & 0xff) << 16) | ((rng() & 0xff) << 8) | (rng() & 0xff))
    }
    return makeFrameFromPalette(width, height, palette, seed ^ 0xdeadbeef)
}

function makeFrameFromPalette(
    width: number,
    height: number,
    palette: number[],
    seed: number,
): GifFrame {
    const rng = makeRng(seed)
    const pixels = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i++) {
        const rgb = palette[rng() % palette.length]!
        pixels[i * 4] = (rgb >>> 16) & 0xff
        pixels[i * 4 + 1] = (rgb >>> 8) & 0xff
        pixels[i * 4 + 2] = rgb & 0xff
        pixels[i * 4 + 3] = 255
    }
    return { pixels, durationMs: 100 }
}

async function sha256Bytes(data: Uint8Array): Promise<string> {
    const subtle = (
        globalThis as unknown as {
            crypto: { subtle: { digest(name: string, data: Uint8Array): Promise<ArrayBuffer> } }
        }
    ).crypto.subtle
    const digest = new Uint8Array(await subtle.digest('SHA-256', data))
    return [...digest].map((v) => v.toString(16).padStart(2, '0')).join('')
}

describe('GIF encoder', () => {
    it('roundtrips a single opaque frame', () => {
        const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00]
        const frame = makeFrame(8, 8, colors)
        const gif = encodeGif([frame], 8, 8)

        const parsed = parseGif(gif)
        expect(parsed.width).toBe(8)
        expect(parsed.height).toBe(8)
        expect(parsed.frames).toHaveLength(1)
        expect(parsed.hasLoop).toBe(true)

        const { indices, transparentIndex } = parsed.frames[0]!
        const gct = parsed.gct
        for (let i = 0; i < 8 * 8; i++) {
            const idx = indices[i]!
            if (idx === transparentIndex && transparentIndex !== -1) {
                expect(frame.pixels[i * 4 + 3]!).toBeLessThan(128)
            } else {
                const r = gct[idx * 3]!
                const g = gct[idx * 3 + 1]!
                const b = gct[idx * 3 + 2]!
                expect(r).toBe(frame.pixels[i * 4]!)
                expect(g).toBe(frame.pixels[i * 4 + 1]!)
                expect(b).toBe(frame.pixels[i * 4 + 2]!)
            }
        }
    })

    it('roundtrips multi-frame animation with transparent pixels (seeded)', () => {
        const rng = makeRng(0xc0ffee42)

        const palette: number[] = []
        for (let i = 0; i < 50; i++) {
            palette.push((byte(rng) << 16) | (byte(rng) << 8) | byte(rng))
        }

        const frames: GifFrame[] = []
        for (let f = 0; f < 4; f++) {
            const px = new Uint8Array(16 * 16 * 4)
            for (let i = 0; i < 16 * 16; i++) {
                const alpha = byte(rng) < 40 ? 0 : 255
                if (alpha === 0) {
                    px[i * 4 + 3] = 0
                } else {
                    const rgb = palette[rng() % palette.length]!
                    px[i * 4] = (rgb >>> 16) & 0xff
                    px[i * 4 + 1] = (rgb >>> 8) & 0xff
                    px[i * 4 + 2] = rgb & 0xff
                    px[i * 4 + 3] = 255
                }
            }
            frames.push({ pixels: px, durationMs: 50 + f * 10 })
        }

        const gif = encodeGif(frames, 16, 16)
        const parsed = parseGif(gif)

        expect(parsed.frames).toHaveLength(4)
        expect(parsed.frames[1]!.delay).toBe(Math.max(2, Math.round(60 / 10))) // 60ms → 6cs

        for (let f = 0; f < frames.length; f++) {
            const { indices, transparentIndex } = parsed.frames[f]!
            const gct = parsed.gct
            const orig = frames[f]!.pixels

            for (let i = 0; i < 16 * 16; i++) {
                const idx = indices[i]!
                if (orig[i * 4 + 3]! < 128) {
                    expect(idx).toBe(transparentIndex)
                } else {
                    expect(gct[idx * 3]!).toBe(orig[i * 4]!)
                    expect(gct[idx * 3 + 1]!).toBe(orig[i * 4 + 1]!)
                    expect(gct[idx * 3 + 2]!).toBe(orig[i * 4 + 2]!)
                }
            }
        }
    })

    it('forces a dictionary reset (noisy 128*128 with ~200 colors)', () => {
        const frame = makeNoiseFrame(128, 128, 200, 0xabad1dea)
        const gif = encodeGif([frame], 128, 128)

        expect(gif[0]).toBe(0x47)
        expect(gif[1]).toBe(0x49)
        expect(gif[2]).toBe(0x46)

        const parsed = parseGif(gif)
        expect(parsed.frames[0]!.indices).toHaveLength(128 * 128)

        for (const idx of parsed.frames[0]!.indices) {
            expect(idx).toBeLessThan(parsed.gctSize)
        }
    })

    it('respects the loop=false option (no NETSCAPE2.0 block)', () => {
        const px = new Uint8Array(4 * 4 * 4).fill(0xff)
        const gif = encodeGif([{ pixels: px, durationMs: 100 }], 4, 4, { loop: false })

        let found = false
        for (let i = 0; i < gif.length - 2; i++) {
            if (gif[i] === 0x21 && gif[i + 1] === 0xff && gif[i + 2] === 0x0b) {
                found = true
                break
            }
        }
        expect(found).toBe(false)
    })

    it('delay floor: 10ms rounds to 1cs then is floored to 2cs', () => {
        const px = new Uint8Array(2 * 2 * 4).fill(0xff)
        const gif = encodeGif([{ pixels: px, durationMs: 10 }], 2, 2)
        const parsed = parseGif(gif)
        expect(parsed.frames[0]!.delay).toBe(2)
    })

    it('delay: 100ms → 10cs, 33ms → 3cs', () => {
        const px = new Uint8Array(2 * 2 * 4).fill(0xff)
        const gif100 = encodeGif([{ pixels: px, durationMs: 100 }], 2, 2)
        const gif33 = encodeGif([{ pixels: px, durationMs: 33 }], 2, 2)
        expect(parseGif(gif100).frames[0]!.delay).toBe(10)
        expect(parseGif(gif33).frames[0]!.delay).toBe(3)
    })

    it('produces a GIF89a with NETSCAPE2.0 visible in the header bytes', () => {
        const px = new Uint8Array(4 * 4 * 4).fill(0x80)
        const gif = encodeGif([{ pixels: px, durationMs: 100 }], 4, 4)

        const header = String.fromCharCode(...gif.slice(0, 6))
        expect(header).toBe('GIF89a')

        const preamble = String.fromCharCode(...gif.slice(0, 64))
        expect(preamble).toContain('NETSCAPE2.0')
    })

    it('matches the golden SHA256 for a 2*2 two-frame animation', async () => {
        const px1 = new Uint8Array(2 * 2 * 4)
        for (let i = 0; i < 4; i++) {
            px1[i * 4] = 255
            px1[i * 4 + 1] = 0
            px1[i * 4 + 2] = 0
            px1[i * 4 + 3] = 255
        }

        const px2 = new Uint8Array(2 * 2 * 4)
        for (let i = 0; i < 4; i++) {
            px2[i * 4] = 0
            px2[i * 4 + 1] = 0
            px2[i * 4 + 2] = 255
            px2[i * 4 + 3] = 255
        }

        const gif = encodeGif(
            [
                { pixels: px1, durationMs: 100 },
                { pixels: px2, durationMs: 200 },
            ],
            2,
            2,
        )

        expect(String.fromCharCode(...gif.slice(0, 6))).toBe('GIF89a')
        expect(gif[gif.length - 1]).toBe(0x3b)

        const hash = await sha256Bytes(gif)
        expect(hash).toBe('7bb7035ad2d6d987e0f836b1d3bc3eb16c7aa5f63bd3d3f707403f87ac7cd81b')
    })

    it('quantizes art past 256 colors into a valid ≤256-color GIF', () => {
        const pixels = new Uint8Array(257 * 4)
        for (let i = 0; i < 257; i++) {
            pixels[i * 4] = Math.floor(i / 16)
            pixels[i * 4 + 1] = i % 16
            pixels[i * 4 + 2] = i & 1 ? 200 : 40
            pixels[i * 4 + 3] = 255
        }
        const gif = encodeGif([{ pixels, durationMs: 100 }], 257, 1)

        expect(String.fromCharCode(...gif.slice(0, 6))).toBe('GIF89a')
        expect(gif[gif.length - 1]).toBe(0x3b)

        const parsed = parseGif(gif)
        expect(parsed.gctSize).toBeLessThanOrEqual(256)
        const used = new Set(parsed.frames[0]!.indices)
        for (const idx of used) expect(idx).toBeLessThan(parsed.gctSize)
    })

    it('never draws more than 256 distinct colors, whatever the input (seeded)', () => {
        for (const seed of [1, 2, 3, 7, 42]) {
            const frame = makeNoiseFrame(64, 64, 1000, seed)
            const parsed = parseGif(encodeGif([frame], 64, 64))
            const rgbUsed = new Set<number>()
            for (const idx of parsed.frames[0]!.indices) {
                const o = idx * 3
                rgbUsed.add((parsed.gct[o]! << 16) | (parsed.gct[o + 1]! << 8) | parsed.gct[o + 2]!)
            }
            expect(rgbUsed.size, `seed ${seed}`).toBeLessThanOrEqual(256)
        }
    })

    it('quantization is deterministic: the same art encodes to identical bytes', () => {
        const a = encodeGif([makeNoiseFrame(48, 48, 900, 0xfeed)], 48, 48)
        const b = encodeGif([makeNoiseFrame(48, 48, 900, 0xfeed)], 48, 48)
        expect(a).toEqual(b)
    })

    it('keeps the transparent slot when quantizing past-256-color art', () => {
        const opaque = 400
        const pixels = new Uint8Array((opaque + 1) * 4)
        for (let i = 0; i < opaque; i++) {
            pixels[i * 4] = i & 0xff
            pixels[i * 4 + 1] = (i * 3) & 0xff
            pixels[i * 4 + 2] = (i * 7) & 0xff
            pixels[i * 4 + 3] = 255
        }
        const parsed = parseGif(encodeGif([{ pixels, durationMs: 100 }], opaque + 1, 1))
        expect(parsed.frames[0]!.transparentIndex).toBe(0)
        expect(parsed.gctSize).toBeLessThanOrEqual(256)
    })

    it('quantizes a 512*512 frame with ~10k colors within the 1.5s budget', () => {
        const frame = makeNoiseFrame(512, 512, 10000, 0x5eed)
        const start = Date.now()
        const gif = encodeGif([frame], 512, 512)
        const elapsed = Date.now() - start

        expect(gif.length).toBeGreaterThan(0)
        expect(parseGif(gif).gctSize).toBeLessThanOrEqual(256)
        expect(elapsed).toBeLessThan(1500)
    })

    it('accepts exactly 256 opaque colors without throwing', () => {
        const pixels = new Uint8Array(256 * 4)
        for (let i = 0; i < 256; i++) {
            pixels[i * 4] = i
            pixels[i * 4 + 1] = 0
            pixels[i * 4 + 2] = 0
            pixels[i * 4 + 3] = 255
        }
        expect(() => encodeGif([{ pixels, durationMs: 100 }], 256, 1)).not.toThrow()
    })

    it('throws GifError(BOUNDS) on pixel data length mismatch', () => {
        const pixels = new Uint8Array(10)
        expect(() => encodeGif([{ pixels, durationMs: 100 }], 4, 4)).toThrow(GifError)
        try {
            encodeGif([{ pixels, durationMs: 100 }], 4, 4)
        } catch (e) {
            expect((e as GifError).code).toBe('BOUNDS')
        }
    })

    it('encodes an empty frame list (no images, just header+trailer)', () => {
        const gif = encodeGif([], 4, 4)
        expect(String.fromCharCode(...gif.slice(0, 6))).toBe('GIF89a')
        expect(gif[gif.length - 1]).toBe(0x3b)
    })

    it('returns bytes that own their buffer exactly, with nothing after the trailer', () => {
        const frame = makeNoiseFrame(64, 64, 120, 0xc0ffee)
        const gif = encodeGif([frame, frame], 64, 64)

        expect(gif[gif.length - 1]).toBe(0x3b)
        expect(gif.byteOffset).toBe(0)
        expect(gif.buffer.byteLength).toBe(gif.length)
    })

    it('encodes a single fully-transparent frame', () => {
        const pixels = new Uint8Array(4 * 4 * 4)
        const gif = encodeGif([{ pixels, durationMs: 100 }], 4, 4)
        const parsed = parseGif(gif)
        expect(parsed.frames[0]!.transparentIndex).toBe(0)
        for (const idx of parsed.frames[0]!.indices) {
            expect(idx).toBe(0)
        }
    })

    it('encodes 16 frames of 256*256 with 200 colors in under 1500ms', () => {
        const frames: GifFrame[] = Array.from({ length: 16 }, (_, i) =>
            makeNoiseFrame(256, 256, 200, 0x1234 + i),
        )

        const start = Date.now()
        const gif = encodeGif(frames, 256, 256)
        const elapsed = Date.now() - start

        expect(gif.length).toBeGreaterThan(0)
        expect(elapsed).toBeLessThan(1500)
    })
})
