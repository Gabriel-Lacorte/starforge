import { expect, test } from '@playwright/test'
import { canvasFingerprint, openEditor, painted } from './editor'

test('clipboard: cut erases the star, paste floats it back, stamp and undo', async ({ page }) => {
    const canvas = await openEditor(page)
    const original = await canvasFingerprint(canvas)

    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+c')

    await page.keyboard.press('Control+x')
    await painted(page)
    const cleared = await canvasFingerprint(canvas)
    expect(cleared).not.toBe(original)

    await page.keyboard.press('Control+v')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await painted(page)
    const stamped = await canvasFingerprint(canvas)
    expect(stamped).not.toBe(cleared)

    await page.keyboard.press('Control+z')
    await painted(page)
    expect(await canvasFingerprint(canvas)).toBe(cleared)
})

test('grid: the apostrophe key and the paint strip toggle show and hide the guides', async ({
    page,
}) => {
    await openEditor(page)

    const overlayPixels = () =>
        page.getByTestId('overlay').evaluate((el) => {
            const canvas = el as HTMLCanvasElement
            const ctx = canvas.getContext('2d')!
            const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
            let n = 0
            for (let i = 3; i < data.length; i += 4) if (data[i]! !== 0) n++
            return n
        })

    const before = await overlayPixels()
    await page.keyboard.press("'")
    await painted(page)
    await expect.poll(overlayPixels, { timeout: 5000 }).toBeGreaterThan(before + 50)

    const toggle = page.getByTestId('grid-toggle')
    await expect(toggle).toBeChecked()
    await toggle.uncheck()
    await painted(page)
    await expect.poll(overlayPixels, { timeout: 5000 }).toBeLessThanOrEqual(before + 5)
})

test('undo: with a floating selection, ctrl+z drops the float before touching history', async ({
    page,
}) => {
    const canvas = await openEditor(page)
    const original = await canvasFingerprint(canvas)

    await page.keyboard.press('Control+a')
    await page.keyboard.press('m')
    const box = await canvas.boundingBox()
    if (!box) throw new Error('no canvas box')
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 5 })

    await page.keyboard.press('Control+z')
    await page.mouse.up()
    await painted(page)
    expect(await canvasFingerprint(canvas)).toBe(original)
})
