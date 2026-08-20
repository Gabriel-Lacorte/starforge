import {
    BRUSH_MAX_SIZE,
    applyInk,
    brushCells,
    plotEllipse,
    plotLine,
    plotRect,
    TRANSPARENT,
} from '@starforge/core'
import { inkFor, type ToolDefinition } from './definition'
import type { Mods, Tool, ToolHost } from './tool'

export function traceShape(definition: ToolDefinition, host: ToolHost): Tool {
    const width = host.sprite.width
    const height = host.sprite.height

    const context = inkFor(definition, host.settings)

    const previewColor = applyInk(TRANSPARENT, context)
    const stamp = brushCells(definition.stamp === 'brush' ? host.settings.brushSize : 1)
    const filled = definition.geometry !== 'line' && host.settings.shapeFill

    let ax = 0
    let ay = 0
    let cx = 0
    let cy = 0

    const clampX = (v: number) => Math.max(-BRUSH_MAX_SIZE, Math.min(width - 1 + BRUSH_MAX_SIZE, v))
    const clampY = (v: number) =>
        Math.max(-BRUSH_MAX_SIZE, Math.min(height - 1 + BRUSH_MAX_SIZE, v))

    const target = (x: number, y: number, mods: Mods): void => {
        cx = clampX(x)
        cy = clampY(y)
        if (!mods.shift) return
        const dx = cx - ax
        const dy = cy - ay

        const adx = Math.abs(dx)
        const ady = Math.abs(dy)

        if (definition.geometry === 'line') {
            if (adx > 2 * ady) cy = ay
            else if (ady > 2 * adx) cx = ax
            else {
                const d = Math.min(adx, ady)
                cx = ax + Math.sign(dx) * d
                cy = ay + Math.sign(dy) * d
            }
        } else {
            const side = Math.max(adx, ady)
            cx = clampX(ax + (dx < 0 ? -side : side))
            cy = clampY(ay + (dy < 0 ? -side : side))
        }
    }

    const cells = (): Set<number> => {
        const set = new Set<number>()

        const addBare = (x: number, y: number): void => {
            if (x >= 0 && y >= 0 && x < width && y < height) set.add(y * width + x)
        }
        const addStamped = (x: number, y: number): void => {
            for (const cell of stamp) addBare(x + cell.x, y + cell.y)
        }

        if (definition.geometry === 'line') plotLine(ax, ay, cx, cy, addStamped)
        else if (definition.geometry === 'rect') {
            plotRect(ax, ay, cx, cy, filled, filled ? addBare : addStamped)
        } else plotEllipse(ax, ay, cx, cy, filled, filled ? addBare : addStamped)

        return set
    }

    return {
        begin(x, y, mods) {
            ax = clampX(x)
            ay = clampY(y)
            target(x, y, mods)
            host.preview(cells(), previewColor)
        },
        move(x, y, mods) {
            target(x, y, mods)
            host.preview(cells(), previewColor)
        },
        end(x, y, mods) {
            target(x, y, mods)
            host.clearPreview()
            for (const cell of cells()) {
                const px = cell % width
                host.write(px, (cell - px) / width, context)
            }
            return true
        },
    }
}
