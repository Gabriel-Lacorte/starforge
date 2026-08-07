import { TOOL_CATALOG } from '../tools/catalog'
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
