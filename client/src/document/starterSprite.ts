import {
    createFrame,
    createLayer,
    createSprite,
    hexToRgba,
    insertFrame,
    insertLayer,
    openCursor,
    setFrameDuration,
    setLayerProp,
    type CelCursor,
    type LayerProps,
    type RGBA,
    type Sprite,
} from '@starforge/core'

const SIZE = 64
const CENTRE_X = 32
const CENTRE_Y = 33

const OUTER_RADIUS = 23
const INNER_RADIUS = 11.5
const ROUNDING = 4.6
const RIM_WIDTH = 2.2
const GLOW_WIDTH = 9

const FRAME_MS = 140
const ORBIT_X = 27
const ORBIT_Y = 25
const SPARK_ARM = 3

const BODY = hexToRgba('#ffe564')
const RIM = hexToRgba('#fff3b0')
const SHADOW = hexToRgba('#ffd166')
const INK = hexToRgba('#241b3d')
const SPARK_CORE = hexToRgba('#ffffff')

/* Stardance's four-corner mesh: yellow to salmon across the top, lilac to blue underneath */
const MESH: readonly RGBA[] = [
    hexToRgba('#ffe564'),
    hexToRgba('#ff8fab'),
    hexToRgba('#ebb7ff'),
    hexToRgba('#6ee7ff'),
]

const ORBIT: readonly RGBA[] = [hexToRgba('#ebb7ff'), hexToRgba('#b6f6ff'), hexToRgba('#ff8fab')]

interface Beat {
    /** pixels the whole star sits above where it rests */
    readonly lift: number
    readonly blink: boolean
    /** how far around the orbit the sparkles have travelled, 0..1 */
    readonly turn: number
}

/* one breath in and out, a blink at the bottom of it, and a full turn of the orbit */
const BEATS: readonly Beat[] = [
    { lift: 0, blink: false, turn: 0 },
    { lift: 1, blink: false, turn: 0.25 },
    { lift: 0, blink: false, turn: 0.5 },
    { lift: -1, blink: true, turn: 0.75 },
]

interface LayerSpec {
    name: string
    props?: Partial<LayerProps>
    paint: (cursor: CelCursor, beat: Beat) => void
}

const LAYERS: LayerSpec[] = [
    { name: 'Glow', props: { opacity: 190 }, paint: paintGlow },
    { name: 'Star', paint: paintStar },
    { name: 'Shading', props: { blendMode: 'multiply', opacity: 165 }, paint: paintShading },
    { name: 'Face', paint: paintFace },
    { name: 'Sparkles', props: { blendMode: 'additive' }, paint: paintSparkles },
]

export interface StarterDocument {
    sprite: Sprite
    activeLayer: string
}

const DRAW_ON = 'Star'

export function createStarterSprite(): StarterDocument {
    const sprite = createSprite({ width: SIZE, height: SIZE, title: 'starforge' })

    setFrameDuration(sprite, sprite.frames[0]!.id, FRAME_MS)
    for (let at = 1; at < BEATS.length; at++) {
        insertFrame(sprite, createFrame(FRAME_MS), sprite.frames[at - 1]!.id)
    }

    const base = sprite.layers[0]!
    base.name = LAYERS[0]!.name

    for (const [index, spec] of LAYERS.entries()) {
        const layer = index === 0 ? base : createLayer(spec.name)
        if (index > 0) insertLayer(sprite, layer, sprite.layers[index - 1]!.id)

        for (const [at, beat] of BEATS.entries()) {
            spec.paint(openCursor(sprite, layer.id, sprite.frames[at]!.id), beat)
        }

        for (const [key, value] of Object.entries(spec.props ?? {})) {
            setLayerProp(sprite, layer.id, key as keyof LayerProps, value as never)
        }
    }

    const drawOn = sprite.layers.find((l) => l.name === DRAW_ON) ?? sprite.layers[0]!

    return { sprite, activeLayer: drawOn.id }
}

const STAR = starPolygon()
const FIELD = distanceField()

function starPolygon(): { x: number; y: number }[] {
    const points: { x: number; y: number }[] = []
    for (let k = 0; k < 10; k++) {
        const radius = k % 2 === 0 ? OUTER_RADIUS - ROUNDING : INNER_RADIUS - ROUNDING / 2
        const angle = -Math.PI / 2 + (k * Math.PI) / 5
        points.push({
            x: CENTRE_X + radius * Math.cos(angle),
            y: CENTRE_Y + radius * Math.sin(angle),
        })
    }
    return points
}

function distanceField(): Float32Array {
    const field = new Float32Array(SIZE * SIZE)
    forEachPixel((x, y) => {
        field[y * SIZE + x] = signedDistance(x + 0.5, y + 0.5)
    })
    return field
}

/* the star moves as one body, so the field is measured once and read back with the offset */
function distance(x: number, y: number, lift: number): number {
    const row = y + lift
    return row < 0 || row >= SIZE ? Infinity : FIELD[row * SIZE + x]!
}

