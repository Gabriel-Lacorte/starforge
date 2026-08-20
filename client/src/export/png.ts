import type { Sprite } from '@starforge/core'
import { downloadFile } from './download'
import { composeFrameCanvas } from './frame'

export async function exportFramePng(sprite: Sprite, frameId: string): Promise<string> {
    const canvas = composeFrameCanvas(sprite, frameId)
    const blob = await canvasPngBlob(canvas)
    const name = visualPngFilename(sprite.meta.title)
    downloadFile({ blob, filename: name })

    return name
}

export async function canvasPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    const blob = await new Promise<Blob | null>((resolve, reject) => {
        try {
            canvas.toBlob(resolve, 'image/png')
        } catch (cause) {
            reject(cause instanceof Error ? cause : new Error(String(cause)))
        }
    })
    if (!blob) throw new Error('the browser could not encode this frame')
    return blob
}

export function visualPngFilename(title: string): string {
    return `${slug(title)}.png`
}

export function portablePngFilename(title: string): string {
    return `${slug(title)}.starforge.png`
}

export function slug(title: string): string {
    const s = title
        .trim()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
        .replace(/-+$/g, '')
    return s || 'starforge'
}
