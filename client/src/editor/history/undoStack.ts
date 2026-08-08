import { openCursor, type Command, type DirtyRect, type Sprite } from '@starforge/core'

export type Change =
    | { kind: 'pixels'; layer: string; frame: string; rect: DirtyRect }
    | { kind: 'structure'; removedLayerIndex?: number }

export interface UndoEntry {
    readonly label: string
    readonly bytes: number

    undo(doc: Sprite): Change
    redo(doc: Sprite): Change
}

const CELL_BYTES = 12
const RECORD_OVERHEAD = 256

export const DEFAULT_MAX_ENTRIES = 100
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024

export interface UndoLimits {
    maxEntries?: number
    maxBytes?: number
}

export class StrokeRecord implements UndoEntry {
    readonly label: string
    readonly layer: string
    readonly frame: string
    readonly rect: DirtyRect
    readonly bytes: number
    readonly xs: Uint16Array
    readonly ys: Uint16Array
    readonly before: Uint32Array
    readonly after: Uint32Array

    private constructor(
        label: string,
        layer: string,
        frame: string,
        rect: DirtyRect,
        xs: Uint16Array,
        ys: Uint16Array,
        before: Uint32Array,
        after: Uint32Array,
    ) {
        this.label = label
        this.layer = layer
        this.frame = frame
        this.rect = rect
        this.bytes = xs.length * CELL_BYTES + RECORD_OVERHEAD
        this.xs = xs
        this.ys = ys
        this.before = before
        this.after = after
    }

    static from(command: Command): StrokeRecord | null {
        const writes = command.writes()
        const first = writes[0]
        if (!first) return null

        const n = writes.length
        const xs = new Uint16Array(n)
        const ys = new Uint16Array(n)
        const before = new Uint32Array(n)
        const after = new Uint32Array(n)

        let minX = first.x
        let maxX = first.x
        let minY = first.y
        let maxY = first.y

        for (let i = 0; i < n; i++) {
            const w = writes[i]!
            xs[i] = w.x
            ys[i] = w.y
            before[i] = w.before
            after[i] = w.after

            if (w.x < minX) minX = w.x
            else if (w.x > maxX) maxX = w.x

            if (w.y < minY) minY = w.y
            else if (w.y > maxY) maxY = w.y
        }

        return new StrokeRecord(
            command.label,
            first.layer,
            first.frame,
            { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
            xs,
            ys,
            before,
            after,
        )
    }

    undo(doc: Sprite): Change {
        return this.#replay(doc, this.before)
    }

    redo(doc: Sprite): Change {
        return this.#replay(doc, this.after)
    }

    #replay(doc: Sprite, colors: Uint32Array): Change {
        const cursor = openCursor(doc, this.layer, this.frame)
        for (let i = 0; i < this.xs.length; i++) {
            cursor.set(this.xs[i]!, this.ys[i]!, colors[i]!)
        }

        return { kind: 'pixels', layer: this.layer, frame: this.frame, rect: this.rect }
    }
}

export class UndoStack {
    readonly #maxEntries: number
    readonly #maxBytes: number
    #undo: UndoEntry[] = []
    #redo: UndoEntry[] = []
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

    push(entry: UndoEntry): void {
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

    undo(doc: Sprite): Change | null {
        const entry = this.#undo.pop()
        if (!entry) return null

        const change = entry.undo(doc)
        this.#redo.push(entry)

        return change
    }

    redo(doc: Sprite): Change | null {
        const entry = this.#redo.pop()
        if (!entry) return null

        const change = entry.redo(doc)
        this.#undo.push(entry)

        return change
    }
}