function signedDistance(px: number, py: number): number {
    let nearest = Infinity
    let inside = false

    for (let i = 0, j = STAR.length - 1; i < STAR.length; j = i++) {
        const a = STAR[i]!
        const b = STAR[j]!
        nearest = Math.min(nearest, distanceToSegment(px, py, a.x, a.y, b.x, b.y))
        if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside
        }
    }

    return inside ? -nearest : nearest
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
    const dx = bx - ax
    const dy = by - ay
    const lengthSq = dx * dx + dy * dy
    const t = lengthSq === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1)

    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function paintStar(cursor: CelCursor, beat: Beat): void {
    forEachPixel((x, y) => {
        const sd = distance(x, y, beat.lift)
        if (sd > ROUNDING) return
        cursor.set(x, y, sd > ROUNDING - RIM_WIDTH ? RIM : BODY)
    })
}

function paintGlow(cursor: CelCursor, beat: Beat): void {
    forEachPixel((x, y) => {
        const beyond = distance(x, y, beat.lift) - ROUNDING
        if (beyond <= 0 || beyond > GLOW_WIDTH) return

        const falloff = 1 - beyond / GLOW_WIDTH
        cursor.set(x, y, withAlpha(mesh(x, y), Math.round(falloff * falloff * 150)))
    })
}

function paintShading(cursor: CelCursor, beat: Beat): void {
    forEachPixel((x, y) => {
        if (distance(x, y, beat.lift) > ROUNDING) return

        const axis = x - CENTRE_X + (y + beat.lift - CENTRE_Y)
        if (axis <= 2) return
        cursor.set(x, y, withAlpha(SHADOW, Math.round(clamp(axis / 16, 0, 1) * 255)))
    })
}

const EYES = [
    { x: CENTRE_X - 8, y: CENTRE_Y - 3 },
    { x: CENTRE_X + 7, y: CENTRE_Y - 5 },
] as const

function paintFace(cursor: CelCursor, beat: Beat): void {
    for (const eye of EYES) {
        const y = eye.y - beat.lift
        if (beat.blink) {
            for (let dx = -2; dx <= 2; dx++) cursor.set(eye.x + dx, y, INK)
            continue
        }
        disc(cursor, eye.x, y, 2.6, INK)
    }

    for (let dx = -4; dx <= 4; dx++) {
        const dip = Math.round(2.2 * (1 - (dx / 4) ** 2))
        cursor.set(CENTRE_X - 1 + dx, CENTRE_Y + 3 + dip - beat.lift, INK)
    }
}

function paintSparkles(cursor: CelCursor, beat: Beat): void {
    for (const [index, ink] of ORBIT.entries()) {
        const angle = (beat.turn + index / ORBIT.length) * Math.PI * 2
        const x = Math.round(CENTRE_X + ORBIT_X * Math.cos(angle))
        const y = Math.round(CENTRE_Y + ORBIT_Y * Math.sin(angle))

        for (let i = 1; i <= SPARK_ARM; i++) {
            const fade = withAlpha(ink, Math.round(255 * (1 - (i - 1) / (SPARK_ARM + 1))))
            cursor.set(x - i, y, fade)
            cursor.set(x + i, y, fade)
            cursor.set(x, y - i, fade)
            cursor.set(x, y + i, fade)
        }
        cursor.set(x, y, SPARK_CORE)
    }
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const SEAM = 0.12

/*
 * A blend would leave the palette, and dithering all four corners at once turns the halo
 * into noise. Each pixel takes the corner that owns it, and only the seam between the two
 * nearest corners is dithered.
 */
function mesh(x: number, y: number): RGBA {
    const u = x / (SIZE - 1)
    const v = y / (SIZE - 1)
    const weights = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v]

    const [best, second] = [0, 1, 2, 3].sort((a, b) => weights[b]! - weights[a]!) as [
        number,
        number,
    ]
    const gap = weights[best]! - weights[second]!
    if (gap >= SEAM) return MESH[best]!

    const threshold = (BAYER[(y % 4) * 4 + (x % 4)]! + 0.5) / BAYER.length
    return MESH[threshold < 0.5 + (gap / SEAM) * 0.5 ? best : second]!
}

function forEachPixel(visit: (x: number, y: number) => void): void {
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) visit(x, y)
    }
}

function disc(cursor: CelCursor, cx: number, cy: number, radius: number, color: RGBA): void {
    const r = Math.ceil(radius)
    for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
            if (Math.hypot(dx, dy) <= radius) cursor.set(cx + dx, cy + dy, color)
        }
    }
}

function withAlpha(color: RGBA, alpha: number): RGBA {
    return ((color & 0xffffff00) | (alpha & 0xff)) >>> 0
}

function clamp(value: number, low: number, high: number): number {
    return value < low ? low : value > high ? high : value
}
