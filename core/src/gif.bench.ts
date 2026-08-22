import { bench, describe } from 'vitest'
import { encodeGif, type GifFrame } from './gif'

function makeNoiseFrame(width: number, height: number, colorCount: number, seed: number): GifFrame {
    let state = seed >>> 0
    const rng = () => {
        state = (state * 1_664_525 + 1_013_904_223) >>> 0
        return state
    }

    const palette: number[] = []
    for (let i = 0; i < colorCount; i++) {
        palette.push(((rng() & 0xff) << 16) | ((rng() & 0xff) << 8) | (rng() & 0xff))
    }

    const pixels = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i++) {
        const rgb = palette[rng() % colorCount]!
        pixels[i * 4] = (rgb >>> 16) & 0xff
        pixels[i * 4 + 1] = (rgb >>> 8) & 0xff
        pixels[i * 4 + 2] = rgb & 0xff
        pixels[i * 4 + 3] = 255
    }
    return { pixels, durationMs: 100 }
}

describe('GIF encoder', () => {
    const frames16x256 = Array.from({ length: 16 }, (_, i) =>
        makeNoiseFrame(256, 256, 200, 0xc0de + i),
    )

    bench(
        '16 frames 256*256, 200 colors (budget: <1500ms)',
        () => {
            encodeGif(frames16x256, 256, 256)
        },
        { time: 2000, warmupTime: 500, iterations: 3 },
    )

    const frames4x64 = Array.from({ length: 4 }, (_, i) => makeNoiseFrame(64, 64, 16, 0xbeef + i))

    bench(
        '4 frames 64*64, 16 colors',
        () => {
            encodeGif(frames4x64, 64, 64)
        },
        { time: 1000, warmupTime: 200 },
    )

    const bigQuantized = makeNoiseFrame(512, 512, 10000, 0x5eed)

    bench(
        '1 frame 512*512, ~10k colors quantized (budget: <1500ms)',
        () => {
            encodeGif([bigQuantized], 512, 512)
        },
        { time: 2000, warmupTime: 500, iterations: 3 },
    )
})
