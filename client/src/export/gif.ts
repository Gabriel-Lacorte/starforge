import { encodeGifWithStats, type GifFrame } from '@starforge/core'
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

export interface GifRender {
    blob: Blob
    colorsUsed: number
}

export function renderGif(sprite: Sprite, scale: GifScale, loop: boolean): GifRender {
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

    const { bytes, colorsUsed } = encodeGifWithStats(gifFrames, sw, sh, { loop })
    return { blob: new Blob([bytes], { type: 'image/gif' }), colorsUsed }
}

export function exportGif(sprite: Sprite, scale: GifScale, loop: boolean): Promise<string> {
    const { blob } = renderGif(sprite, scale, loop)
    const name = gifFilename(sprite.meta.title)
    downloadFile({ blob, filename: name })

    return Promise.resolve(name)
}

export function renderSpritesheet(sprite: Sprite, scale: GifScale): Promise<Blob> {
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

    return new Promise<Blob>((resolve, reject) => {
        strip.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png')
    })
}

export async function exportSpritesheet(sprite: Sprite, scale: GifScale): Promise<string> {
    const blob = await renderSpritesheet(sprite, scale)
    const name = spritesheetFilename(sprite.meta.title)
    downloadFile({ blob, filename: name })
    return name
}
