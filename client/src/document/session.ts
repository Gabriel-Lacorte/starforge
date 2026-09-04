import {
    applyOperation,
    normalizeSpriteTitle,
    pixelPatchFrom,
    resolveProjectWorkspace,
    type ChangeSet,
    type Command,
    type DocumentOperation,
    type Sprite,
} from '@starforge/core'
import { OperationEntry, UndoStack, type UndoLimits } from '../editor/history/undoStack'
import { Store, type EditTarget } from '../store'

export type { ChangeSet } from '@starforge/core'
export type { EditTarget } from '../store'

export interface SessionOptions {
    readonly target?: Partial<EditTarget>
    readonly author?: string
    readonly undo?: UndoLimits
}

export class DocumentSession {
    readonly doc: Sprite
    readonly author: string
    readonly target: Store<EditTarget>

    readonly #undo: UndoStack
    readonly #listeners = new Set<(change: ChangeSet) => void>()
    readonly #operationListeners = new Set<
        (operation: DocumentOperation, origin: 'local' | 'remote') => void
    >()
    #beforeChange: (() => void) | null = null

    constructor(doc: Sprite, options: SessionOptions = {}) {
        this.doc = doc
        this.author = options.author ?? crypto.randomUUID()
        this.target = new Store(resolveTarget(doc, options.target))
        this.#undo = new UndoStack(options.undo)
    }

    get canUndo(): boolean {
        return this.#undo.canUndo
    }

    get canRedo(): boolean {
        return this.#undo.canRedo
    }

    subscribe(listener: (change: ChangeSet) => void): () => void {
        this.#listeners.add(listener)
        return () => this.#listeners.delete(listener)
    }

    onOperation(
        listener: (operation: DocumentOperation, origin: 'local' | 'remote') => void,
    ): () => void {
        this.#operationListeners.add(listener)
        return () => this.#operationListeners.delete(listener)
    }

    setBeforeChange(resolve: () => void): void {
        this.#beforeChange = resolve
    }

    setTarget(next: Partial<EditTarget>): void {
        const current = this.target.state
        const layer = next.layer ?? current.layer
        const frame = next.frame ?? current.frame

        if (layer === current.layer && frame === current.frame) return
        if (!this.doc.layers.some((candidate) => candidate.id === layer)) return
        if (!this.doc.frames.some((candidate) => candidate.id === frame)) return

        this.#beforeChange?.()
        this.target.patch({ layer, frame })
    }

    rename(title: string): void {
        const next = normalizeSpriteTitle(title)
        if (!next || next === this.doc.meta.title) return

        this.apply('rename document', { kind: 'document.rename', title: next })
    }

    apply(label: string, operation: DocumentOperation): void {
        this.#beforeChange?.()

        const result = applyOperation(this.doc, operation)
        this.#undo.push(new OperationEntry(label, operation, result.inverse))
        this.#emit(result.change)
        this.#emitOperation(operation, 'local')
    }

    applyTransient(operation: DocumentOperation): void {
        this.#emit(applyOperation(this.doc, operation).change)
    }

    commit(command: Command): void {
        const patch = pixelPatchFrom(command.writes())
        if (!patch) return

        this.#undo.push(new OperationEntry(command.label, patch.operation, patch.inverse))
        this.#emit(patch.change)
        this.#emitOperation(patch.operation, 'local')
    }

    applyRemote(operation: DocumentOperation): void {
        const result = applyOperation(this.doc, operation)
        this.#emit(result.change)
        this.#emitOperation(operation, 'remote')
    }

    undo(): void {
        const change = this.#undo.undo(this.doc)
        if (change) this.#emit(change)
    }

    redo(): void {
        const change = this.#undo.redo(this.doc)
        if (change) this.#emit(change)
    }

    #emit(change: ChangeSet): void {
        if (change.kind === 'structure') this.#reconcileTarget(change.removedLayerIndex)
        for (const listener of this.#listeners) listener(change)
    }

    #emitOperation(operation: DocumentOperation, origin: 'local' | 'remote'): void {
        for (const listener of this.#operationListeners) listener(operation, origin)
    }

    #reconcileTarget(removedLayerIndex?: number): void {
        const { layers, frames } = this.doc
        const current = this.target.state
        const next: { layer?: string; frame?: string } = {}

        if (!layers.some((layer) => layer.id === current.layer)) {
            const slot = Math.min(removedLayerIndex ?? layers.length - 1, layers.length - 1)
            next.layer = layers[slot]!.id
        }
        if (!frames.some((frame) => frame.id === current.frame)) next.frame = frames[0]!.id

        if (next.layer !== undefined || next.frame !== undefined) this.target.patch(next)
    }
}

function resolveTarget(doc: Sprite, requested?: Partial<EditTarget>): EditTarget {
    if (doc.layers.length === 0 || doc.frames.length === 0) return { layer: '', frame: '' }

    const workspace = resolveProjectWorkspace(doc, {
        activeLayerId: requested?.layer,
        activeFrameId: requested?.frame,
    })

    return { layer: workspace.activeLayerId, frame: workspace.activeFrameId }
}
