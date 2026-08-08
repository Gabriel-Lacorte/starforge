import type { ToolId } from '../store'

export type OptionGroup = 'brush' | 'fill' | 'bucket'

export interface ToolSpec {
    readonly id: ToolId
    readonly label: string

    readonly shortcut?: string
    readonly options: readonly OptionGroup[]
}

export const TOOL_CATALOG: readonly ToolSpec[] = [
    { id: 'select', label: 'Select', shortcut: 'm', options: [] },
    { id: 'pencil', label: 'Pencil', shortcut: 'b', options: ['brush'] },
    { id: 'eraser', label: 'Eraser', shortcut: 'e', options: ['brush'] },
    { id: 'line', label: 'Line', shortcut: 'l', options: ['brush'] },
    { id: 'rect', label: 'Rect', shortcut: 'u', options: ['brush', 'fill'] },
    { id: 'ellipse', label: 'Ellipse', shortcut: 'u', options: ['brush', 'fill'] },
    { id: 'bucket', label: 'Bucket', shortcut: 'g', options: ['bucket'] },
]

export function toolBadge(spec: ToolSpec): string | undefined {
    return spec.shortcut?.toUpperCase()
}
