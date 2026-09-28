import { expect, test } from '@playwright/test'
import { canvasFingerprint, openEditor } from './editor'

test('an 8x8 canvas is a first-class size', async ({ page }) => {
    const canvas = await openEditor(page)
    const before = await canvasFingerprint(canvas)

    await page.getByTestId('new-sprite').click()
    const dialog = page.getByTestId('new-dialog')
    await expect(dialog).toBeVisible()

    await dialog.getByTestId('size-preset').filter({ hasText: '8' }).first().click()
    await dialog.getByTestId('new-create').click()
    await expect(dialog).toBeHidden()

    await expect(page.getByTestId('doc-size')).toHaveText('8x8')

    const box = (await canvas.boundingBox())!
    await page.getByTestId('swatch').nth(5).click()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    expect(await canvasFingerprint(canvas)).not.toBe(before)
})
