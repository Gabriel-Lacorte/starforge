import { brushCells, plotLine } from '@starforge/core'
import { inkFor, type ToolDefinition } from './definition'
import type { Tool, ToolHost } from './tool'

interface Cell {
    x: number
    y: number
}

export function traceFreehand(definition: ToolDefinition, host: ToolHost): Tool {
    const context = inkFor(definition, host.settings)
    const size = definition.stamp === 'brush' ? host.settings.brushSize : 1
    const stamp = brushCells(size)

    /* dropping the corner a turn leaves behind only makes sense for a 1px nib */
    const trimCorners = host.settings.pixelPerfect && size === 1

    let previous: Cell | null = null
    let pending: Cell | null = null

    const stampAt = (cell: Cell): void => {
        for (const offset of stamp) host.write(cell.x + offset.x, cell.y + offset.y, context)
    }

    const plot = (x: number, y: number): void => {
        const cell = { x, y }
        if (pending) {
            if (previous && trimCorners && isRedundantCorner(previous, pending, cell)) {
                pending = cell
                return
            }
            stampAt(pending)
            previous = pending
        }
        pending = cell
    }

    const flush = (): void => {
        if (pending) stampAt(pending)
        pending = null
    }

    return {
        begin(x, y) {
            plot(x, y)
        },

        move(x, y) {
            const last = pending ?? previous
            if (!last) {
                plot(x, y)
                return
            }
            if (x === last.x && y === last.y) return

            plotLine(last.x, last.y, x, y, (px, py) => {
                if (px !== last.x || py !== last.y) plot(px, py)
            })
        },

        end() {
            flush()
            return true
        },
    }
}

function isRedundantCorner(a: Cell, b: Cell, c: Cell): boolean {
    return (
        Math.abs(a.x - c.x) === 1 &&
        Math.abs(a.y - c.y) === 1 &&
        (b.x === a.x || b.y === a.y) &&
        (b.x === c.x || b.y === c.y)
    )
}
