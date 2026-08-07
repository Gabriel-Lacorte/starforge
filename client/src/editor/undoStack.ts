import { openCursor, type Command, type Sprite } from '@starforge/core'

export interface Rect {
    x: number
    y: number
    w: number
    h: number
}

export interface StrokeRecord {
    readonly label: string
    readonly layer: string
    readonly frame: string
    readonly rect: Rect
    readonly bytes: number
    readonly xs: Uint16Array
    readonly ys: Uint16Array
    readonly before: Uint32Array
    readonly after: Uint32Array
}

const CELL_BYTES = 12
const RECORD_OVERHEAD = 256

export const DEFAULT_MAX_ENTRIES = 100
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024

export class UndoStack {
    readonly #maxEntries: number
    readonly #maxBytes: number
    #undo: StrokeRecord[] = []
    #redo: StrokeRecord[] = []
    #bytes = 0

    constructor(limits?: { maxEntries?: number; maxBytes?: number }) {
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

    push(command: Command): StrokeRecord | null {
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

        for (const [i, w] of writes.entries()) {
            xs[i] = w.x
            ys[i] = w.y

            before[i] = w.before
            after[i] = w.after

            if (w.x < minX) minX = w.x
            else if (w.x > maxX) maxX = w.x

            if (w.y < minY) minY = w.y
            else if (w.y > maxY) maxY = w.y
        }

        const record: StrokeRecord = {
            label: command.label,
            layer: first.layer,
            frame: first.frame,
            rect: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
            bytes: n * CELL_BYTES + RECORD_OVERHEAD,
            xs,
            ys,
            before,
            after,
        }

        for (const dropped of this.#redo) this.#bytes -= dropped.bytes
        this.#redo.length = 0
        this.#undo.push(record)
        this.#bytes += record.bytes
        while (
            this.#undo.length > 1 &&
            (this.#undo.length > this.#maxEntries || this.#bytes > this.#maxBytes)
        ) {
            this.#bytes -= this.#undo.shift()!.bytes
        }
        return record
    }

    undo(sprite: Sprite): StrokeRecord | null {
        const record = this.#undo.pop()
        if (!record) return null

        const cursor = openCursor(sprite, record.layer, record.frame)
        for (let i = 0; i < record.xs.length; i++) {
            cursor.set(record.xs[i]!, record.ys[i]!, record.before[i]!)
        }
        this.#redo.push(record)

        return record
    }

    redo(sprite: Sprite): StrokeRecord | null {
        const record = this.#redo.pop()
        if (!record) return null

        const cursor = openCursor(sprite, record.layer, record.frame)
        for (let i = 0; i < record.xs.length; i++) {
            cursor.set(record.xs[i]!, record.ys[i]!, record.after[i]!)
        }
        this.#undo.push(record)

        return record
    }
}
