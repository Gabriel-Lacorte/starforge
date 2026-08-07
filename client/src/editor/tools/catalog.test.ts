import { describe, expect, it } from 'vitest'
import { TOOL_ICON } from '../ui/icons'
import type { ToolId } from '../store'
import { TOOL_CATALOG, toolBadge } from './catalog'

const ALL_TOOLS: ToolId[] = ['select', 'pencil', 'eraser', 'line', 'rect', 'ellipse', 'bucket']

describe('TOOL_CATALOG', () => {
    it('lists every tool exactly once, and each has an icon', () => {
        const ids = TOOL_CATALOG.map((t) => t.id)
        expect([...ids].sort()).toEqual([...ALL_TOOLS].sort())
        expect(new Set(ids).size).toBe(ids.length)
        for (const id of ids) expect(TOOL_ICON[id]).toBeTypeOf('function')
    })

    it('derives the badge from the shortcut, so rect and ellipse both show U', () => {
        const badgeOf = (id: ToolId) => toolBadge(TOOL_CATALOG.find((t) => t.id === id)!)
        expect(badgeOf('select')).toBe('M')
        expect(badgeOf('rect')).toBe('U')
        expect(badgeOf('ellipse')).toBe('U')
    })

    it('models the shape slot as a shared shortcut (rect and ellipse both u)', () => {
        const withU = TOOL_CATALOG.filter((t) => t.shortcut === 'u').map((t) => t.id)
        expect(withU).toEqual(['rect', 'ellipse'])
    })

    it('scopes options per tool (select none; shapes fill; bucket its own)', () => {
        const opts = (id: ToolId) => TOOL_CATALOG.find((t) => t.id === id)!.options
        expect(opts('select')).toEqual([])
        expect(opts('pencil')).toEqual(['brush'])
        expect(opts('rect')).toEqual(['brush', 'fill'])
        expect(opts('ellipse')).toEqual(['brush', 'fill'])
        expect(opts('bucket')).toEqual(['bucket'])
    })
})
