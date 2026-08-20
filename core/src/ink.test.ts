import { describe, expect, it } from 'vitest'
import goldenRaw from './fixtures/ink/golden-v1.json?raw'
import checksumsRaw from './fixtures/ink/SHA256SUMS?raw'
import { TRANSPARENT, hexToRgba, rgba, type RGBA } from './color'
import { applyInk, type InkContext, type InkMode } from './ink'

interface GoldenVector {
    readonly name: string
    readonly destination: string
    readonly mode: InkMode
    readonly color: string
    readonly opacity: number
    readonly expected: string
}

interface GoldenFixture {
    readonly version: number
    readonly rounding: string
    readonly vectors: readonly GoldenVector[]
}

const GOLDEN = JSON.parse(goldenRaw) as GoldenFixture

describe('deterministic ink kernel', () => {
    it.each(GOLDEN.vectors)('$name', (vector) => {
        expect(
            applyInk(hexToRgba(vector.destination), {
                mode: vector.mode,
                color: hexToRgba(vector.color),
                opacity: vector.opacity,
            }),
        ).toBe(hexToRgba(vector.expected))
    })

    it('freezes the golden vector contract and its rounding policy', async () => {
        const [checksum, name] = checksumsRaw.trim().split(/\s+/)

        expect(GOLDEN.version).toBe(1)
        expect(GOLDEN.rounding).toBe('integer nearest, exact halves toward positive infinity')
        expect(name).toBe('golden-v1.json')
        expect(await sha256(goldenRaw)).toBe(checksum)
    })

    it('preserves all current opaque paint and erase results at opacity 255', () => {
        const rng = makeRng(0x1a2b3c4d)
        for (let sample = 0; sample < 10_000; sample++) {
            const destination = randomRgba(rng)
            const opaque = rgba(byte(rng), byte(rng), byte(rng))

            expect(applyInk(destination, ink('source-over', opaque, 255))).toBe(opaque)
            expect(applyInk(destination, ink('erase', opaque, 255))).toBe(TRANSPARENT)
        }
    })

    it('makes opacity zero a byte-exact no-op in every mode', () => {
        const rng = makeRng(0x5eed)
        const modes: readonly InkMode[] = ['source-over', 'erase', 'copy', 'lock-alpha']
        for (let sample = 0; sample < 2_000; sample++) {
            const destination = randomRgba(rng)
            const color = randomRgba(rng)
            for (const mode of modes) {
                expect(applyInk(destination, ink(mode, color, 0))).toBe(destination)
            }
        }
    })

    it('keeps output channels in byte range and source-over alpha monotonic', () => {
        const rng = makeRng(0xc011ab)
        for (let sample = 0; sample < 20_000; sample++) {
            const destination = randomRgba(rng)
            const color = randomRgba(rng)
            const opacity = byte(rng)
            const output = applyInk(destination, ink('source-over', color, opacity))
            const channels = unpack(output)

            expect(
                channels.every(
                    (channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255,
                ),
            ).toBe(true)
            expect(channels[3]).toBeGreaterThanOrEqual(destination & 0xff)
        }
    })

    it('erase never changes visible hue and never increases alpha', () => {
        const rng = makeRng(0xe2a5e)
        for (let sample = 0; sample < 10_000; sample++) {
            const destination = randomRgba(rng)
            const output = applyInk(destination, ink('erase', TRANSPARENT, byte(rng)))
            const outputAlpha = output & 0xff

            expect(outputAlpha).toBeLessThanOrEqual(destination & 0xff)
            if (outputAlpha === 0) expect(output).toBe(TRANSPARENT)
            else expect(output >>> 8).toBe(destination >>> 8)
        }
    })

    it('lock-alpha never changes destination alpha or creates coverage', () => {
        const rng = makeRng(0xa11fa)
        for (let sample = 0; sample < 10_000; sample++) {
            const destination = randomRgba(rng)
            const output = applyInk(destination, ink('lock-alpha', randomRgba(rng), byte(rng)))

            expect(output & 0xff).toBe(destination & 0xff)
        }
    })

    it('rejects invalid opacity and unknown runtime modes', () => {
        for (const opacity of [-1, 256, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => applyInk(TRANSPARENT, ink('source-over', TRANSPARENT, opacity))).toThrow(
                RangeError,
            )
        }
        expect(() =>
            applyInk(TRANSPARENT, {
                mode: 'screen',
                color: TRANSPARENT,
                opacity: 255,
            } as unknown as InkContext),
        ).toThrow(/unknown ink mode/)
    })
})

function ink(mode: InkMode, color: RGBA, opacity: number): InkContext {
    return { mode, color, opacity }
}

function unpack(color: RGBA): readonly [number, number, number, number] {
    return [color >>> 24, (color >>> 16) & 0xff, (color >>> 8) & 0xff, color & 0xff]
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

function randomRgba(rng: () => number): RGBA {
    return rng() >>> 0
}

async function sha256(text: string): Promise<string> {
    const bytes = Uint8Array.from(text, (character) => character.charCodeAt(0))
    const subtle = (
        globalThis as unknown as {
            crypto: { subtle: { digest(name: string, data: Uint8Array): Promise<ArrayBuffer> } }
        }
    ).crypto.subtle
    const digest = new Uint8Array(await subtle.digest('SHA-256', bytes))
    return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('')
}
