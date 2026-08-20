import { normalizeName } from './text'

export type BlendMode =
    'normal' | 'multiply' | 'screen' | 'overlay' | 'additive' | 'darken' | 'lighten'

export const BLEND_MODES: readonly BlendMode[] = [
    'normal',
    'multiply',
    'screen',
    'overlay',
    'darken',
    'lighten',
    'additive',
]

export interface Sprite {
    id: string

    /* 16..1024 */
    width: number
    height: number

    layers: Layer[]
    frames: Frame[]

    palette: Palette

    meta: SpriteMeta
    revision: number
}

export interface SpriteMeta {
    title: string
    createdAt: string
    updatedAt: string
}

export interface Layer {
    id: string
    name: string

    /* 0..255 */
    opacity: number
    blendMode: BlendMode

    visible: boolean
    locked: boolean

    cels: Map<string, Cel>
}

export interface Cel {
    /* cel offset in sprite space. always (0,0) until move */
    x: number
    y: number

    /* RGBA, width*height*4 (~ 256kb at 256^2) */
    pixels: Uint8Array<ArrayBuffer>
    version: number
}

export interface Frame {
    id: string
    /* display time in ms */
    duration: number
}

export interface Palette {
    name: string
    colors: string[]
}

export const SPRITE_MIN_SIZE = 16
export const SPRITE_MAX_SIZE = 1024

export const DEFAULT_FRAME_DURATION = 100

export const PALETTE_MAX_COLORS = 4_096
export const SPRITE_TITLE_MAX = 64

export function normalizeSpriteTitle(title: string): string {
    return normalizeName(title, SPRITE_TITLE_MAX)
}

export const DEFAULT_PALETTE: Palette = {
    name: 'Starforge',

    colors: [
        '#0b0b12',
        '#161626',
        '#241b3d',
        '#3b2160',
        '#7b2fbf',
        '#c33bd4',
        '#ff4fd8',
        '#ff8fab',
        '#26c9ff',
        '#6ee7ff',
        '#b6f6ff',
        '#ffd166',
        '#ffe564',
        '#fff3b0',
        '#ffffff',
        '#8892b0',
    ],
}

export interface SpriteInit {
    width: number
    height: number
    title?: string
    id?: string
}

export function createSprite(init: SpriteInit): Sprite {
    const now = new Date().toISOString()

    return {
        id: init.id ?? newId(),

        width: checkSize(init.width, 'width'),
        height: checkSize(init.height, 'height'),

        layers: [createLayer('Layer 1')],
        frames: [createFrame()],

        palette: { name: DEFAULT_PALETTE.name, colors: [...DEFAULT_PALETTE.colors] },

        meta: {
            title: normalizeSpriteTitle(init.title ?? '') || 'Untitled',
            createdAt: now,
            updatedAt: now,
        },
        revision: 0,
    }
}

export function createLayer(name: string, id: string = newId()): Layer {
    return {
        id,
        name,

        opacity: 255,
        blendMode: 'normal',

        visible: true,
        locked: false,

        cels: new Map(),
    }
}

export function createFrame(
    duration: number = DEFAULT_FRAME_DURATION,
    id: string = newId(),
): Frame {
    return { id, duration }
}

function newId(): string {
    return (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID()
}

function checkSize(value: number, axis: 'width' | 'height'): number {
    if (!Number.isInteger(value) || value < SPRITE_MIN_SIZE || value > SPRITE_MAX_SIZE)
        throw new RangeError(
            `sprite ${axis} must be an integer in ${SPRITE_MIN_SIZE}..${SPRITE_MAX_SIZE}, got ${value}`,
        )

    return value
}

export function getLayer(sprite: Sprite, layerId: string): Layer {
    const layer = sprite.layers.find((l) => l.id === layerId)
    if (!layer) throw new Error(`unknown layer: ${layerId}`)

    return layer
}

export function getFrame(sprite: Sprite, frameId: string): Frame {
    const frame = sprite.frames.find((f) => f.id === frameId)
    if (!frame) throw new Error(`unknown frame: ${frameId}`)

    return frame
}

export function getCel(sprite: Sprite, layerId: string, frameId: string): Cel | undefined {
    getFrame(sprite, frameId)
    return getLayer(sprite, layerId).cels.get(frameId)
}

export function inBounds(sprite: Sprite, x: number, y: number): boolean {
    return (
        Number.isInteger(x) &&
        Number.isInteger(y) &&
        x >= 0 &&
        y >= 0 &&
        x < sprite.width &&
        y < sprite.height
    )
}
