export type RGBA = number

export const TRANSPARENT: RGBA = 0x000000

export function rgba(r: number, g: number, b: number, a = 0xff): RGBA {
    return (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff)) >>> 0
}

export function rgbaToHex(color: RGBA): string {
    const hex = (color >>> 0).toString(16).padStart(8, '0')
    return hex.endsWith('ff') ? `#${hex.slice(0, 6)}` : `#${hex}`
}

export function hexToRgba(hex: string): RGBA {
    if (!/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) {
        throw new Error(`invalid hex color: ${hex}`)
    }

    return Number.parseInt(hex.slice(1).padEnd(8, 'f'), 16) >>> 0
}

export function withAlpha(color: RGBA, alpha: number): RGBA {
    return (((color >>> 0) & 0xffffff00) | (alpha & 0xff)) >>> 0
}

export interface Hsva {
    /* 0..360 */
    readonly h: number
    /* 0..1 */
    readonly s: number
    /* 0..1 */
    readonly v: number
    /* 0..255 */
    readonly a: number
}

export function rgbaToHsva(color: RGBA, keep?: { h: number; s: number }): Hsva {
    const r = (color >>> 24) & 0xff
    const g = (color >>> 16) & 0xff
    const b = (color >>> 8) & 0xff

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const span = max - min

    const h =
        span === 0
            ? (keep?.h ?? 0)
            : max === r
              ? 60 * (((g - b) / span + 6) % 6)
              : max === g
                ? 60 * ((b - r) / span + 2)
                : 60 * ((r - g) / span + 4)

    return {
        h,
        s: max === 0 ? (keep?.s ?? 0) : span / max,
        v: max / 255,
        a: color & 0xff,
    }
}

export function hsvaToRgba(hsva: Hsva): RGBA {
    const h = ((hsva.h % 360) + 360) % 360
    const s = clamp01(hsva.s)
    const v = clamp01(hsva.v)

    const sector = h / 60
    const chroma = v * s
    const second = chroma * (1 - Math.abs((sector % 2) - 1))
    const base = v - chroma

    const [r, g, b] =
        sector < 1
            ? [chroma, second, 0]
            : sector < 2
              ? [second, chroma, 0]
              : sector < 3
                ? [0, chroma, second]
                : sector < 4
                  ? [0, second, chroma]
                  : sector < 5
                    ? [second, 0, chroma]
                    : [chroma, 0, second]

    return rgba(byte(r + base), byte(g + base), byte(b + base), hsva.a & 0xff)
}

function clamp01(value: number): number {
    return value < 0 ? 0 : value > 1 ? 1 : value
}

function byte(value: number): number {
    return Math.round(value * 255)
}
