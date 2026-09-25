import type { StrokePreview } from '@starforge/core'

const MAX_CELLS_PER_FRAME = 500

export class StrokeBroadcast {
    #width: number

    #cells: number[] = []
    #color = 0
    #sent = 0
    #replaced = false
    #active = false

    constructor(width: number) {
        this.#width = width
    }

    get active(): boolean {
        return this.#active
    }

    setWidth(width: number): void {
        if (width === this.#width) return
        this.#width = width
        this.end()
    }

    begin(color: number): void {
        this.#cells = []
        this.#color = color >>> 0
        this.#sent = 0
        this.#replaced = false
        this.#active = true
    }

    append(x: number, y: number): void {
        if (!this.#active) return
        this.#cells.push(y * this.#width + x)
    }

    replace(cells: Iterable<number>, color: number): void {
        if (!this.#active) return
        this.#cells = [...cells]
        this.#color = color >>> 0
        this.#replaced = true
    }

    end(): void {
        this.#active = false
        this.#cells = []
        this.#sent = 0
        this.#replaced = false
    }

    take(): StrokePreview | null {
        if (!this.#active) return null

        if (this.#replaced || this.#sent > this.#cells.length) {
            this.#replaced = false
            this.#sent = this.#cells.length
            return {
                color: this.#color,
                cells: this.#cells.slice(0, MAX_CELLS_PER_FRAME),
                full: true,
            }
        }

        const budget = Math.min(this.#cells.length, this.#sent + MAX_CELLS_PER_FRAME)
        const cells = this.#cells.slice(this.#sent, budget)
        this.#sent = budget
        return { color: this.#color, cells, full: false }
    }
}
