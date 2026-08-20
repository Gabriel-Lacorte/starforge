import { expect, test, type Locator, type Page } from '@playwright/test'

async function canvasFingerprint(canvas: Locator): Promise<string> {
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

async function openEditor(page: Page): Promise<Locator> {
    await page.goto('/')
    const canvas = page.getByTestId('canvas')
    await canvas.waitFor()
    await expect(page.getByTestId('zoom')).not.toBeEmpty()

    return canvas
}

test('a stroke survives a reload and the drawing exports', async ({ page }) => {
    const canvas = await openEditor(page)
    const before = await canvasFingerprint(canvas)

    await page.getByTestId('swatch').nth(5).click()

    const box = (await canvas.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2

    await page.mouse.move(x - 40, y)
    await page.mouse.down()
    await page.mouse.move(x + 40, y, { steps: 16 })
    await page.mouse.up()

    const drawn = await canvasFingerprint(canvas)
    expect(drawn).not.toBe(before)

    await expect(page.getByTestId('status-save')).toHaveText(/saved/i)

    await openEditor(page)
    await expect
        .poll(() => canvasFingerprint(page.getByTestId('canvas')), { timeout: 5000 })
        .toBe(drawn)

    await page.getByTestId('export').click()
    const download = page.waitForEvent('download')
    await page.getByTestId('export-confirm').click()

    expect((await download).suggestedFilename()).toMatch(/\.png$/)
})
