import {
    Command,
    allMask,
    applyOperation,
    combineMasks,
    emptyMask,
    getLayer,
    invertMask,
    isEmptyMask,
    isSelected,
    openCursor,
    pixelPatchFrom,
    ellipseMask,
    polygonMask,
    rectMask,
    translateMask,
    wandMask,
    type CelCursor,
    type FillOptions,
    type MaskMode,
    type MaskPoint,
    type SelectionMask,
    type Sprite,
} from '@starforge/core'
import type { DocumentSession, EditTarget } from '../../document/session'
import type { MarqueeShape } from '../tools/definition'
import { liftRegion, normalizeSelection, stampRegion, type SelRect } from './region'

const LASSO_MAX_POINTS = 1024

export interface SelectionDeps {
    sprite: Sprite

    target: () => EditTarget
    session: DocumentSession

    onChange: () => void

    invalidate?: (layer: string, frame: string, x: number, y: number, w: number, h: number) => void
}

export class SelectionController {
    readonly #deps: SelectionDeps
    #mask: SelectionMask
    #base: SelectionMask

    #anchorX = 0
    #anchorY = 0
    #mode: MaskMode = 'replace'
    #shape: MarqueeShape = 'rect'

    #points: MaskPoint[] = []

    #moveFromX = 0
    #moveFromY = 0

    #buffer: Uint32Array | null = null
    #liftRect: SelRect | null = null

    #offsetX = 0
    #offsetY = 0

    #command: Command | null = null
    #cursor: CelCursor | null = null
    #target: EditTarget | null = null

    constructor(deps: SelectionDeps) {
        this.#deps = deps
        this.#mask = emptyMask(deps.sprite.width, deps.sprite.height)
        this.#base = this.#mask
    }

    get active(): boolean {
        return !isEmptyMask(this.#mask)
    }

    get floating(): boolean {
        return this.#buffer !== null
    }

    get mask(): SelectionMask | null {
        return this.active ? this.#mask : null
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

    get floatRect(): SelRect | null {
        return this.#liftRect
    }

    contains(x: number, y: number): boolean {
        return isSelected(this.#mask, x - this.#offsetX, y - this.#offsetY)
    }

    beginMarquee(
        x: number,
        y: number,
        mode: MaskMode = 'replace',
        shape: MarqueeShape = 'rect',
    ): void {
        this.#anchorX = x
        this.#anchorY = y
        this.#mode = mode
        this.#shape = shape
        this.#points = [{ x, y }]
        this.#base = mode === 'replace' ? emptyMask(this.#width, this.#height) : this.#mask
        this.#dropFloat()
        this.#setMask(this.#base)
    }

    updateMarquee(x: number, y: number): void {
        if (this.#shape === 'lasso') {
            const last = this.#points.at(-1)
            if (last?.x === x && last.y === y) return

            if (this.#points.length >= LASSO_MAX_POINTS) this.#points.pop()
            this.#points.push({ x, y })
        }

        this.#setMask(combineMasks(this.#base, this.#shapeMask(x, y), this.#mode))
    }

    wandAt(x: number, y: number, mode: MaskMode, options: FillOptions): void {
        const { layer, frame } = this.#deps.target()
        this.#dropFloat()

        const base = mode === 'replace' ? emptyMask(this.#width, this.#height) : this.#mask
        this.#setMask(
            combineMasks(base, wandMask(this.#deps.sprite, layer, frame, x, y, options), mode),
        )
    }

    endMarquee(x: number, y: number): void {
        this.updateMarquee(x, y)
    }

    #shapeMask(x: number, y: number): SelectionMask {
        if (this.#shape === 'lasso') return polygonMask(this.#width, this.#height, this.#points)

        const rect = normalizeSelection(
            this.#anchorX,
            this.#anchorY,
            x,
            y,
            this.#width,
            this.#height,
        )
        if (!rect) return emptyMask(this.#width, this.#height)

        const build = this.#shape === 'ellipse' ? ellipseMask : rectMask
        return build(
            this.#width,
            this.#height,
            rect.x,
            rect.y,
            rect.x + rect.w - 1,
            rect.y + rect.h - 1,
        )
    }

    selectAll(): void {
        this.commit()
        this.#setMask(allMask(this.#width, this.#height))
    }

    invert(): void {
        this.commit()
        this.#setMask(invertMask(this.#mask))
    }

    deselect(): void {
        this.commit()
        this.#setMask(emptyMask(this.#width, this.#height))
    }

    reselect(mask: SelectionMask): void {
        this.#dropFloat()
        this.#setMask(mask)
    }

    beginMove(x: number, y: number): void {
        this.#moveFromX = x
        this.#moveFromY = y
    }

    moveTo(x: number, y: number): void {
        if (!this.active) return

        this.#lift()
        this.#offsetX += x - this.#moveFromX
        this.#offsetY += y - this.#moveFromY
        this.#moveFromX = x
        this.#moveFromY = y
        this.#deps.onChange()
    }

    nudge(dx: number, dy: number): void {
        if (!this.active) return

        this.#lift()
        this.#offsetX += dx
        this.#offsetY += dy
        this.#deps.onChange()
    }

    commit(): void {
        const target = this.#target
        const rect = this.#liftRect
        const dx = this.#offsetX
        const dy = this.#offsetY

        if (rect && this.#buffer && this.#cursor && this.#command && target) {
            if (this.#writable(target.layer)) {
                stampRegion(this.#cursor, this.#buffer, rect, dx, dy)
                this.#deps.session.commit(this.#command)
            }
        }
        this.#dropFloat()
        this.#setMask(translateMask(this.#mask, dx, dy))
    }

    cancel(): void {
        const target = this.#target
        if (this.#command && target && this.#writable(target.layer)) {
            const patch = pixelPatchFrom(this.#command.writes())
            if (patch) applyOperation(this.#deps.sprite, patch.inverse)
            this.#invalidate()
        }
        this.#dropFloat()
        this.#setMask(emptyMask(this.#width, this.#height))
    }

    get #width(): number {
        return this.#deps.sprite.width
    }

    get #height(): number {
        return this.#deps.sprite.height
    }

    #setMask(mask: SelectionMask): void {
        this.#mask = mask
        this.#deps.onChange()
    }

    #lift(): void {
        const bounds = this.#mask.bounds
        if (this.#buffer || !bounds) return

        const { sprite } = this.#deps
        const target = this.#deps.target()

        if (getLayer(sprite, target.layer).locked) return
        this.#target = target

        const command = new Command('move selection')
        this.#command = command
        this.#cursor = openCursor(sprite, target.layer, target.frame, (w) => {
            command.record(w)
        })
        this.#liftRect = bounds
        this.#buffer = liftRegion(this.#cursor, this.#mask, bounds)
        this.#invalidate()
    }

    #writable(id: string): boolean {
        const layer = this.#deps.sprite.layers.find((l) => l.id === id)
        return layer !== undefined && !layer.locked
    }

    #invalidate(): void {
        const target = this.#target
        const rect = this.#liftRect
        if (!target || !rect) return

        this.#deps.invalidate?.(target.layer, target.frame, rect.x, rect.y, rect.w, rect.h)
    }

    #dropFloat(): void {
        this.#buffer = null
        this.#liftRect = null
        this.#cursor = null
        this.#command = null
        this.#target = null
        this.#offsetX = 0
        this.#offsetY = 0
    }
}
