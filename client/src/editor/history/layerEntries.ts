import {
    cloneLayer,
    insertLayer,
    moveLayer,
    removeLayer,
    restoreLayer,
    setLayerProp,
    type Layer,
    type LayerProps,
    type Sprite,
} from '@starforge/core'
import type { Change, UndoEntry } from './undoStack'

const STRUCTURE: Change = { kind: 'structure' }
const STRUCT_BYTES = 64

export class AddLayerEntry implements UndoEntry {
    readonly label = 'add layer'
    readonly bytes = STRUCT_BYTES

    readonly #layer: Layer
    readonly #after: string | null

    constructor(layer: Layer, after: string | null) {
        this.#layer = layer
        this.#after = after
    }

    get layerId(): string {
        return this.#layer.id
    }

    redo(doc: Sprite): Change {
        insertLayer(doc, this.#layer, this.#after)
        return STRUCTURE
    }

    undo(doc: Sprite): Change {
        const removed = removeLayer(doc, this.#layer.id)
        if (!removed) throw new Error('history divergence: add-layer undo met the last layer')

        return { kind: 'structure', removedLayerIndex: removed.index }
    }
}

/**
 * Removing is free to undo, the entry holds the detached layer object itself,
 * so its cels were already allocated and nothing is copied.
 */
export class RemoveLayerEntry implements UndoEntry {
    readonly #id: string
    readonly label = 'remove layer'
    readonly bytes = STRUCT_BYTES

    #layer: Layer | null = null
    #index = -1

    constructor(id: string) {
        this.#id = id
    }

    redo(doc: Sprite): Change {
        const removed = removeLayer(doc, this.#id)
        if (!removed) throw new Error('cannot remove the last layer')

        this.#layer = removed.layer
        this.#index = removed.index

        return { kind: 'structure', removedLayerIndex: removed.index }
    }

    undo(doc: Sprite): Change {
        if (!this.#layer) throw new Error('history divergence: remove-layer undo before redo')
        restoreLayer(doc, this.#layer, this.#index)
        return STRUCTURE
    }
}

/**
 * The clone is built once, at construction, redo/undo only attach/detach it.
 *
 * Reporting only STRUCT_BYTES would hide megabytes from the
 * stack's byte budget, so the pixels are counted here.
 */
export class DuplicateLayerEntry implements UndoEntry {
    readonly label = 'duplicate layer'
    readonly bytes: number

    readonly #copy: Layer
    readonly #after: string

    constructor(doc: Sprite, sourceId: string) {
        this.#copy = cloneLayer(doc, sourceId)
        this.#after = sourceId

        let bytes = STRUCT_BYTES
        for (const cel of this.#copy.cels.values()) bytes += cel.pixels.byteLength
        this.bytes = bytes
    }

    get layerId(): string {
        return this.#copy.id
    }

    redo(doc: Sprite): Change {
        insertLayer(doc, this.#copy, this.#after)
        return STRUCTURE
    }

    undo(doc: Sprite): Change {
        const removed = removeLayer(doc, this.#copy.id)
        if (!removed) throw new Error('history divergence: duplicate undo met the last layer')

        return { kind: 'structure', removedLayerIndex: removed.index }
    }
}

export class MoveLayerEntry implements UndoEntry {
    readonly #id: string
    readonly label = 'move layer'
    readonly bytes = STRUCT_BYTES

    readonly #to: string | null
    #from: string | null = null
    #applied = false

    constructor(id: string, to: string | null) {
        this.#id = id
        this.#to = to
    }

    redo(doc: Sprite): Change {
        const previous = moveLayer(doc, this.#id, this.#to)
        if (!previous) throw new Error('history divergence: move-layer was a no-op')
        if (!this.#applied) {
            this.#from = previous.after
            this.#applied = true
        }
        return STRUCTURE
    }

    undo(doc: Sprite): Change {
        moveLayer(doc, this.#id, this.#from)
        return STRUCTURE
    }
}

export class SetLayerPropEntry<K extends keyof LayerProps> implements UndoEntry {
    readonly label: string
    readonly bytes = STRUCT_BYTES
    readonly #id: string
    readonly #key: K
    readonly #before: LayerProps[K]
    readonly #after: LayerProps[K]

    constructor(id: string, key: K, before: LayerProps[K], after: LayerProps[K]) {
        this.label = `layer ${key}`
        this.#id = id
        this.#key = key
        this.#before = before
        this.#after = after
    }

    redo(doc: Sprite): Change {
        setLayerProp(doc, this.#id, this.#key, this.#after)
        return STRUCTURE
    }

    undo(doc: Sprite): Change {
        setLayerProp(doc, this.#id, this.#key, this.#before)
        return STRUCTURE
    }
}
