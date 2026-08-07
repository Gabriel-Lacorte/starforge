import type { Command, DirtyRect, Sprite } from '@starforge/core'
import { UndoStack } from '../editor/undoStack'

export type Change =
    { kind: 'pixels'; layer: string; frame: string; rect: DirtyRect } | { kind: 'structure' }

export class DocumentSession {
    readonly doc: Sprite
    readonly author: string

    readonly #undo = new UndoStack()
    readonly #listeners = new Set<(change: Change) => void>()

    constructor(doc: Sprite, author: string = crypto.randomUUID()) {
        this.doc = doc
        this.author = author
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
        const record = this.#undo.push(command)
        if (record) this.#emitPixels(record.layer, record.frame, record.rect)
    }

    undo(): void {
        const record = this.#undo.undo(this.doc)
        if (record) this.#emitPixels(record.layer, record.frame, record.rect)
    }

    redo(): void {
        const record = this.#undo.redo(this.doc)
        if (record) this.#emitPixels(record.layer, record.frame, record.rect)
    }

    #emitPixels(layer: string, frame: string, rect: DirtyRect): void {
        const change: Change = { kind: 'pixels', layer, frame, rect }
        for (const listener of this.#listeners) listener(change)
    }
}
