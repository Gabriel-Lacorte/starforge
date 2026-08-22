import { TRANSPARENT, type InkContext, type InkMode, type RGBA } from '@starforge/core'
import type { EditorState, ToolId } from '../store'

export type ToolGeometry =
    | 'freehand'
    | 'line'
    | 'rect'
    | 'ellipse'
    | 'flood'
    | 'sample'
    | 'select.rect'
    | 'select.ellipse'
    | 'select.lasso'
    | 'select.wand'

export type MarqueeShape = 'rect' | 'ellipse' | 'lasso' | 'wand'

const MARQUEES: Readonly<Record<string, MarqueeShape>> = {
    'select.rect': 'rect',
    'select.ellipse': 'ellipse',
    'select.lasso': 'lasso',
    'select.wand': 'wand',
}

export function marqueeShape(definition: ToolDefinition): MarqueeShape | null {
    return MARQUEES[definition.geometry] ?? null
}

export type ToolCapability =
    'brush' | 'opacity' | 'pixelPerfect' | 'lockAlpha' | 'shapeFill' | 'symmetry' | 'flood'

export interface ToolDefinition {
    readonly id: ToolId
    readonly label: string
    readonly shortcut: string

    readonly geometry: ToolGeometry
    readonly ink: InkMode
    readonly stamp: 'brush' | 'none'
    readonly trace: 'direct' | 'preview'
}

export interface ToolSettings {
    readonly color: RGBA
    readonly inkOpacity: number
    readonly brushSize: number
    readonly pixelPerfect: boolean
    readonly lockAlpha: boolean
    readonly shapeFill: boolean

    readonly symmetryH: boolean
    readonly symmetryV: boolean

    readonly fillTolerance: number
    readonly fillContiguous: boolean

    readonly seed: number
}

export function captureSettings(state: EditorState, seed: number): ToolSettings {
    return {
        color: state.color,
        inkOpacity: state.inkOpacity,
        brushSize: state.brushSize,
        pixelPerfect: state.pixelPerfect,
        lockAlpha: state.lockAlpha,
        shapeFill: state.shapeFill,
        symmetryH: state.symmetryH,
        symmetryV: state.symmetryV,
        fillTolerance: state.fillTolerance,
        fillContiguous: state.fillContiguous,
        seed,
    }
}

function inkMode(definition: ToolDefinition, settings: ToolSettings): InkMode {
    if (definition.ink !== 'source-over') return definition.ink

    return settings.lockAlpha ? 'lock-alpha' : 'source-over'
}

export function inkFor(definition: ToolDefinition, settings: ToolSettings): InkContext {
    return {
        mode: inkMode(definition, settings),
        color: definition.ink === 'erase' ? TRANSPARENT : settings.color,
        opacity: settings.inkOpacity,
    }
}

const PAINTS: readonly ToolGeometry[] = ['freehand', 'line', 'rect', 'ellipse', 'flood']

export function toolCapabilities(definition: ToolDefinition): readonly ToolCapability[] {
    const capabilities: ToolCapability[] = []

    if (definition.stamp === 'brush') capabilities.push('brush')
    if (PAINTS.includes(definition.geometry)) capabilities.push('opacity')
    if (definition.geometry === 'freehand') capabilities.push('pixelPerfect')
    if (PAINTS.includes(definition.geometry) && definition.ink === 'source-over') {
        capabilities.push('lockAlpha')
    }
    if (definition.geometry === 'freehand') capabilities.push('symmetry')
    if (definition.geometry === 'rect' || definition.geometry === 'ellipse') {
        capabilities.push('shapeFill')
    }
    if (definition.geometry === 'flood' || definition.geometry === 'select.wand') {
        capabilities.push('flood')
    }

    return capabilities
}
