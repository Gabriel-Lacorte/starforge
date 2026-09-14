import { expect, test } from '@playwright/test'

test('pencil and eraser keep independent sizes', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('canvas')).toBeVisible()
    await page.getByTestId('canvas').click()
    const size = page.getByTestId('brush-size')
    await expect(size).toHaveText('1')
    await page.getByRole('button', { name: 'Brush larger' }).click()
    await page.getByRole('button', { name: 'Brush larger' }).click()
    await expect(size).toHaveText('3')
    await expect(page.getByTestId('status-brush')).toContainText('brush 3')

    await page.keyboard.press('e')
    await expect(size).toHaveText('1')
    await expect(page.getByTestId('status-brush')).toContainText('eraser 1')
    await page.getByRole('button', { name: 'Eraser larger' }).click()
    await expect(size).toHaveText('2')

    await page.keyboard.press('b')
    await expect(size).toHaveText('3')
    await expect(page.getByTestId('status-brush')).toContainText('brush 3')
})
