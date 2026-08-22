import { expect, test, type Page } from '@playwright/test'
import { openEditor, painted } from './editor'

async function drawStroke(page: Page): Promise<void> {
    const canvas = page.getByTestId('canvas')
    const box = (await canvas.boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx - 20, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 20, cy, { steps: 8 })
    await page.mouse.up()
    await painted(page)
}

test('GIF download starts with the GIF89a magic bytes', async ({ page }) => {
    await openEditor(page)
    await drawStroke(page)

    await page.getByTestId('frame-add').click()
    await page.getByTestId('canvas').waitFor()
    await drawStroke(page)

    await page.getByTestId('export').click()
    const dialog = page.getByTestId('export-dialog')
    await dialog.waitFor()

    const formatRadios = page.getByTestId('export-format')
    await formatRadios.nth(1).click()

    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('export-confirm').click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(/\.gif$/)

    const stream = await download.createReadStream()
    const bytes = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []
        stream.on('data', (chunk: Buffer) => chunks.push(chunk))
        stream.on('end', () => resolve(Buffer.concat(chunks)))
        stream.on('error', reject)
    })

    expect(bytes.subarray(0, 6).toString('ascii')).toBe('GIF89a')
    expect(bytes.length).toBeGreaterThan(20)
    expect(bytes[bytes.length - 1]).toBe(0x3b)
})

test('the export dialog previews the GIF, and its size follows the scale', async ({ page }) => {
    await openEditor(page)
    await drawStroke(page)

    await page.getByTestId('export').click()
    await page.getByTestId('export-dialog').waitFor()

    await page.getByTestId('export-format').nth(1).click()

    const previewImg = page.getByTestId('export-preview-img')
    await expect(previewImg).toBeVisible()
    await expect(previewImg).toHaveAttribute('src', /^blob:/)

    const sizeLabel = page.getByTestId('export-preview-size')
    await expect(sizeLabel).toBeVisible()
    const sizeAt1x = (await sizeLabel.textContent())!

    await page.getByText('4x', { exact: true }).click()
    await expect(sizeLabel).not.toHaveText(sizeAt1x)
})

test('the export dialog previews the spritesheet too', async ({ page }) => {
    await openEditor(page)
    await drawStroke(page)

    await page.getByTestId('export').click()
    await page.getByTestId('export-dialog').waitFor()

    await page.getByTestId('export-format').nth(2).click()

    const previewImg = page.getByTestId('export-preview-img')
    await expect(previewImg).toBeVisible()
    await expect(previewImg).toHaveAttribute('src', /^blob:/)
    await expect(page.getByTestId('export-preview-size')).toBeVisible()
})

test('first-visit hint appears and is dismissed by drawing', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.removeItem('starforge:hint-dismissed')
    })

    await openEditor(page)

    const hint = page.getByTestId('first-visit-hint')
    await expect(hint).toBeVisible()
    await expect(hint).toContainText('?')
    await expect(hint).toContainText('B')

    await drawStroke(page)
    await expect(hint).not.toBeVisible()
})

test('first-visit hint does not appear on a second visit', async ({ page }) => {
    await openEditor(page)
    await page.evaluate(() => localStorage.setItem('starforge:hint-dismissed', '1'))
    await page.reload()
    await page.getByTestId('canvas').waitFor()

    const hint = page.getByTestId('first-visit-hint')
    await expect(hint).not.toBeVisible()
})
