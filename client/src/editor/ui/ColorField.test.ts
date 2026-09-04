import { describe, expect, it } from 'vitest'
import { rgba } from '@starforge/core'
import { parseHexField } from './ColorField'

describe('ColorField hex input', () => {
    it('accepts full hex with and without alpha', () => {
        expect(parseHexField('#00ff00')).toBe(rgba(0, 255, 0))
        expect(parseHexField('#00ff0080')).toBe(rgba(0, 255, 0, 128))
    })

    it('expands shorthands and rejects garbage without throwing', () => {
        expect(parseHexField('#0f0')).toBe(rgba(0, 255, 0))
        expect(parseHexField('not a color')).toBeNull()
        expect(parseHexField('#zzzzzz')).toBeNull()
    })

    it('leaves the last valid draft intact on invalid input', () => {
        const lastValid = rgba(255, 0, 0)
        const parsed = parseHexField('###')
        expect(parsed).toBeNull()
        expect(lastValid).toBe(rgba(255, 0, 0))
    })
})
