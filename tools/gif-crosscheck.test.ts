import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { encodeGif, type GifFrame } from '../core/src/gif'

/*
 * Our own decoder in gif.test.ts can share a bug with the encoder and still
 * agree with it. This suite proves the bytes against ffmpeg — an independent
 * decoder that knows nothing about how we built them. It skips when ffmpeg is
 * absent so CI without it stays green.
 */

function hasFfmpeg(): boolean {
    try {
        execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
        return true
    } catch {
        return false
    }
}

/* deterministic LCG so a failure is always reproducible */
function lcg(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0
        return s / 0x100000000
    }
}

function buildPalette(colors: number, seed: number): number[][] {
    const rnd = lcg(seed)
    return Array.from({ length: colors }, () => [
        Math.floor(rnd() * 256),
        Math.floor(rnd() * 256),
        Math.floor(rnd() * 256),
    ])
}

/* every frame draws from ONE palette: the whole animation shares a 256-entry GCT */
function noiseFrame(w: number, h: number, palette: number[][], seed: number): GifFrame {
    const rnd = lcg(seed)
    const px = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) {
        const c = palette[Math.floor(rnd() * palette.length)]!
        px[i * 4] = c[0]!
        px[i * 4 + 1] = c[1]!
        px[i * 4 + 2] = c[2]!
        px[i * 4 + 3] = 255
    }
    return { pixels: px, durationMs: 100 }
}

/* 16*16 distinct colors = 256 exactly, the largest palette a GIF can hold */
function gradientFrame(w: number, h: number): GifFrame {
    const px = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4
            px[i] = (x % 16) * 16
            px[i + 1] = (y % 16) * 16
            px[i + 2] = 128
            px[i + 3] = 255
        }
    }
    return { pixels: px, durationMs: 100 }
}

interface CrossCase {
    name: string
    width: number
    height: number
    frames: GifFrame[]
}

const NOISE_PALETTE = buildPalette(200, 0xabad1dea)

const CASES: readonly CrossCase[] = [
    { name: 'gradient', width: 64, height: 64, frames: [gradientFrame(64, 64)] },
    /* 200 colors of noise overruns the 4096-entry dictionary and forces resets */
    {
        name: 'noise-dictreset',
        width: 128,
        height: 128,
        frames: [noiseFrame(128, 128, NOISE_PALETTE, 0xd00d)],
    },
    {
        name: 'multiframe',
        width: 96,
        height: 96,
        frames: [
            noiseFrame(96, 96, NOISE_PALETTE, 0x1111),
            noiseFrame(96, 96, NOISE_PALETTE, 0x2222),
            noiseFrame(96, 96, NOISE_PALETTE, 0x3333),
        ],
    },
]

describe.skipIf(!hasFfmpeg())('GIF encoder cross-checked against ffmpeg', () => {
    for (const testCase of CASES) {
        it(`${testCase.name}: ffmpeg decodes every pixel back unchanged`, () => {
            const dir = mkdtempSync(join(tmpdir(), 'starforge-gif-'))
            const gifPath = join(dir, 'out.gif')
            writeFileSync(gifPath, encodeGif(testCase.frames, testCase.width, testCase.height))

            /* one raw RGBA stream, every frame concatenated back to back */
            const rawPath = join(dir, 'frames.raw')
            execFileSync(
                'ffmpeg',
                [
                    '-v',
                    'error',
                    '-i',
                    gifPath,
                    /* keep the GIF's own frames: no resampling to a constant rate */
                    '-fps_mode',
                    'passthrough',
                    '-pix_fmt',
                    'rgba',
                    '-f',
                    'rawvideo',
                    rawPath,
                ],
                { stdio: 'pipe' },
            )

            const raw = new Uint8Array(readFileSync(rawPath))
            const frameBytes = testCase.width * testCase.height * 4

            expect(raw.length / frameBytes, 'frames ffmpeg decoded').toBe(testCase.frames.length)

            for (let i = 0; i < testCase.frames.length; i++) {
                const bytes = raw.subarray(i * frameBytes, (i + 1) * frameBytes)
                const original = testCase.frames[i]!.pixels

                expect(bytes).toHaveLength(original.length)

                let differing = 0
                for (let p = 0; p < original.length; p += 4) {
                    if (
                        bytes[p] !== original[p] ||
                        bytes[p + 1] !== original[p + 1] ||
                        bytes[p + 2] !== original[p + 2]
                    ) {
                        differing++
                    }
                }

                expect(differing, `frame ${i} has ${differing} differing pixels`).toBe(0)
            }
        })
    }
})
