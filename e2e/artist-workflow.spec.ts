import { expect, test } from '@playwright/test'
import { openEditor } from './editor'

test('selection modes are available without keyboard modifiers', async ({ page }) => {
    await openEditor(page)
    await page.getByRole('button', { name: 'Select', exact: true }).click()

    const modes = page.getByTestId('selection-modes')
    await expect(modes.getByRole('button')).toHaveCount(4)
    await modes.getByRole('button', { name: 'Add to selection' }).click()

    await expect(modes.getByRole('button', { name: 'Add to selection' })).toHaveAttribute(
        'aria-pressed',
        'true',
    )
})

test('tablet portrait uses the compact controls without wrapping tools', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await openEditor(page)

    await expect(page.getByTestId('mobile-tool-options')).toBeVisible()
    await page.getByTestId('mobile-layers').click()
    await expect(page.getByTestId('drawer-scrim')).toBeVisible()

    const toolRows = await page.locator('[class*="toolStrip"]').evaluateAll((rows) =>
        rows.map((row) => {
            const buttons = [...row.querySelectorAll('button')]
            return new Set(buttons.map((button) => button.getBoundingClientRect().top)).size
        }),
    )
    expect(toolRows).toEqual([1])
})

test('frames dock above the bottom tools and toggle off', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await openEditor(page)

    const frames = page.getByTestId('mobile-frames')
    await frames.click()
    const section = page.getByTestId('mobile-frames-section')
    await expect(section).toBeVisible()
    await expect(frames).toHaveAttribute('aria-expanded', 'true')

    const sectionBox = await section.boundingBox()
    const dockBox = await page.getByTestId('mobile-tool-options').boundingBox()
    expect(sectionBox!.y + sectionBox!.height).toBeLessThanOrEqual(dockBox!.y + 1)

    await frames.click()
    await expect(section).toBeHidden()
    await expect(frames).toHaveAttribute('aria-expanded', 'false')
})

test('paint colours sit with tool controls and use a full-width opacity slider', async ({
    page,
}) => {
    const keyWarnings: string[] = []
    page.on('console', (message) => {
        if (message.text().includes('same key')) keyWarnings.push(message.text())
    })
    await page.setViewportSize({ width: 1200, height: 800 })
    await openEditor(page)

    const palette = page.getByTestId('paint-colors')
    const canvas = page.getByTestId('canvas')
    await expect(
        palette.getByRole('button', { name: 'Swap foreground and background' }),
    ).toBeVisible()
    await expect(
        palette.getByRole('button', { name: 'Reset foreground and background' }),
    ).toBeVisible()

    expect(
        await palette.evaluate(
            (bar, drawing) =>
                Boolean(bar.compareDocumentPosition(drawing) & Node.DOCUMENT_POSITION_FOLLOWING),
            await canvas.elementHandle(),
        ),
    ).toBe(true)

    const opacity = page.getByTestId('ink-opacity')
    expect((await opacity.boundingBox())!.width).toBeGreaterThanOrEqual(120)
    await expect(palette.locator('[data-testid="swatch-color"]')).toHaveCount(
        await palette.getByTestId('swatch').count(),
    )
    expect(keyWarnings).toEqual([])
})

test('palette colours commit without leaving the editor', async ({ page }) => {
    await openEditor(page)
    await page.getByTestId('open-palette').click()
    const dialog = page.getByTestId('palette-dialog')
    await expect(dialog).toBeVisible()

    const before = await dialog.getByTestId('palette-swatch').count()
    await dialog.getByTestId('hex').fill('#c0ffee')
    await dialog.getByTestId('hex').press('Enter')
    await expect(dialog.getByTestId('palette-add')).toBeEnabled()
    await dialog.getByTestId('palette-add').click()
    await expect(dialog.getByTestId('palette-swatch')).toHaveCount(before + 1)
    await expect(dialog).toBeVisible()
})

test('an active selection shows a clear action', async ({ page }) => {
    await openEditor(page)
    await page.getByRole('button', { name: 'Select', exact: true }).click()

    const canvas = page.getByTestId('canvas')
    const box = await canvas.boundingBox()
    if (!box) throw new Error('canvas is not visible')
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 8 })
    await page.mouse.up()

    await expect(page.getByTestId('selection-active')).toBeVisible()
    await page.getByRole('button', { name: 'Clear selection' }).click()
    await expect(page.getByTestId('selection-active')).toBeHidden()
})
