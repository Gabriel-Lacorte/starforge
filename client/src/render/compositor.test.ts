import { describe, expect, it } from 'vitest'
import {
    BLEND_MODES,
    createFrame,
    createLayer,
    createSprite,
    insertLayer,
    removeLayer,
    rgba,
    setLayerProp,
    writePixel,
    type BlendMode,
    type Cel,
    type DirtyRect,
    type Sprite,
} from '@starforge/core'
import {
    Compositor,
    type CompositeContext,
    type CompositeSurface,
    type CompositorBackend,
} from './compositor'

class FakeImage {
    readonly width: number
    readonly height: number

    readonly data: Float64Array

    constructor(width: number, height: number) {
        this.width = width
        this.height = height
        this.data = new Float64Array(width * height * 4)
    }

    static fromCel(cel: Cel, width: number, height: number): FakeImage {
        const img = new FakeImage(width, height)
        for (let i = 0; i < width * height; i++) {
            const o = i * 4
            const a = cel.pixels[o + 3]! / 255
            img.data[o] = (cel.pixels[o]! / 255) * a
            img.data[o + 1] = (cel.pixels[o + 1]! / 255) * a
            img.data[o + 2] = (cel.pixels[o + 2]! / 255) * a
            img.data[o + 3] = a
        }
        return img
    }

    pixel(x: number, y: number): [number, number, number, number] {
        const o = (y * this.width + x) * 4
        const a = this.data[o + 3]!
        if (a === 0) return [0, 0, 0, 0]
        return [
            Math.round((this.data[o]! / a) * 255),
            Math.round((this.data[o + 1]! / a) * 255),
            Math.round((this.data[o + 2]! / a) * 255),
            Math.round(a * 255),
        ]
    }
}

class FakeContext implements CompositeContext<FakeImage> {
    globalAlpha = 1
    globalCompositeOperation: GlobalCompositeOperation = 'source-over'
    draws = 0
    clears: DirtyRect[] = []
    readonly #target: FakeImage

    constructor(target: FakeImage) {
        this.#target = target
    }

