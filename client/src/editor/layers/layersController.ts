import { createLayer, getLayer, setLayerProp, type LayerProps, type Sprite } from '@starforge/core'
import type { DocumentSession } from '../../document/session'
import {
    AddLayerEntry,
    DuplicateLayerEntry,
    MoveLayerEntry,
    RemoveLayerEntry,
    SetLayerPropEntry,
} from '../history/layerEntries'
import { Store, type EditorStore } from '../store'

const NUMBERED = /^Layer (\d+)$/

function nextLayerName(sprite: Sprite): string {
    let highest = 0
    for (const layer of sprite.layers) {
        const match = NUMBERED.exec(layer.name)
        if (match) highest = Math.max(highest, Number(match[1]))
    }

    return `Layer ${highest + 1}`
}

export function ensureActiveLayer(sprite: Sprite, store: EditorStore, removedIndex?: number): void {
    const layers = sprite.layers
    if (layers.some((l) => l.id === store.state.activeLayer)) return

    const fallback = layers[Math.min(removedIndex ?? layers.length - 1, layers.length - 1)]
    if (fallback) store.patch({ activeLayer: fallback.id })
}

export class LayersController extends Store<{ doc: number }> {
    readonly #sprite: Sprite
    readonly #session: DocumentSession
    readonly #store: EditorStore
    readonly #unsubscribe: () => void
    #beforeStructural: (() => void) | null = null

    constructor(sprite: Sprite, session: DocumentSession, store: EditorStore) {
        super({ doc: 0 })
        this.#sprite = sprite
        this.#session = session
        this.#store = store
        this.#unsubscribe = session.subscribe((change) => {
            if (change.kind === 'structure') {
                ensureActiveLayer(sprite, store, change.removedLayerIndex)
            }
            this.patch({ doc: this.state.doc + 1 })
        })
    }

    dispose(): void {
        this.#unsubscribe()
    }

    setBeforeStructural(guard: () => void): void {
        this.#beforeStructural = guard
    }

    add(): void {
        this.#guard()
        const layer = createLayer(nextLayerName(this.#sprite))
        this.#session.apply(new AddLayerEntry(layer, this.#store.state.activeLayer))
        this.#store.patch({ activeLayer: layer.id })
    }

    remove(id: string): void {
        if (this.#sprite.layers.length <= 1) return

        this.#guard()
        this.#session.apply(new RemoveLayerEntry(id))
    }

    duplicate(id: string): void {
        this.#guard()
        const entry = new DuplicateLayerEntry(this.#sprite, id)
        this.#session.apply(entry)
        this.#store.patch({ activeLayer: entry.layerId })
    }

    moveUp(id: string): void {
        const index = this.#indexOf(id)
        const above = this.#sprite.layers[index + 1]
        if (!above) return

        this.#guard()
        this.#session.apply(new MoveLayerEntry(id, above.id))
    }

    moveDown(id: string): void {
        const index = this.#indexOf(id)
        if (index === 0) return

        this.#guard()
        this.#session.apply(new MoveLayerEntry(id, this.#sprite.layers[index - 2]?.id ?? null))
    }

    setActive(id: string): void {
        if (id === this.#store.state.activeLayer) return

        this.#guard()
        this.#store.patch({ activeLayer: id })
    }

    rename(id: string, name: string): void {
        const trimmed = name.trim()
        const before = getLayer(this.#sprite, id).name
        if (!trimmed || trimmed === before) return

        this.#session.apply(new SetLayerPropEntry(id, 'name', before, trimmed))
    }

    toggleVisible(id: string): void {
        const before = getLayer(this.#sprite, id).visible
        this.#session.apply(new SetLayerPropEntry(id, 'visible', before, !before))
    }

    toggleLocked(id: string): void {
        this.#guard()
        const before = getLayer(this.#sprite, id).locked
        this.#session.apply(new SetLayerPropEntry(id, 'locked', before, !before))
    }

    setBlendMode(id: string, mode: LayerProps['blendMode']): void {
        const before = getLayer(this.#sprite, id).blendMode
        if (mode === before) return

        this.#session.apply(new SetLayerPropEntry(id, 'blendMode', before, mode))
    }

    previewOpacity(id: string, value: number): void {
        if (setLayerProp(this.#sprite, id, 'opacity', value) !== null) {
            this.#session.notifyStructure()
        }
    }

    commitOpacity(id: string, before: number, value: number): void {
        if (before === value) return
        this.#session.apply(new SetLayerPropEntry(id, 'opacity', before, value))
    }

    #guard(): void {
        this.#beforeStructural?.()
    }

    #indexOf(id: string): number {
        const index = this.#sprite.layers.findIndex((l) => l.id === id)
        if (index === -1) throw new Error(`unknown layer: ${id}`)
        return index
    }
}
