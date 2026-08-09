import type { Sprite } from '@starforge/core'
import { composeFrameCanvas } from './frame'

export async function exportFramePng(sprite: Sprite, frameId: string): Promise<string> {
    const canvas = composeFrameCanvas(sprite, frameId)

    const blob = await new Promise<Blob | null>((resolve, reject) => {
        /* a canvas too large for the encoder rejects here rather than hanging. */
        try {
            canvas.toBlob(resolve, 'image/png')
        } catch (cause) {
            reject(cause instanceof Error ? cause : new Error(String(cause)))
        }
    })
    if (!blob) throw new Error('the browser could not encode this frame')

    const name = `${slug(sprite.meta.title)}.png`
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name

    /* firefox only follows a link that is in the document. */
    document.body.append(link)
    link.click()
    link.remove()

    setTimeout(() => {
        URL.revokeObjectURL(url)
    }, 60_000)

    return name
}

function slug(title: string): string {
    const s = title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    return s || 'starforge'
}
