import { expect, test, type Page } from '@playwright/test'
import { openEditor, painted } from './editor'

async function thumbInk(page: Page): Promise<number[]> {
    return page.evaluate(() => {
        const cells = document.querySelectorAll('[data-testid="frame-cell"] canvas')
        return [...cells].map((cell) => {
            const canvas = cell as HTMLCanvasElement
            const data = canvas
                .getContext('2d')!
                .getImageData(0, 0, canvas.width, canvas.height).data
            let sum = 0
            for (let i = 3; i < data.length; i += 4) sum += data[i]!
            return sum
        })
    })
}

async function thumbHash(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const cells = document.querySelectorAll('[data-testid="frame-cell"] canvas')
        return [...cells].map((cell) => {
            const canvas = cell as HTMLCanvasElement
            const data = canvas
                .getContext('2d')!
                .getImageData(0, 0, canvas.width, canvas.height).data
            let hash = 0
            for (const byte of data) hash = (hash * 31 + byte) | 0
            return (hash >>> 0).toString(16)
        })
    })
}

test('frame tiles show real thumbnails that follow the art', async ({ page }) => {
    const canvas = await openEditor(page)
    const cells = page.getByTestId('frame-cell')
    const started = await cells.count()

    const box = (await canvas.boundingBox())!
    await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 12 })
    await page.mouse.up()

    await page.getByTestId('frame-add').click()
    await expect(cells).toHaveCount(started + 1)
    await painted(page)

    await expect.poll(async () => (await thumbInk(page))[1] ?? -1, { timeout: 5000 }).toBe(0)
    const ink = await thumbInk(page)
    expect(ink).toHaveLength(started + 1)
    for (let i = 0; i < ink.length; i++) {
        if (i !== 1) expect(ink[i]).toBeGreaterThan(0)
    }
})

test('a stroke lands on its thumbnail without a reload', async ({ page }) => {
    const canvas = await openEditor(page)

    const before = (await thumbHash(page))[0] ?? ''
    await page.keyboard.press(']')
    await page.keyboard.press(']')
    await page.keyboard.press(']')
    await page.keyboard.press(']')
    await page.keyboard.press(']')
    const box = (await canvas.boundingBox())!
    await page.getByTestId('swatch').nth(5).click()
    await page.mouse.move(box.x + box.width / 2 - 20, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, { steps: 6 })
    await page.mouse.up()

    await expect
        .poll(async () => (await thumbHash(page))[0] ?? '', { timeout: 3000 })
        .not.toBe(before)
})

test('the gaps between tiles insert frames where they land', async ({ page }) => {
    await openEditor(page)
    const cells = page.getByTestId('frame-cell')
    const started = await cells.count()

    await page.getByTestId('frame-insert').first().click()
    await expect(cells).toHaveCount(started + 1)
    await expect(cells.first()).toHaveAttribute('aria-current', 'true')

    await page.getByTestId('frame-insert').last().click()
    await expect(cells).toHaveCount(started + 2)
    await expect(cells.last()).toHaveAttribute('aria-current', 'true')
})
