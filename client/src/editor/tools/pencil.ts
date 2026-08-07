import { TRANSPARENT, brushCells, plotLine } from '@starforge/core'
import type { Tool, ToolHost } from './tool'

export function makeFreehand(host: ToolHost, erase: boolean): Tool {
    const color = erase ? TRANSPARENT : host.state.color
    const stamp = brushCells(host.state.brushSize)
    let lastX = 0
    let lastY = 0

    const stampAt = (x: number, y: number): void => {
        for (const cell of stamp) host.write(x + cell.x, y + cell.y, color)
    }

    return {
        begin(x, y) {
            stampAt(x, y)
            lastX = x
            lastY = y
        },
        move(x, y) {
            if (x === lastX && y === lastY) return
            plotLine(lastX, lastY, x, y, (px, py) => {
                if (px !== lastX || py !== lastY) stampAt(px, py)
            })
            lastX = x
            lastY = y
        },
        end() {
            return true
        },
    }
}
