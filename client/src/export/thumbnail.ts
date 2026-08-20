import type { Sprite } from '@starforge/core'
import { composeFrameCanvas } from './frame'

export const THUMBNAIL_MAX = 96

export async function renderThumbnail(
    sprite: Sprite,
    frameId: string,
    max = THUMBNAIL_MAX,
): Promise<Blob | null> {
    const source = composeFrameCanvas(sprite, frameId)
    const scale = Math.max(1, Math.floor(max / Math.max(sprite.width, sprite.height)))

    const width = Math.min(max, sprite.width * scale)
    const height = Math.min(max, sprite.height * scale)

    const tile = document.createElement('canvas')
    tile.width = width
    tile.height = height

    const ctx = tile.getContext('2d')
    if (!ctx) return null

    ctx.imageSmoothingEnabled = false
    ctx.drawImage(source, 0, 0, width, height)

    return new Promise((resolve) => {
        try {
            tile.toBlob(resolve, 'image/png')
        } catch {
            resolve(null)
        }
    })
}
