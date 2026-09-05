import { describe, expect, it } from 'vitest'
import { brushStepForKey, selectionModeForKey, toolForKey } from './keymap'

describe('toolForKey', () => {
    it('maps the static tool shortcuts', () => {
        expect(toolForKey('b', 'bucket')).toBe('pencil')
        expect(toolForKey('e', 'pencil')).toBe('eraser')
        expect(toolForKey('g', 'pencil')).toBe('bucket')
        expect(toolForKey('l', 'pencil')).toBe('line')
        expect(toolForKey('m', 'pencil')).toBe('select')
    })

    it('cycles the shape slot on u, depending on the current tool', () => {
        expect(toolForKey('u', 'rect')).toBe('ellipse')
        expect(toolForKey('u', 'ellipse')).toBe('rect')
        expect(toolForKey('u', 'pencil')).toBe('rect')
    })

    it('returns null for keys that are not tool shortcuts', () => {
        expect(toolForKey('x', 'pencil')).toBeNull()
        expect(toolForKey('[', 'pencil')).toBeNull()
    })
})

describe('brushStepForKey', () => {
    it('maps the bracket keys and nothing else', () => {
        expect(brushStepForKey('[')).toBe(-1)
        expect(brushStepForKey(']')).toBe(1)
        expect(brushStepForKey('b')).toBeNull()
    })
})

describe('selectionModeForKey', () => {
    it('maps digits to touch-friendly selection modes', () => {
        expect(selectionModeForKey('1')).toBe('replace')
        expect(selectionModeForKey('2')).toBe('add')
        expect(selectionModeForKey('3')).toBe('subtract')
        expect(selectionModeForKey('4')).toBe('intersect')
    })

    it('returns null for tool shortcuts and anything else', () => {
        expect(selectionModeForKey('m')).toBeNull()
        expect(selectionModeForKey('x')).toBeNull()
        expect(selectionModeForKey('5')).toBeNull()
    })
})
