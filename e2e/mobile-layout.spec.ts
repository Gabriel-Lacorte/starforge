import { devices, expect, test } from '@playwright/test'

test.use({ ...devices['Pixel 7'], hasTouch: true, isMobile: true })

test('first-visit hint speaks touch, not keyboard, on mobile', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.removeItem('starforge:hint-dismissed')
    })
    await page.goto('/')
    await expect(page.getByTestId('canvas')).toBeVisible()
    const hint = page.getByTestId('first-visit-hint')
    await expect(hint).toBeVisible()
    await expect(hint).toContainText('two-finger tap undoes')
    await expect(hint).not.toContainText('shortcuts')
})

test('mobile file sheet shows labeled actions', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('canvas')).toBeVisible()
    await page.getByTestId('mobile-file').tap()
    const sheet = page.getByTestId('mobile-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Share' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Layers' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Keys' })).toHaveCount(0)
    await expect(sheet.getByTestId('mobile-gestures')).toContainText('Gestures')
    await sheet.getByTestId('mobile-gestures').tap()
    const dialog = page.getByTestId('keys-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Two-finger tap')
    await expect(dialog).toContainText('Pinch')
})

test('mobile timeline gives the reel its own full row', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('canvas')).toBeVisible()
    await page.getByTestId('mobile-frames').tap()
    const section = page.getByTestId('mobile-frames-section')
    await expect(section).toBeVisible()
    const reel = section.locator('ol')
    const tools = section.getByRole('button', { name: 'Add frame' })
    await expect(tools).toBeVisible()
    const sectionBox = await section.boundingBox()
    const reelBox = await reel.boundingBox()
    const toolsBox = await tools.boundingBox()
    if (!sectionBox || !reelBox || !toolsBox) throw new Error('timeline is not visible')
    expect(reelBox.width).toBeGreaterThanOrEqual(sectionBox.width - 16)
    expect(reelBox.y).toBeGreaterThan(toolsBox.y + toolsBox.height)
})
