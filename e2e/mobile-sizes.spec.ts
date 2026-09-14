import { devices, expect, test } from '@playwright/test'

test.use({ ...devices['Pixel 7'], hasTouch: true, isMobile: true })

test('size readout stays visible and live on small screens', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('canvas')).toBeVisible()
    const num = page.getByTestId('status-brush-num')
    await expect(num).toBeVisible()
    await expect(num).toHaveText('1')

    await page.getByTestId('mobile-tool-options').click()
    await page.getByRole('button', { name: 'Brush larger' }).tap()
    await page.getByRole('button', { name: 'Brush larger' }).tap()
    await expect(num).toHaveText('3')
})