    clearRect(x: number, y: number, w: number, h: number): void {
        this.clears.push({ x, y, w, h })
        for (let j = y; j < y + h; j++) {
            for (let i = x; i < x + w; i++) {
                if (i < 0 || j < 0 || i >= this.#target.width || j >= this.#target.height) continue
                this.#target.data.fill(
                    0,
                    (j * this.#target.width + i) * 4,
                    (j * this.#target.width + i) * 4 + 4,
                )
            }
        }
    }

    drawImage(
        image: FakeImage,
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        dx: number,
        dy: number,
        dw: number,
        dh: number,
    ): void {
        if (sw !== dw || sh !== dh) {
            throw new Error('the compositor never scales')
        }

        this.draws++
        const ga = this.globalAlpha
        const op = this.globalCompositeOperation

        for (let j = 0; j < sh; j++) {
            for (let i = 0; i < sw; i++) {
                const srcX = sx + i
                const srcY = sy + j
                const dstX = dx + i
                const dstY = dy + j

                if (srcX < 0 || srcY < 0 || srcX >= image.width || srcY >= image.height) continue

                if (
                    dstX < 0 ||
                    dstY < 0 ||
                    dstX >= this.#target.width ||
                    dstY >= this.#target.height
                ) {
                    continue
                }

                const so = (srcY * image.width + srcX) * 4
                const os = ga
                const cs = [
                    image.data[so]! * os,
                    image.data[so + 1]! * os,
                    image.data[so + 2]! * os,
                ]

                const as = image.data[so + 3]! * os
                if (as === 0) continue

                const to = (dstY * this.#target.width + dstX) * 4
                const cb = [
                    this.#target.data[to]!,
                    this.#target.data[to + 1]!,
                    this.#target.data[to + 2]!,
                ]
                const ab = this.#target.data[to + 3]!

                let out: number[]
                let ao: number
                if (op === 'lighter') {
                    out = cs.map((c, k) => Math.min(1, c + cb[k]!))
                    ao = Math.min(1, as + ab)
                } else if (op === 'source-over') {
                    out = cs.map((c, k) => c + cb[k]! * (1 - as))
                    ao = as + ab * (1 - as)
                } else if (isSeparableBlend(op)) {
                    out = cs.map((c, k) => {
                        const Cs = c / as
                        const Cb = ab > 0 ? cb[k]! / ab : 0
                        const blended = (1 - ab) * Cs + ab * blend(op, Cb, Cs)
                        return as * blended + cb[k]! * (1 - as)
                    })
                    ao = as + ab * (1 - as)
                } else {
                    throw new Error(`fake blend does not model ${op}`)
                }
                this.#target.data[to] = out[0]!
                this.#target.data[to + 1] = out[1]!
                this.#target.data[to + 2] = out[2]!
                this.#target.data[to + 3] = ao
            }
        }
    }
}

const BLEND_FN = {
    multiply: (Cb: number, Cs: number) => Cb * Cs,
    screen: (Cb: number, Cs: number) => Cb + Cs - Cb * Cs,
    overlay: (Cb: number, Cs: number) => (Cb <= 0.5 ? 2 * Cb * Cs : 1 - 2 * (1 - Cb) * (1 - Cs)),
    darken: (Cb: number, Cs: number) => Math.min(Cb, Cs),
    lighten: (Cb: number, Cs: number) => Math.max(Cb, Cs),
} as const

type SeparableBlend = keyof typeof BLEND_FN

function isSeparableBlend(op: GlobalCompositeOperation): op is SeparableBlend {
    return op in BLEND_FN
}

function blend(op: SeparableBlend, Cb: number, Cs: number): number {
    return BLEND_FN[op](Cb, Cs)
}

class FakeBackend implements CompositorBackend<FakeImage> {
    ctx: FakeContext | null = null

    createComposite(width: number, height: number): CompositeSurface<FakeImage> {
        const image = new FakeImage(width, height)
        this.ctx = new FakeContext(image)
        return { image, ctx: this.ctx }
    }

    celImage(cel: Cel, width: number, height: number): FakeImage {
        return FakeImage.fromCel(cel, width, height)
    }

    invalidateCel(): void {
        /* */
    }
}

const RED = rgba(255, 0, 0)
const BLUE = rgba(0, 0, 255)
const WHITE = rgba(255, 255, 255)

function setup(): {
    sprite: Sprite
    frame: string
    bottom: string
    top: string
    backend: FakeBackend
    compositor: Compositor<FakeImage>
} {
    const sprite = createSprite({ width: 16, height: 16 })
    const bottom = sprite.layers[0]!.id
    insertLayer(sprite, createLayer('top'), bottom)
    const top = sprite.layers[1]!.id
    const frame = sprite.frames[0]!.id
    const backend = new FakeBackend()
    return { sprite, frame, bottom, top, backend, compositor: new Compositor(backend) }
}

describe('Compositor: image', () => {
    it('composes the frame it was asked for, with no bleed from its neighbour', () => {
        const { sprite, frame, bottom, compositor } = setup()
        const second = createFrame()
        sprite.frames.push(second)

        writePixel(sprite, bottom, frame, 0, 0, RED)
        writePixel(sprite, bottom, second.id, 1, 0, BLUE)

        const first = compositor.get(sprite, frame)
        expect(first.pixel(0, 0)).toEqual([255, 0, 0, 255])
        expect(first.pixel(1, 0)).toEqual([0, 0, 0, 0])

        const other = compositor.get(sprite, second.id)
        expect(other.pixel(0, 0)).toEqual([0, 0, 0, 0])
        expect(other.pixel(1, 0)).toEqual([0, 0, 255, 255])
    })

    it('stacks opaque layers bottom-to-top: the top layer wins where it paints', () => {
        const { sprite, frame, bottom, top, compositor } = setup()
        writePixel(sprite, bottom, frame, 0, 0, RED)
        writePixel(sprite, bottom, frame, 1, 0, RED)
        writePixel(sprite, top, frame, 0, 0, BLUE)

        const image = compositor.get(sprite, frame)
        expect(image.pixel(0, 0)).toEqual([0, 0, 255, 255])
        expect(image.pixel(1, 0)).toEqual([255, 0, 0, 255])
        expect(image.pixel(2, 0)).toEqual([0, 0, 0, 0])
    })

    it('skips invisible layers even when their cel is painted', () => {
        const { sprite, frame, bottom, top, compositor } = setup()
        writePixel(sprite, bottom, frame, 0, 0, RED)
        writePixel(sprite, top, frame, 0, 0, BLUE)
        setLayerProp(sprite, top, 'visible', false)
        expect(compositor.get(sprite, frame).pixel(0, 0)).toEqual([255, 0, 0, 255])
    })

    it('opacity 128: red over white lands on exactly (255, 127, 127)', () => {
        const { sprite, frame, bottom, top, compositor } = setup()
        writePixel(sprite, bottom, frame, 0, 0, WHITE)
        writePixel(sprite, top, frame, 0, 0, RED)
        setLayerProp(sprite, top, 'opacity', 128)
        expect(compositor.get(sprite, frame).pixel(0, 0)).toEqual([255, 127, 127, 255])
    })

    it('multiply: (200,100,40) over (51,153,255) is the per-channel product (40,60,40)', () => {
        const { sprite, frame, bottom, top, compositor } = setup()
        writePixel(sprite, bottom, frame, 0, 0, rgba(51, 153, 255))
        writePixel(sprite, top, frame, 0, 0, rgba(200, 100, 40))
        setLayerProp(sprite, top, 'blendMode', 'multiply')
        expect(compositor.get(sprite, frame).pixel(0, 0)).toEqual([40, 60, 40, 255])
    })

    it('the FIRST visible layer composites source-over even with a blend mode set', () => {
        const { sprite, frame, bottom, compositor } = setup()
        writePixel(sprite, bottom, frame, 0, 0, RED)
        setLayerProp(sprite, bottom, 'blendMode', 'multiply')
        expect(compositor.get(sprite, frame).pixel(0, 0)).toEqual([255, 0, 0, 255])
    })

    it('restores globalAlpha/CompositeOperation after composing (sticky state)', () => {
        const { sprite, frame, top, backend, compositor } = setup()
        writePixel(sprite, top, frame, 0, 0, RED)
        setLayerProp(sprite, top, 'opacity', 90)
        setLayerProp(sprite, top, 'blendMode', 'screen')
        compositor.get(sprite, frame)
        expect(backend.ctx!.globalAlpha).toBe(1)
        expect(backend.ctx!.globalCompositeOperation).toBe('source-over')
    })
})

describe('Compositor: cache', () => {
    it('two gets with no change in between compose exactly once', () => {
        const { sprite, frame, bottom, backend, compositor } = setup()
        writePixel(sprite, bottom, frame, 0, 0, RED)
        compositor.get(sprite, frame)
        const draws = backend.ctx!.draws
        compositor.get(sprite, frame)
        expect(compositor.stats.recompositions).toBe(1)
        expect(backend.ctx!.draws).toBe(draws)
    })

    it('a cel write invalidates; so does an opacity change no version ever sees', () => {
        const { sprite, frame, bottom, compositor } = setup()
        writePixel(sprite, bottom, frame, 0, 0, RED)
        compositor.get(sprite, frame)

        writePixel(sprite, bottom, frame, 1, 1, BLUE)
        expect(compositor.get(sprite, frame).pixel(1, 1)).toEqual([0, 0, 255, 255])
        expect(compositor.stats.recompositions).toBe(2)

        setLayerProp(sprite, bottom, 'opacity', 128)
        expect(compositor.get(sprite, frame).pixel(0, 0)).toEqual([255, 0, 0, 128])
        expect(compositor.stats.recompositions).toBe(3)
    })

    it('keys on the (revision, Σversion) PAIR, a removal that cancels the sum still invalidates', () => {
        const { sprite, frame, bottom, top, compositor } = setup()
        writePixel(sprite, bottom, frame, 0, 0, RED)
        writePixel(sprite, top, frame, 0, 0, BLUE)
        compositor.get(sprite, frame)

        removeLayer(sprite, top)
        expect(compositor.get(sprite, frame).pixel(0, 0)).toEqual([255, 0, 0, 255])
        expect(compositor.stats.recompositions).toBe(2)
    })

    it('writes to an invisible layer never trigger a recompose', () => {
        const { sprite, frame, bottom, top, compositor } = setup()
        writePixel(sprite, bottom, frame, 0, 0, RED)
        setLayerProp(sprite, top, 'visible', false)
        compositor.get(sprite, frame)
        writePixel(sprite, top, frame, 5, 5, BLUE)
        compositor.get(sprite, frame)
        expect(compositor.stats.recompositions).toBe(1)
    })
})

describe('Compositor: dirty rect', () => {
    it('recomposes only the reported rect on a pixel-only delta', () => {
        const { sprite, frame, bottom, backend, compositor } = setup()
        writePixel(sprite, bottom, frame, 0, 0, RED)
        compositor.get(sprite, frame)

        writePixel(sprite, bottom, frame, 4, 5, BLUE)
        writePixel(sprite, bottom, frame, 5, 5, BLUE)
        compositor.invalidateCel(sprite, bottom, frame, 4, 5, 2, 1)
        const image = compositor.get(sprite, frame)
        expect(backend.ctx!.clears.at(-1)).toEqual({ x: 4, y: 5, w: 2, h: 1 })

        expect(image.pixel(4, 5)).toEqual([0, 0, 255, 255])
        expect(image.pixel(0, 0)).toEqual([255, 0, 0, 255])
    })

    it('a structural change forces a FULL recompose even with a narrow rect pending', () => {
        const { sprite, frame, bottom, top, backend, compositor } = setup()
        writePixel(sprite, bottom, frame, 0, 0, RED)
        writePixel(sprite, top, frame, 8, 8, BLUE)
        compositor.get(sprite, frame)

        writePixel(sprite, bottom, frame, 1, 0, RED)
        compositor.invalidateCel(sprite, bottom, frame, 1, 0, 1, 1)

        setLayerProp(sprite, top, 'visible', false)
        const image = compositor.get(sprite, frame)
        expect(backend.ctx!.clears.at(-1)).toEqual({ x: 0, y: 0, w: 16, h: 16 })
        expect(image.pixel(8, 8)).toEqual([0, 0, 0, 0])
        expect(image.pixel(1, 0)).toEqual([255, 0, 0, 255])
    })
})

describe('Compositor: every blend mode', () => {
    const BACKDROP = rgba(51, 153, 255)
    const SOURCE = rgba(200, 100, 40)

    const EXPECTED: Record<BlendMode, [number, number, number, number]> = {
        normal: [200, 100, 40, 255],
        multiply: [40, 60, 40, 255],
        screen: [211, 193, 255, 255],
        overlay: [80, 131, 255, 255],
        darken: [51, 100, 40, 255],
        lighten: [200, 153, 255, 255],
        additive: [251, 253, 255, 255],
    }

    it.each(BLEND_MODES)('%s blends the source over the backdrop', (mode) => {
        const { sprite, frame, bottom, top, compositor } = setup()
        writePixel(sprite, bottom, frame, 0, 0, BACKDROP)
        writePixel(sprite, top, frame, 0, 0, SOURCE)
        setLayerProp(sprite, top, 'blendMode', mode)

        expect(compositor.get(sprite, frame).pixel(0, 0)).toEqual(EXPECTED[mode])
    })

    it('covers every mode the document model allows', () => {
        expect(Object.keys(EXPECTED).sort()).toEqual([...BLEND_MODES].sort())
    })
})

describe('Compositor: cel offset', () => {
    it('draws a cel shifted by its own x/y', () => {
        const { sprite, frame, bottom, compositor } = setup()
        writePixel(sprite, bottom, frame, 0, 0, RED)

        const cel = sprite.layers[0]!.cels.get(frame)!
        cel.x = 3
        cel.y = 2
        sprite.revision++

        const image = compositor.get(sprite, frame)
        expect(image.pixel(3, 2)).toEqual([255, 0, 0, 255])
        expect(image.pixel(0, 0)).toEqual([0, 0, 0, 0])
    })
})

describe('Compositor: bounded cache', () => {
    it('keeps the frames recently shown and lets the oldest go', () => {
        const { sprite, bottom, frame } = setup()
        const compositor = new Compositor(new FakeBackend(), 3)
        const ids = [frame, ...['b', 'c', 'd'].map((id) => createFrame(100, id).id)]
        for (const id of ['b', 'c', 'd']) sprite.frames.push(createFrame(100, id))
        writePixel(sprite, bottom, frame, 0, 0, RED)

        for (const id of ids) compositor.get(sprite, id)

        expect(compositor.cached).toBe(3)
        expect(compositor.stats.evictions).toBe(1)
    })

    it('showing a frame again keeps it, so a loop does not thrash', () => {
        const { sprite, frame } = setup()
        const compositor = new Compositor(new FakeBackend(), 2)
        for (const id of ['b', 'c']) sprite.frames.push(createFrame(100, id))

        for (let pass = 0; pass < 8; pass++) {
            compositor.get(sprite, frame)
            compositor.get(sprite, 'b')
        }

        expect(compositor.stats.evictions).toBe(0)
        expect(compositor.cached).toBe(2)
    })

    it('never drops below one frame, whatever limit it is handed', () => {
        const { sprite, frame } = setup()
        const compositor = new Compositor(new FakeBackend(), 0)

        compositor.get(sprite, frame)
        expect(compositor.cached).toBe(1)
    })
})
