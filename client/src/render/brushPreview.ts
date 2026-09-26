import { brushCells } from '@starforge/core'
import { toolDefinition } from '../editor/tools'
import { marqueeShape } from '../editor/tools/definition'
import type { ToolId } from '../editor/store'

export interface BrushCursor {
    readonly x: number
    readonly y: number
    readonly size: number
    readonly shape: 'brush' | 'cell'
}

export interface BrushSettings {
    readonly tool: ToolId
    readonly brushSize: number
    readonly eraserSize: number
}

export function brushCursorFor(
    settings: BrushSettings,
    pos: { x: number; y: number },
): BrushCursor | null {
    const definition = toolDefinition(settings.tool)

    if (marqueeShape(definition)) return null

    if (definition.stamp !== 'brush') {
        return { x: pos.x, y: pos.y, size: 1, shape: 'cell' }
    }

    const size = settings.tool === 'eraser' ? settings.eraserSize : settings.brushSize
    return { x: pos.x, y: pos.y, size, shape: 'brush' }
}

export const CURSOR_TRAIL_EASE = 0.35
export const CURSOR_SETTLE = 0.01

export function easeCursor(
    display: { x: number; y: number },
    target: { x: number; y: number },
): { x: number; y: number } | null {
    const dx = target.x - display.x
    const dy = target.y - display.y
    if (Math.abs(dx) < CURSOR_SETTLE && Math.abs(dy) < CURSOR_SETTLE) return null

    return {
        x: Math.abs(dx) < CURSOR_SETTLE ? target.x : display.x + dx * CURSOR_TRAIL_EASE,
        y: Math.abs(dy) < CURSOR_SETTLE ? target.y : display.y + dy * CURSOR_TRAIL_EASE,
    }
}

export interface CursorEdge {
    readonly x1: number
    readonly y1: number
    readonly x2: number
    readonly y2: number
}

const edgeCache = new Map<number, readonly CursorEdge[]>()

export function stampEdges(size: number): readonly CursorEdge[] {
    const cached = edgeCache.get(size)
    if (cached) return cached

    const solid = new Set(brushCells(size).map((p) => `${p.x},${p.y}`))
    const edges: CursorEdge[] = []
    for (const { x, y } of brushCells(size)) {
        if (!solid.has(`${x},${y - 1}`)) edges.push({ x1: x, y1: y, x2: x + 1, y2: y })
        if (!solid.has(`${x},${y + 1}`)) edges.push({ x1: x, y1: y + 1, x2: x + 1, y2: y + 1 })
        if (!solid.has(`${x - 1},${y}`)) edges.push({ x1: x, y1: y, x2: x, y2: y + 1 })
        if (!solid.has(`${x + 1},${y}`)) edges.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1 })
    }

    edgeCache.set(size, edges)
    return edges
}

export const CURSOR_MID_LO = 96
export const CURSOR_MID_HI = 160

export const BACKDROP_LUMA = 51

export function compositeLuma(px: { r: number; g: number; b: number; a: number }): number {
    const alpha = px.a / 255
    const ink = (0.299 * px.r + 0.587 * px.g + 0.114 * px.b) * alpha
    return ink + BACKDROP_LUMA * (1 - alpha)
}

export function cursorContrast(luma: number): '#000000' | '#ffffff' | null {
    if (luma < CURSOR_MID_LO || luma > CURSOR_MID_HI) return null
    return luma > 128 ? '#000000' : '#ffffff'
}
