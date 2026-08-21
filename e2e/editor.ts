import { expect, type Locator, type Page } from '@playwright/test'

export async function canvasFingerprint(canvas: Locator): Promise<string> {
    return canvas.evaluate((element) => {
        const el = element as HTMLCanvasElement
        const ctx = el.getContext('2d', { willReadFrequently: true })
        if (!ctx) throw new Error('2d context unavailable')

        const { data } = ctx.getImageData(0, 0, el.width, el.height)
        let hash = 0x811c9dc5
        for (let i = 0; i < data.length; i += 4) {
            hash ^= data[i]! | (data[i + 1]! << 8) | (data[i + 2]! << 16) | (data[i + 3]! << 24)
            hash = Math.imul(hash, 0x01000193)
        }

        return (hash >>> 0).toString(16)
    })
}

export async function openEditor(page: Page): Promise<Locator> {
    await page.goto('/')
    const canvas = page.getByTestId('canvas')
    await canvas.waitFor()
    await expect(page.getByTestId('zoom')).not.toBeEmpty()

    return canvas
}

export async function painted(page: Page): Promise<void> {
    await page.evaluate(
        () =>
            new Promise<void>((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            }),
    )
}
