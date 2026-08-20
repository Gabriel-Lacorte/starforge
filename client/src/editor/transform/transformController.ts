import {
    TRANSPARENT,
    allMask,
    getLayer,
    isSelected,
    openCursor,
    pixelPatchFrom,
    transformMask,
    transformPlacement,
    transformRegion,
    type CellWrite,
    type SelectionMask,
    type Sprite,
    type TransformKind,
} from '@starforge/core'
import type { DocumentSession } from '../../document/session'

export interface TransformDeps {
    sprite: Sprite
    session: DocumentSession
    selection: () => SelectionMask | null
    reselect: (mask: SelectionMask) => void
    settle: () => void
}

const LABELS: Readonly<Record<TransformKind, string>> = {
    'flip-h': 'flip horizontally',
    'flip-v': 'flip vertically',
    'rotate-cw': 'rotate right',
    'rotate-ccw': 'rotate left',
    'rotate-180': 'rotate 180',
}

export class TransformController {
    readonly #deps: TransformDeps

    constructor(deps: TransformDeps) {
        this.#deps = deps
    }

    apply(kind: TransformKind): void {
        const { sprite, session } = this.#deps
        this.#deps.settle()

        const { layer, frame } = session.target.state
        if (getLayer(sprite, layer).locked) return

        const mask = this.#deps.selection() ?? allMask(sprite.width, sprite.height)
        const bounds = mask.bounds
        if (!bounds) return

        const cursor = openCursor(sprite, layer, frame)
        const region = new Uint32Array(bounds.w * bounds.h)
        for (let y = 0; y < bounds.h; y++) {
            for (let x = 0; x < bounds.w; x++) {
                const px = bounds.x + x
                const py = bounds.y + y
                if (!isSelected(mask, px, py)) continue
                region[y * bounds.w + x] = cursor.get(px, py)
            }
        }

        const moved = transformRegion(region, bounds.w, bounds.h, kind)
        const placed = transformPlacement(bounds, kind)
        const next = transformMask(mask, kind)

        const values = new Map<number, number>()
        for (let y = 0; y < bounds.h; y++) {
            for (let x = 0; x < bounds.w; x++) {
                const px = bounds.x + x
                const py = bounds.y + y
                if (isSelected(mask, px, py)) values.set(py * sprite.width + px, TRANSPARENT)
            }
        }
        for (let y = 0; y < moved.height; y++) {
            for (let x = 0; x < moved.width; x++) {
                const px = placed.x + x
                const py = placed.y + y
                if (px < 0 || py < 0 || px >= sprite.width || py >= sprite.height) continue
                if (!isSelected(next, px, py)) continue

                values.set(py * sprite.width + px, moved.pixels[y * moved.width + x]!)
            }
        }

        const writes: CellWrite[] = []
        for (const [cell, after] of values) {
            const x = cell % sprite.width
            const y = (cell - x) / sprite.width
            const before = cursor.get(x, y)
            if (before !== after) writes.push({ layer, frame, x, y, before, after })
        }

        const patch = pixelPatchFrom(writes)
        if (patch) session.apply(LABELS[kind], patch.operation)
        this.#deps.reselect(next)
    }
}
