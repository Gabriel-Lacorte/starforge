import type { Sprite } from '@starforge/core'
import { composeFrameCanvas } from './frame'

export async function exportFramePng(sprite: Sprite, frameId: string): Promise<void> {
    const canvas = composeFrameCanvas(sprite, frameId)

    const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/png')
    })
    if (!blob) throw new Error('PNG encoding failed')

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${slug(sprite.meta.title)}.png`

    /* firefox only follows a link that is in the document. */
    document.body.append(link)
    link.click()
    link.remove()

    setTimeout(() => {
        URL.revokeObjectURL(url)
    }, 60_000)
}

function slug(title: string): string {
    const s = title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    return s || 'starforge'
}
