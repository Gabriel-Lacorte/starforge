import {
    createLayer,
    createSprite,
    hexToRgba,
    insertLayer,
    openCursor,
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

const BODY = hexToRgba('#ffe564')
const RIM = hexToRgba('#fff3b0')
const SHADOW = hexToRgba('#ffd166')
const GLOW = hexToRgba('#ffd166')
const INK = hexToRgba('#241b3d')
const SPARK_CORE = hexToRgba('#ffffff')
const SPARK_ARM = hexToRgba('#b6f6ff')

interface LayerSpec {
    name: string
    props?: Partial<LayerProps>
    paint: (cursor: CelCursor) => void
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
    const frame = sprite.frames[0]!.id

    const base = sprite.layers[0]!
    base.name = LAYERS[0]!.name

    for (const [index, spec] of LAYERS.entries()) {
        const layer = index === 0 ? base : createLayer(spec.name)
        if (index > 0) insertLayer(sprite, layer, sprite.layers[index - 1]!.id)

        spec.paint(openCursor(sprite, layer.id, frame))

        for (const [key, value] of Object.entries(spec.props ?? {})) {
            setLayerProp(sprite, layer.id, key as keyof LayerProps, value as never)
        }
    }

    const drawOn = sprite.layers.find((l) => l.name === DRAW_ON) ?? sprite.layers[0]!

    return { sprite, activeLayer: drawOn.id }
}

const STAR = starPolygon()

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

function paintStar(cursor: CelCursor): void {
    forEachPixel((x, y) => {
        const sd = signedDistance(x + 0.5, y + 0.5)
        if (sd > ROUNDING) return
        cursor.set(x, y, sd > ROUNDING - RIM_WIDTH ? RIM : BODY)
    })
}

function paintGlow(cursor: CelCursor): void {
    forEachPixel((x, y) => {
        const sd = signedDistance(x + 0.5, y + 0.5)
        const beyond = sd - ROUNDING
        if (beyond <= 0 || beyond > GLOW_WIDTH) return

        const falloff = 1 - beyond / GLOW_WIDTH
        cursor.set(x, y, withAlpha(GLOW, Math.round(falloff * falloff * 150)))
    })
}

function paintShading(cursor: CelCursor): void {
    forEachPixel((x, y) => {
        const sd = signedDistance(x + 0.5, y + 0.5)
        if (sd > ROUNDING) return

        const axis = x - CENTRE_X + (y - CENTRE_Y)
        if (axis <= 2) return
        cursor.set(x, y, withAlpha(SHADOW, Math.round(clamp(axis / 16, 0, 1) * 255)))
    })
}

function paintFace(cursor: CelCursor): void {
    disc(cursor, CENTRE_X - 8, CENTRE_Y - 3, 2.6, INK)
    disc(cursor, CENTRE_X + 7, CENTRE_Y - 5, 2.6, INK)

    for (let dx = -4; dx <= 4; dx++) {
        const dip = Math.round(2.2 * (1 - (dx / 4) ** 2))
        cursor.set(CENTRE_X - 1 + dx, CENTRE_Y + 3 + dip, INK)
    }
}

function paintSparkles(cursor: CelCursor): void {
    for (const [x, y, arm] of [
        [11, 13, 3],
        [53, 18, 2],
        [50, 50, 3],
        [15, 47, 2],
        [33, 6, 2],
    ] as const) {
        for (let i = 1; i <= arm; i++) {
            const fade = withAlpha(SPARK_ARM, Math.round(255 * (1 - (i - 1) / (arm + 1))))
            cursor.set(x - i, y, fade)
            cursor.set(x + i, y, fade)
            cursor.set(x, y - i, fade)
            cursor.set(x, y + i, fade)
        }
        cursor.set(x, y, SPARK_CORE)
    }
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
