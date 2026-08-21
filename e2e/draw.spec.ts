import { expect, test } from '@playwright/test'
import { canvasFingerprint, openEditor } from './editor'

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
