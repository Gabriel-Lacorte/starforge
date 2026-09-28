import { expect, test } from '@playwright/test'
import { openEditor } from './editor'

test('the foreground swatch opens a picker that edits the ink live', async ({ page }) => {
    await openEditor(page)

    await page.getByTestId('fg-color').click()
    const popover = page.getByTestId('color-popover')
    await expect(popover).toBeVisible()

    const hex = popover.getByTestId('hex')
    await hex.fill('#ff8800')
    await hex.press('Enter')
    await expect(page.getByTestId('fg-color').locator('span').first()).toHaveCSS(
        'background-color',
        'rgb(255, 136, 0)',
    )

    const swatches = page.getByTestId('swatch')
    const before = await swatches.count()
    await page.getByTestId('popover-add').click()
    await expect(swatches).toHaveCount(before + 1)
    await expect(page.getByTestId('popover-add')).toBeDisabled()

    await page.keyboard.press('Escape')
    await expect(popover).toBeHidden()
})

test('right-clicking a swatch edits that palette colour in place', async ({ page }) => {
    await openEditor(page)

    const swatch = page.getByTestId('swatch').first()
    await swatch.click({ button: 'right' })
    const popover = page.getByTestId('color-popover')
    await expect(popover).toBeVisible()

    const hex = popover.getByTestId('hex')
    await hex.fill('#00ff88')
    await hex.press('Enter')
    await page.getByTestId('popover-save').click()
    await expect(popover).toBeHidden()
    await expect(swatch.getByTestId('swatch-color')).toHaveCSS(
        'background-color',
        'rgb(0, 255, 136)',
    )
})

test('the eyedropper adopts a foreign colour and files it into the palette', async ({ page }) => {
    const canvas = await openEditor(page)

    await page.getByTestId('fg-color').click()
    const hex = page.getByTestId('hex')
    await hex.fill('#c0ffee')
    await hex.press('Enter')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('color-popover')).toBeHidden()

    const box = (await canvas.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x - 20, y)
    await page.mouse.down()
    await page.mouse.move(x + 20, y, { steps: 8 })
    await page.mouse.up()

    const swatches = page.getByTestId('swatch')
    const before = await swatches.count()

    await page.keyboard.press('i')
    await page.mouse.click(x, y)

    await expect(swatches).toHaveCount(before + 1)
    await expect(page.getByTestId('fg-color').locator('span').first()).toHaveCSS(
        'background-color',
        'rgb(192, 255, 238)',
    )
})
