import type { ToolId } from '../store'
import { TOOL_CATALOG } from './catalog'
import { marqueeShape, type ToolDefinition } from './definition'
import { traceFlood } from './flood'
import { traceFreehand } from './freehand'
import { traceShape } from './shape'
import type { Tool, ToolHost } from './tool'

export type GestureToolId = Exclude<
    ToolId,
    'select' | 'selectEllipse' | 'lasso' | 'wand' | 'eyedropper'
>

export function isGestureTool(id: ToolId): id is GestureToolId {
    const definition = toolDefinition(id)
    return definition.geometry !== 'sample' && marqueeShape(definition) === null
}

export function toolDefinition(id: ToolId): ToolDefinition {
    const definition = TOOL_CATALOG.find((candidate) => candidate.id === id)
    if (!definition) throw new Error(`unknown tool: ${id}`)

    return definition
}

export function makeTool(definition: ToolDefinition, host: ToolHost): Tool {
    switch (definition.geometry) {
        case 'freehand':
            return traceFreehand(definition, host)
        case 'line':
        case 'rect':
        case 'ellipse':
            return traceShape(definition, host)
        case 'flood':
            return traceFlood(definition, host)
        case 'select.rect':
        case 'select.ellipse':
        case 'select.lasso':
        case 'select.wand':
            throw new Error('the selection tools are driven by the selection controller')
        case 'sample':
            throw new Error('the eyedropper is driven by the input layer')
    }
}
