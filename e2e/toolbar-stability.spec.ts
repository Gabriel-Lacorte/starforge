import { expect, test } from '@playwright/test'
import { openEditor, painted } from './editor'

test('switching tools never resizes the canvas', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await openEditor(page)

    const size = () =>
        page.evaluate(() => {
            const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="canvas"]')!
            return `${canvas.width}x${canvas.height}`
        })

    const buttons = page.locator('[class*="toolStrip"] button')
    const count = await buttons.count()
    expect(count).toBeGreaterThan(5)

    const baseline = await size()

    for (let i = 0; i < count; i++) {
        const button = buttons.nth(i)
        const label = (await button.getAttribute('aria-label')) ?? `tool ${i}`
        await button.click()
        await painted(page)

        expect(await size(), `canvas resized after picking ${label}`).toBe(baseline)
    }
})
