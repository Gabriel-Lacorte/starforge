export type RGBA = number

export const TRANSPARENT: RGBA = 0x000000

export function rgba(r: number, g: number, b: number, a = 0xff): RGBA {
    return (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff)) >>> 0
}

export function hexToRgba(hex: string): RGBA {
    if (!/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) {
        throw new Error(`invalid hex color: ${hex}`)
    }

    return Number.parseInt(hex.slice(1).padEnd(8, 'f'), 16) >>> 0
}
