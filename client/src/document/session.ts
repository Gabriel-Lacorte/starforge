import type { Command, Sprite } from '@starforge/core'
import {
    StrokeRecord,
    UndoStack,
    type Change,
    type UndoEntry,
    type UndoLimits,
} from '../editor/history/undoStack'

export type { Change } from '../editor/history/undoStack'

export class DocumentSession {
    readonly doc: Sprite
    readonly author: string

    readonly #undo: UndoStack
    readonly #listeners = new Set<(change: Change) => void>()

    constructor(doc: Sprite, author: string = crypto.randomUUID(), limits?: UndoLimits) {
        this.doc = doc
        this.author = author
        this.#undo = new UndoStack(limits)
    }

    get canUndo(): boolean {
        return this.#undo.canUndo
    }

    get canRedo(): boolean {
        return this.#undo.canRedo
    }

    subscribe(listener: (change: Change) => void): () => void {
        this.#listeners.add(listener)
        return () => this.#listeners.delete(listener)
    }

    commit(command: Command): void {
        const record = StrokeRecord.from(command)
        if (!record) return

        this.#undo.push(record)
        this.#emit({ kind: 'pixels', layer: record.layer, frame: record.frame, rect: record.rect })
    }

    apply(entry: UndoEntry): void {
        const change = entry.redo(this.doc)
        this.#undo.push(entry)
        this.#emit(change)
    }

    notifyStructure(): void {
        this.#emit({ kind: 'structure' })
    }

    undo(): void {
        const change = this.#undo.undo(this.doc)
        if (change) this.#emit(change)
    }

    redo(): void {
        const change = this.#undo.redo(this.doc)
        if (change) this.#emit(change)
    }

    #emit(change: Change): void {
        for (const listener of this.#listeners) listener(change)
    }
}
