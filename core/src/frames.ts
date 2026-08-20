import { type Cel, type Frame, type Sprite } from './doc'

export const FRAME_DURATION_MIN = 1
export const FRAME_DURATION_MAX = 60_000

export interface FrameCel {
    readonly layer: string
    readonly cel: Cel
}

export function indexOfFrame(sprite: Sprite, id: string): number {
    const index = sprite.frames.findIndex((frame) => frame.id === id)
    if (index === -1) throw new Error(`unknown frame: ${id}`)

    return index
}

export function insertFrame(
    sprite: Sprite,
    frame: Frame,
    after: string | null,
    cels: readonly FrameCel[] = [],
): void {
    if (sprite.frames.some((candidate) => candidate.id === frame.id)) {
        throw new Error(`frame already present: ${frame.id}`)
    }

    const index = after === null ? 0 : indexOfFrame(sprite, after) + 1
    sprite.frames.splice(index, 0, frame)

    for (const entry of cels) {
        const layer = sprite.layers.find((candidate) => candidate.id === entry.layer)
        layer?.cels.set(frame.id, entry.cel)
    }

    sprite.revision++
}

export interface RemovedFrame {
    readonly frame: Frame
    readonly cels: readonly FrameCel[]
    readonly after: string | null
}

export function removeFrame(sprite: Sprite, id: string): RemovedFrame | null {
    const index = indexOfFrame(sprite, id)
    if (sprite.frames.length <= 1) return null

    const after = index === 0 ? null : sprite.frames[index - 1]!.id
    const [frame] = sprite.frames.splice(index, 1)

    const cels: FrameCel[] = []
    for (const layer of sprite.layers) {
        const cel = layer.cels.get(id)
        if (!cel) continue

        cels.push({ layer: layer.id, cel })
        layer.cels.delete(id)
    }

    sprite.revision++
    return { frame: frame!, cels, after }
}

export function moveFrame(
    sprite: Sprite,
    id: string,
    after: string | null,
): { after: string | null } | null {
    if (after === id) throw new Error(`cannot move a frame after itself: ${id}`)

    const from = indexOfFrame(sprite, id)
    if (after !== null) indexOfFrame(sprite, after)

    const previous = from === 0 ? null : sprite.frames[from - 1]!.id
    if (after === previous) return null

    const [frame] = sprite.frames.splice(from, 1)
    const to = after === null ? 0 : sprite.frames.findIndex((f) => f.id === after) + 1
    sprite.frames.splice(to, 0, frame!)

    sprite.revision++
    return { after: previous }
}

export function setFrameDuration(sprite: Sprite, id: string, duration: number): number | null {
    if (
        !Number.isInteger(duration) ||
        duration < FRAME_DURATION_MIN ||
        duration > FRAME_DURATION_MAX
    ) {
        throw new RangeError(
            `frame duration must be an integer in ${FRAME_DURATION_MIN}..${FRAME_DURATION_MAX}, got ${String(duration)}`,
        )
    }

    const frame = sprite.frames[indexOfFrame(sprite, id)]!
    const previous = frame.duration
    if (previous === duration) return null

    frame.duration = duration
    sprite.revision++

    return previous
}

export function copyFrameCels(sprite: Sprite, id: string): readonly FrameCel[] {
    const cels: FrameCel[] = []
    for (const layer of sprite.layers) {
        const cel = layer.cels.get(id)
        if (!cel) continue

        cels.push({
            layer: layer.id,
            cel: { x: cel.x, y: cel.y, pixels: new Uint8Array(cel.pixels), version: 0 },
        })
    }

    return cels
}
