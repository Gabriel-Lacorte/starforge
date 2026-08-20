import { describe, expect, it } from 'vitest'
import { hexToRgba, hsvaToRgba, rgba, rgbaToHex, rgbaToHsva, TRANSPARENT, withAlpha } from './color'

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

describe('HSV', () => {
    it('round-trips every RGB byte triple exactly', () => {
        let state = 0x2f6e1a3b
        for (let sample = 0; sample < 50_000; sample++) {
            state = (state * 1_664_525 + 1_013_904_223) >>> 0
            const color = state >>> 0
            expect(hsvaToRgba(rgbaToHsva(color))).toBe(color)
        }
    })

    it('places the primaries on their hue spokes', () => {
        expect(rgbaToHsva(rgba(255, 0, 0))).toMatchObject({ h: 0, s: 1, v: 1, a: 255 })
        expect(rgbaToHsva(rgba(0, 255, 0)).h).toBe(120)
        expect(rgbaToHsva(rgba(0, 0, 255)).h).toBe(240)
        expect(rgbaToHsva(rgba(255, 255, 0)).h).toBe(60)
    })

    it('keeps the hue and saturation a grey cannot carry', () => {
        expect(rgbaToHsva(rgba(40, 40, 40), { h: 210, s: 0.8 })).toMatchObject({
            h: 210,
            v: 40 / 255,
        })
        expect(rgbaToHsva(rgba(0, 0, 0), { h: 210, s: 0.8 })).toMatchObject({
            h: 210,
            s: 0.8,
            v: 0,
        })
        expect(rgbaToHsva(rgba(40, 40, 40)).h).toBe(0)
    })

    it('wraps hue and clamps saturation and value instead of producing junk', () => {
        expect(hsvaToRgba({ h: 360, s: 1, v: 1, a: 255 })).toBe(rgba(255, 0, 0))
        expect(hsvaToRgba({ h: -120, s: 1, v: 1, a: 255 })).toBe(rgba(0, 0, 255))
        expect(hsvaToRgba({ h: 0, s: 5, v: -2, a: 255 })).toBe(rgba(0, 0, 0))
    })

    it('carries alpha through untouched', () => {
        expect(rgbaToHsva(rgba(10, 20, 30, 77)).a).toBe(77)
        expect(hsvaToRgba({ h: 12, s: 0.5, v: 0.5, a: 77 }) & 0xff).toBe(77)
    })
})

describe('withAlpha', () => {
    it('replaces only the alpha byte', () => {
        expect(withAlpha(rgba(1, 2, 3, 255), 0)).toBe(rgba(1, 2, 3, 0))
        expect(withAlpha(rgba(1, 2, 3, 0), 128)).toBe(rgba(1, 2, 3, 128))
    })
})
