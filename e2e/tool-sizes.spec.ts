import { expect, test } from '@playwright/test'

test('pencil and eraser keep independent sizes', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('canvas')).toBeVisible()
    await page.getByTestId('canvas').click()
    const size = page.getByTestId('brush-size')
    await expect(size).toHaveText('1')

    const slider = page.getByTestId('brush-slider')
    await slider.press('ArrowRight')
    await slider.press('ArrowRight')
    await expect(size).toHaveText('3')
    await expect(page.getByTestId('status-brush')).toContainText('brush 3')

    await page.keyboard.press('e')
    await expect(size).toHaveText('1')
    await expect(page.getByTestId('status-brush')).toContainText('eraser 1')
    await page.getByTestId('brush-slider').press('ArrowRight')
    await expect(size).toHaveText('2')

    await page.keyboard.press('b')
    await expect(size).toHaveText('3')
    await expect(page.getByTestId('status-brush')).toContainText('brush 3')
})

test('the size slider never passes a quarter of the smaller side', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('brush-slider')).toBeVisible()

    const slider = page.getByTestId('brush-slider')
    for (let i = 0; i < 30; i++) await slider.press('ArrowRight')
    await expect(page.getByTestId('brush-size')).toHaveText('16')
    await expect(page.getByTestId('status-brush')).toContainText('brush 16')
})
