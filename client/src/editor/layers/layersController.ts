import {
    cloneLayer,
    createLayer,
    layerSet,
    normalizeLayerName,
    type Layer,
    type LayerProps,
    type Sprite,
} from '@starforge/core'
import type { DocumentSession } from '../../document/session'
import { Store } from '../../store'

const NUMBERED = /^Layer (\d+)$/

function nextLayerName(sprite: Sprite): string {
    let highest = 0
    for (const layer of sprite.layers) {
        const match = NUMBERED.exec(layer.name)
        if (match) highest = Math.max(highest, Number(match[1]))
    }

    return `Layer ${highest + 1}`
}

function isOpacity(value: number): boolean {
    return Number.isInteger(value) && value >= 0 && value <= 255
}

export class LayersController extends Store<{ doc: number }> {
    readonly #sprite: Sprite
    readonly #session: DocumentSession
    readonly #unsubscribe: () => void

    constructor(sprite: Sprite, session: DocumentSession) {
        super({ doc: 0 })
        this.#sprite = sprite
        this.#session = session
        this.#unsubscribe = session.subscribe(() => {
            this.patch({ doc: this.state.doc + 1 })
        })
    }

    dispose(): void {
        this.#unsubscribe()
    }

    get active(): string {
        return this.#session.target.state.layer
    }

    add(): void {
        const layer = createLayer(nextLayerName(this.#sprite))
        this.#session.apply('add layer', { kind: 'layer.add', layer, after: this.active })
        this.#session.setTarget({ layer: layer.id })
    }

    remove(id: string): void {
        if (this.#sprite.layers.length <= 1 || !this.#find(id)) return

        this.#session.apply('remove layer', { kind: 'layer.remove', layer: id })
    }

    duplicate(id: string): void {
        if (!this.#find(id)) return

        const copy = cloneLayer(this.#sprite, id)
        this.#session.apply('duplicate layer', { kind: 'layer.add', layer: copy, after: id })
        this.#session.setTarget({ layer: copy.id })
    }

    moveUp(id: string): void {
        const index = this.#indexOf(id)
        const above = this.#sprite.layers[index + 1]
        if (index === -1 || !above) return

        this.#session.apply('move layer', { kind: 'layer.move', layer: id, after: above.id })
    }

    moveDown(id: string): void {
        const index = this.#indexOf(id)
        if (index <= 0) return

        this.#session.apply('move layer', {
            kind: 'layer.move',
            layer: id,
            after: this.#sprite.layers[index - 2]?.id ?? null,
        })
    }

    setActive(id: string): void {
        this.#session.setTarget({ layer: id })
    }

    rename(id: string, name: string): void {
        const layer = this.#find(id)
        if (!layer) return

        const next = normalizeLayerName(name)
        if (!next || next === layer.name) return

        this.#session.apply('layer name', layerSet(id, 'name', next))
    }

    toggleVisible(id: string): void {
        const layer = this.#find(id)
        if (!layer) return

        this.#session.apply('layer visible', layerSet(id, 'visible', !layer.visible))
    }

    toggleLocked(id: string): void {
        const layer = this.#find(id)
        if (!layer) return

        this.#session.apply('layer locked', layerSet(id, 'locked', !layer.locked))
    }

    setBlendMode(id: string, mode: LayerProps['blendMode']): void {
        const layer = this.#find(id)
        if (!layer || mode === layer.blendMode) return

        this.#session.apply('layer blendMode', layerSet(id, 'blendMode', mode))
    }

    previewOpacity(id: string, value: number): void {
        if (!this.#find(id) || !isOpacity(value)) return

        this.#session.applyTransient(layerSet(id, 'opacity', value))
    }

    commitOpacity(id: string, before: number, value: number): void {
        if (before === value || !this.#find(id) || !isOpacity(before) || !isOpacity(value)) return

        this.#session.applyTransient(layerSet(id, 'opacity', before))
        this.#session.apply('layer opacity', layerSet(id, 'opacity', value))
    }

    #find(id: string): Layer | null {
        return this.#sprite.layers.find((l) => l.id === id) ?? null
    }

    #indexOf(id: string): number {
        return this.#sprite.layers.findIndex((l) => l.id === id)
    }
}
