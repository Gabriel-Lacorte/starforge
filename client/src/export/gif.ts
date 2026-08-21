import { GifError, encodeGif, type GifFrame } from '@starforge/core'
import type { Sprite } from '@starforge/core'
import { composeFrameCanvas } from './frame'
import { slug } from './png'
import { downloadFile } from './download'

export type GifScale = 1 | 2 | 4

export function gifFilename(title: string): string {
    return `${slug(title)}.gif`
}

export function spritesheetFilename(title: string): string {
    return `${slug(title)}.sheet.png`
}

export function exportGif(sprite: Sprite, scale: GifScale, loop: boolean): Promise<string> {
    const { width, height, frames } = sprite
    const sw = width * scale
    const sh = height * scale

    const gifFrames: GifFrame[] = frames.map((frame) => {
        const src = composeFrameCanvas(sprite, frame.id)

        let canvas: HTMLCanvasElement
        if (scale > 1) {
            canvas = document.createElement('canvas')
            canvas.width = sw
            canvas.height = sh

            const ctx = canvas.getContext('2d')!
            ctx.imageSmoothingEnabled = false
            ctx.drawImage(src, 0, 0, sw, sh)
        } else {
            canvas = src
        }

        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        const pixels = new Uint8Array(ctx.getImageData(0, 0, sw, sh).data.buffer)
        return { pixels, durationMs: frame.duration }
    })

    const bytes = encodeGif(gifFrames, sw, sh, { loop })
    const blob = new Blob([bytes], { type: 'image/gif' })
    const name = gifFilename(sprite.meta.title)
    downloadFile({ blob, filename: name })

    return Promise.resolve(name)
}

export async function exportSpritesheet(sprite: Sprite, scale: GifScale): Promise<string> {
    const { width, height, frames } = sprite
    const sw = width * scale
    const sh = height * scale

    const strip = document.createElement('canvas')
    strip.width = sw * frames.length
    strip.height = sh

    const ctx = strip.getContext('2d')!
    ctx.imageSmoothingEnabled = false

    for (let i = 0; i < frames.length; i++) {
        const src = composeFrameCanvas(sprite, frames[i]!.id)
        ctx.drawImage(src, 0, 0, width, height, i * sw, 0, sw, sh)
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
        strip.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png')
    })

    const name = spritesheetFilename(sprite.meta.title)
    downloadFile({ blob, filename: name })
    return name
}

export function gifPaletteMessage(error: unknown): string | null {
    if (error instanceof GifError && error.code === 'PALETTE') {
        const match = /(\d+) opaque/.exec(error.message)
        const count = match ? match[1] : '?'
        return `This animation uses ${count} colors; GIF holds 256. Reduce the palette before exporting.`
    }
    return null
}
