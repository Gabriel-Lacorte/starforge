import {
    anchorOffset,
    SPRITE_MAX_SIZE,
    SPRITE_MIN_SIZE,
    type ResizeAnchor,
    type SelectionMask,
    type Sprite,
} from '@starforge/core'
import type { DocumentSession } from '../../document/session'

export interface CanvasDeps {
    sprite: Sprite
    session: DocumentSession
    selection: () => SelectionMask | null
    settle: () => void
}

export class CanvasController {
    readonly #deps: CanvasDeps

    constructor(deps: CanvasDeps) {
        this.#deps = deps
    }

    resize(width: number, height: number, anchor: ResizeAnchor): void {
        const { sprite } = this.#deps
        if (!isSize(width) || !isSize(height)) return
        if (width === sprite.width && height === sprite.height) return

        const [offsetX, offsetY] = anchorOffset(anchor, sprite.width, sprite.height, width, height)
        this.#deps.settle()
        this.#deps.session.apply('resize canvas', {
            kind: 'document.resize',
            width,
            height,
            offsetX,
            offsetY,
        })
    }

    scale(width: number, height: number): void {
        const { sprite } = this.#deps
        if (!isSize(width) || !isSize(height)) return
        if (width === sprite.width && height === sprite.height) return

        this.#deps.settle()
        this.#deps.session.apply('scale drawing', { kind: 'document.scale', width, height })
    }

    cropToSelection(): void {
        const bounds = this.#deps.selection()?.bounds
        if (!bounds) return
        if (!isSize(bounds.w) || !isSize(bounds.h)) return
        if (bounds.w === this.#deps.sprite.width && bounds.h === this.#deps.sprite.height) return

        this.#deps.settle()
        this.#deps.session.apply('crop to selection', {
            kind: 'document.resize',
            width: bounds.w,
            height: bounds.h,
            offsetX: -bounds.x,
            offsetY: -bounds.y,
        })
    }
}

function isSize(value: number): boolean {
    return Number.isInteger(value) && value >= SPRITE_MIN_SIZE && value <= SPRITE_MAX_SIZE
}
