import { Command, openCursor, type CelCursor, type Sprite } from '@starforge/core'
import type { DocumentSession } from '../document/session'
import { liftRegion, normalizeSelection, stampRegion, type SelRect } from './selection'

export interface SelectionDeps {
    sprite: Sprite
    layer: string
    frame: string
    session: DocumentSession

    onChange: () => void
    invalidate?: (x: number, y: number, w: number, h: number) => void
}

export class SelectionController {
    readonly #deps: SelectionDeps
    #rect: SelRect | null = null

    #anchorX = 0
    #anchorY = 0

    #moveFromX = 0
    #moveFromY = 0

    #buffer: Uint32Array | null = null

    #offsetX = 0
    #offsetY = 0

    #command: Command | null = null
    #cursor: CelCursor | null = null

    constructor(deps: SelectionDeps) {
        this.#deps = deps
    }

    get active(): boolean {
        return this.#rect !== null
    }

    get floating(): boolean {
        return this.#buffer !== null
    }

    get rect(): SelRect | null {
        return this.#rect
    }

    get offsetX(): number {
        return this.#offsetX
    }

    get offsetY(): number {
        return this.#offsetY
    }

    get floatBuffer(): Uint32Array | null {
        return this.#buffer
    }

    contains(x: number, y: number): boolean {
        const r = this.#rect
        if (!r) return false

        const left = r.x + this.#offsetX
        const top = r.y + this.#offsetY

        return x >= left && y >= top && x < left + r.w && y < top + r.h
    }

    beginMarquee(x: number, y: number): void {
        this.#anchorX = x
        this.#anchorY = y
        this.#rect = null
        this.#buffer = null
        this.#offsetX = 0
        this.#offsetY = 0
        this.#deps.onChange()
    }

    updateMarquee(x: number, y: number): void {
        const { sprite } = this.#deps
        this.#rect = normalizeSelection(
            this.#anchorX,
            this.#anchorY,
            x,
            y,
            sprite.width,
            sprite.height,
        )
        this.#deps.onChange()
    }

    endMarquee(x: number, y: number): void {
        this.updateMarquee(x, y)
    }

    beginMove(x: number, y: number): void {
        this.#moveFromX = x
        this.#moveFromY = y
    }

    moveTo(x: number, y: number): void {
        if (!this.#rect) return

        this.#lift()
        this.#offsetX += x - this.#moveFromX
        this.#offsetY += y - this.#moveFromY
        this.#moveFromX = x
        this.#moveFromY = y
        this.#deps.onChange()
    }

    nudge(dx: number, dy: number): void {
        if (!this.#rect) return

        this.#lift()
        this.#offsetX += dx
        this.#offsetY += dy
        this.#deps.onChange()
    }

    commit(): void {
        if (this.#rect && this.#buffer && this.#cursor && this.#command) {
            stampRegion(this.#cursor, this.#buffer, this.#rect, this.#offsetX, this.#offsetY)
            this.#deps.session.commit(this.#command)
        }
        this.#reset()
        this.#deps.onChange()
    }

    cancel(): void {
        if (this.#rect && this.#command) {
            const { sprite, layer, frame } = this.#deps
            const cursor = openCursor(sprite, layer, frame)
            for (const w of this.#command.writes()) cursor.set(w.x, w.y, w.before)
            this.#invalidate(this.#rect)
        }
        this.#reset()
        this.#deps.onChange()
    }

    #lift(): void {
        if (this.#buffer || !this.#rect) return

        const { sprite, layer, frame } = this.#deps
        const command = new Command('move selection')

        this.#command = command
        this.#cursor = openCursor(sprite, layer, frame, (w) => {
            command.record(w)
        })
        this.#buffer = liftRegion(this.#cursor, this.#rect)

        this.#invalidate(this.#rect)
    }

    #invalidate(r: SelRect): void {
        this.#deps.invalidate?.(r.x, r.y, r.w, r.h)
    }

    #reset(): void {
        this.#rect = null
        this.#buffer = null
        this.#cursor = null
        this.#command = null
        this.#offsetX = 0
        this.#offsetY = 0
    }
}
