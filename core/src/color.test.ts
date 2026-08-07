import { describe, expect, it } from 'vitest'
import { rgbaToHex, hexToRgba, rgba, TRANSPARENT } from './color'

describe('rgba', () => {
    it('packs channels', () => {
        expect(rgba(0x12, 0x34, 0x56, 0x78)).toBe(0x12345678)
    })

    it('defaults alpha to opaque', () => {
        expect(rgba(255, 0, 0)).toBe(0xff0000ff)
    })

    it('is always unsigned', () => {
        expect(rgba(255, 255, 255, 255)).toBe(0xffffffff)
    })
})

describe('hexToRgba', () => {
    it('parses #rrggbb as opaque', () => {
        expect(hexToRgba('#ffd166')).toBe(0xffd166ff)
    })

    it('parses #rrggbbaa', () => {
        expect(hexToRgba('#ffd16680')).toBe(0xffd16680)
    })

    it('rejects malformed input', () => {
        for (const bad of ['ffd166', '#fff', '#ffd16', '#ggd166', '#ffd166801']) {
            expect(() => hexToRgba(bad)).toThrow(/invalid hex color/)
        }
    })
})

describe('rgbaToHex', () => {
    it('renders opaque colors as #rrggbb and round-trips hexToRgba', () => {
        expect(rgbaToHex(hexToRgba('#ffd166'))).toBe('#ffd166')
        expect(rgbaToHex(rgba(0, 0, 0))).toBe('#000000')
    })

    it('keeps the alpha digits when not opaque', () => {
        expect(rgbaToHex(rgba(255, 209, 102, 0x80))).toBe('#ffd16680')
        expect(rgbaToHex(TRANSPARENT)).toBe('#00000000')
    })
})
