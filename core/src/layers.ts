import { createLayer, getLayer, type Layer, type Sprite } from './doc'
import { normalizeName } from './text'

export type LayerProps = Pick<Layer, 'name' | 'opacity' | 'blendMode' | 'visible' | 'locked'>

export const LAYER_NAME_MAX = 64

export function normalizeLayerName(name: string): string {
    return normalizeName(name, LAYER_NAME_MAX)
}

export function insertLayer(sprite: Sprite, layer: Layer, after: string | null): void {
    if (sprite.layers.some((l) => l.id === layer.id)) {
        throw new Error(`layer already present: ${layer.id}`)
    }

    const index = after === null ? 0 : indexOfLayer(sprite, after) + 1
    sprite.layers.splice(index, 0, layer)
    sprite.revision++
}

export function removeLayer(sprite: Sprite, id: string): { layer: Layer; index: number } | null {
    const index = indexOfLayer(sprite, id)

    if (sprite.layers.length <= 1) return null
    const [layer] = sprite.layers.splice(index, 1)
    sprite.revision++

    return { layer: layer!, index }
}

export function restoreLayer(sprite: Sprite, layer: Layer, index: number): void {
    if (sprite.layers.some((l) => l.id === layer.id)) {
        throw new Error(`layer already present: ${layer.id}`)
    }
    if (!Number.isInteger(index) || index < 0 || index > sprite.layers.length) {
        throw new RangeError(`restore index out of range: ${index}`)
    }
    sprite.layers.splice(index, 0, layer)
    sprite.revision++
}

export function moveLayer(
    sprite: Sprite,
    id: string,
    after: string | null,
): { after: string | null } | null {
    if (after === id) {
        throw new Error(`cannot move layer above itself: ${id}`)
    }

    const from = indexOfLayer(sprite, id)

    if (after !== null) indexOfLayer(sprite, after)
    const previous = from === 0 ? null : sprite.layers[from - 1]!.id
    if (after === previous) return null

    const [layer] = sprite.layers.splice(from, 1)
    const to = after === null ? 0 : sprite.layers.findIndex((l) => l.id === after) + 1
    sprite.layers.splice(to, 0, layer!)

    sprite.revision++
    return { after: previous }
}

const VALIDATORS: { [K in keyof LayerProps]?: (value: LayerProps[K]) => void } = {
    opacity: (value) => {
        if (!Number.isInteger(value) || value < 0 || value > 255) {
            throw new RangeError(`opacity must be an integer in 0..255, got ${value}`)
        }
    },
}

export function setLayerProp<K extends keyof LayerProps>(
    sprite: Sprite,
    id: string,
    key: K,
    value: LayerProps[K],
): LayerProps[K] | null {
    VALIDATORS[key]?.(value)

    const props: LayerProps = getLayer(sprite, id)
    const previous = props[key]

    if (previous === value) return null
    props[key] = value

    sprite.revision++
    return previous
}

export function cloneLayer(sprite: Sprite, id: string, newId?: string): Layer {
    const source = getLayer(sprite, id)
    const copy = createLayer(`${source.name} copy`, newId)

    copy.opacity = source.opacity
    copy.blendMode = source.blendMode
    copy.visible = source.visible
    copy.locked = source.locked
    for (const [frameId, cel] of source.cels) {
        copy.cels.set(frameId, {
            x: cel.x,
            y: cel.y,
            pixels: new Uint8Array(cel.pixels),
            version: 0,
        })
    }

    return copy
}

function indexOfLayer(sprite: Sprite, id: string): number {
    const index = sprite.layers.findIndex((l) => l.id === id)
    if (index === -1) {
        throw new Error(`unknown layer: ${id}`)
    }

    return index
}
