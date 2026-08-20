import {
    applyOperation,
    type ChangeSet,
    type DocumentOperation,
    type Sprite,
} from '@starforge/core'

const CELL_BYTES = 12
const ENTRY_OVERHEAD = 256

export const DEFAULT_MAX_ENTRIES = 100
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024

export interface UndoLimits {
    maxEntries?: number
    maxBytes?: number
}

export class OperationEntry {
    readonly label: string
    readonly bytes: number

    #forward: DocumentOperation
    #backward: DocumentOperation

    constructor(label: string, forward: DocumentOperation, backward: DocumentOperation) {
        this.label = label
        this.#forward = forward
        this.#backward = backward
        this.bytes = entryBytes(forward, backward)
    }

    undo(doc: Sprite): ChangeSet {
        const result = applyOperation(doc, this.#backward)
        this.#forward = result.inverse

        return result.change
    }

    redo(doc: Sprite): ChangeSet {
        const result = applyOperation(doc, this.#forward)
        this.#backward = result.inverse

        return result.change
    }
}

export class UndoStack {
    readonly #maxEntries: number
    readonly #maxBytes: number
    #undo: OperationEntry[] = []
    #redo: OperationEntry[] = []
    #bytes = 0

    constructor(limits?: UndoLimits) {
        this.#maxEntries = limits?.maxEntries ?? DEFAULT_MAX_ENTRIES
        this.#maxBytes = limits?.maxBytes ?? DEFAULT_MAX_BYTES
    }

    get canUndo(): boolean {
        return this.#undo.length > 0
    }

    get canRedo(): boolean {
        return this.#redo.length > 0
    }

    get bytes(): number {
        return this.#bytes
    }

    push(entry: OperationEntry): void {
        for (const dropped of this.#redo) this.#bytes -= dropped.bytes
        this.#redo.length = 0
        this.#undo.push(entry)
        this.#bytes += entry.bytes

        while (
            this.#undo.length > 1 &&
            (this.#undo.length > this.#maxEntries || this.#bytes > this.#maxBytes)
        ) {
            this.#bytes -= this.#undo.shift()!.bytes
        }
    }

    undo(doc: Sprite): ChangeSet | null {
        const entry = this.#undo.pop()
        if (!entry) return null

        const change = entry.undo(doc)
        this.#redo.push(entry)

        return change
    }

    redo(doc: Sprite): ChangeSet | null {
        const entry = this.#redo.pop()
        if (!entry) return null

        const change = entry.redo(doc)
        this.#undo.push(entry)

        return change
    }
}

function entryBytes(forward: DocumentOperation, backward: DocumentOperation): number {
    if (forward.kind === 'pixel.patch') return forward.xs.length * CELL_BYTES + ENTRY_OVERHEAD

    return (
        ENTRY_OVERHEAD +
        detachedLayerBytes(forward) +
        detachedLayerBytes(backward) +
        keptDocumentBytes(forward) +
        keptDocumentBytes(backward)
    )
}

function keptDocumentBytes(operation: DocumentOperation): number {
    if (operation.kind !== 'document.restore') return 0

    let bytes = 0
    for (const cel of operation.cels) bytes += cel.pixels.byteLength

    return bytes
}

function detachedLayerBytes(operation: DocumentOperation): number {
    if (operation.kind !== 'layer.add') return 0

    let bytes = 0
    for (const cel of operation.layer.cels.values()) bytes += cel.pixels.byteLength

    return bytes
}
