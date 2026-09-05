import { TOOL_CATALOG } from '../tools/catalog'
import type { MaskMode } from '@starforge/core'
import type { ToolId } from '../store'

export function toolForKey(key: string, current: ToolId): ToolId | null {
    const matches = TOOL_CATALOG.filter((t) => t.shortcut === key)
    if (matches.length === 0) return null

    const idx = matches.findIndex((t) => t.id === current)
    return matches[(idx + 1) % matches.length]!.id
}

export function brushStepForKey(key: string): -1 | 1 | null {
    if (key === '[') return -1
    if (key === ']') return 1
    return null
}

const SELECTION_MODES: Readonly<Record<string, MaskMode | undefined>> = {
    '1': 'replace',
    '2': 'add',
    '3': 'subtract',
    '4': 'intersect',
}

export function selectionModeForKey(key: string): MaskMode | null {
    return SELECTION_MODES[key] ?? null
}
