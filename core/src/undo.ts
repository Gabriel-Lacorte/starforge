import type { RGBA } from './color'
import { SPRITE_MAX_SIZE } from './doc'
import type { CellWrite } from './ops'

interface CellDelta {
    before: RGBA
    after: RGBA
}

/**
 * represents one gesture as a batch of cell writes against a single (layer, frame).
 *
 * cells are keyed numerically and repeted cells allocate nothing, optimizing every brush drag.
 * writes the same sell collapse into first-`before` + last-`after`, so undo/redo cost O(cells touched).
 */
export class Command {
    readonly label: string

    #layer: string | null = null
    #frame: string | null = null
    /* y*SPRITE_MAX_SIZE+x is collision free */
    readonly #cells = new Map<number, CellDelta>()

    constructor(label: string) {
        this.label = label
    }

    record(write: CellWrite): void {
        if (this.#layer === null) {
            this.#layer = write.layer
            this.#frame = write.frame
        } else if (write.layer !== this.#layer || write.frame !== this.#frame) {
            throw new Error(`command "${this.label}" spans a single (layer, frame)`)
        }

        const key = write.y * SPRITE_MAX_SIZE + write.x
        const cell = this.#cells.get(key)

        if (cell) cell.after = write.after
        else this.#cells.set(key, { before: write.before, after: write.after })
    }

    writes(): CellWrite[] {
        const layer = this.#layer
        const frame = this.#frame
        if (layer === null || frame === null) return []

        const out: CellWrite[] = []
        for (const [key, cell] of this.#cells) {
            if (cell.before === cell.after) continue

            const x = key % SPRITE_MAX_SIZE
            const y = (key - x) / SPRITE_MAX_SIZE

            out.push({
                layer,
                frame,
                x,
                y,
                before: cell.before,
                after: cell.after,
            })
        }

        return out
    }
}
