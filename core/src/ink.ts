import { TRANSPARENT, rgba, type RGBA } from './color'

export type InkMode = 'source-over' | 'erase' | 'copy' | 'lock-alpha'

export interface InkContext {
    readonly mode: InkMode
    readonly color: RGBA
    readonly opacity: number
}

export function applyInk(destination: RGBA, context: InkContext): RGBA {
    const opacity = context.opacity
    if (!Number.isInteger(opacity) || opacity < 0 || opacity > 255) {
        throw new RangeError(`ink opacity must be an integer in 0..255, got ${opacity}`)
    }

    const dest = destination >>> 0
    if (opacity === 0) return dest

    switch (context.mode) {
        case 'source-over':
            return sourceOver(dest, context.color >>> 0, opacity)
        case 'erase':
            return erase(dest, opacity)
        case 'copy':
            return copy(context.color >>> 0, opacity)
        case 'lock-alpha':
            return lockAlpha(dest, context.color >>> 0, opacity)
        default:
            throw new Error(`unknown ink mode: ${String(context.mode)}`)
    }
}

function sourceOver(destination: RGBA, color: RGBA, opacity: number): RGBA {
    const sourceAlpha = scaleByte(alpha(color), opacity)
    if (sourceAlpha === 0) return destination

    const destinationAlpha = alpha(destination)
    const inverseSource = 255 - sourceAlpha
    const alphaNumerator = sourceAlpha * 255 + destinationAlpha * inverseSource
    if (alphaNumerator === 0) return TRANSPARENT

    const channel = (shift: 8 | 16 | 24): number =>
        divideNearest(
            byteAt(color, shift) * sourceAlpha * 255 +
                byteAt(destination, shift) * destinationAlpha * inverseSource,
            alphaNumerator,
        )

    return rgba(channel(24), channel(16), channel(8), divideNearest(alphaNumerator, 255))
}

function erase(destination: RGBA, opacity: number): RGBA {
    const outputAlpha = scaleByte(alpha(destination), 255 - opacity)
    if (outputAlpha === 0) return TRANSPARENT
    return ((destination & 0xffffff00) | outputAlpha) >>> 0
}

function copy(color: RGBA, opacity: number): RGBA {
    const outputAlpha = scaleByte(alpha(color), opacity)
    if (outputAlpha === 0) return TRANSPARENT
    return ((color & 0xffffff00) | outputAlpha) >>> 0
}

function lockAlpha(destination: RGBA, color: RGBA, opacity: number): RGBA {
    const destinationAlpha = alpha(destination)
    if (destinationAlpha === 0) return TRANSPARENT

    const sourceAlpha = scaleByte(alpha(color), opacity)
    if (sourceAlpha === 0) return destination
    const inverseSource = 255 - sourceAlpha
    const channel = (shift: 8 | 16 | 24): number =>
        divideNearest(
            byteAt(color, shift) * sourceAlpha + byteAt(destination, shift) * inverseSource,
            255,
        )

    return rgba(channel(24), channel(16), channel(8), destinationAlpha)
}

function alpha(color: RGBA): number {
    return color & 0xff
}

function byteAt(color: RGBA, shift: 8 | 16 | 24): number {
    return (color >>> shift) & 0xff
}

function scaleByte(value: number, scale: number): number {
    return divideNearest(value * scale, 255)
}

function divideNearest(numerator: number, denominator: number): number {
    return Math.floor((numerator + Math.floor(denominator / 2)) / denominator)
}
