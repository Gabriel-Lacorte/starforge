import { devices, expect, test, type Locator, type Page } from '@playwright/test'
import { canvasFingerprint } from './editor'

test.use({ ...devices['Pixel 7'], hasTouch: true, isMobile: true })

async function touchDrag(
    page: Page,
    canvas: Locator,
    fromFx: number,
    fromFy: number,
    toFx: number,
    toFy: number,
): Promise<void> {
    const box = await canvas.boundingBox()
    if (!box) throw new Error('canvas is not visible')
    const from = { x: box.x + box.width * fromFx, y: box.y + box.height * fromFy }
    const to = { x: box.x + box.width * toFx, y: box.y + box.height * toFy }
    const cdp = await page.context().newCDPSession(page)
    try {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x: from.x, y: from.y, id: 1 }],
        })
        const steps = 8
        for (let i = 1; i <= steps; i++) {
            await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: [
                    {
                        x: from.x + ((to.x - from.x) * i) / steps,
                        y: from.y + ((to.y - from.y) * i) / steps,
                        id: 1,
                    },
                ],
            })
        }
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchEnd',
            touchPoints: [{ x: to.x, y: to.y, id: 1 }],
        })
    } finally {
        await cdp.detach()
    }
}

async function dragPaints(
    page: Page,
    canvas: Locator,
    band: readonly [number, number, number, number],
): Promise<void> {
    const before = await canvasFingerprint(canvas)
    await touchDrag(page, canvas, band[0], band[1], band[2], band[3])
    await expect.poll(() => canvasFingerprint(canvas), { timeout: 5000 }).not.toBe(before)
}

test('touch drags paint, even after sheets and dialogs', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => {
        errors.push(String(error))
    })
    await page.goto('/')
    const canvas = page.getByTestId('canvas')
    await expect(canvas).toBeVisible()
    await dragPaints(page, canvas, [0.3, 0.5, 0.7, 0.5])

    await page.getByTestId('mobile-tool-options').click()
    await expect(page.getByTestId('mobile-sheet')).toBeVisible()
    await page.getByTestId('sheet-close').click()
    await expect(page.getByTestId('mobile-sheet')).toHaveCount(0)
    await dragPaints(page, canvas, [0.3, 0.35, 0.7, 0.35])

    await page.getByTestId('mobile-file').click()
    await expect(page.getByTestId('mobile-sheet')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('mobile-sheet')).toHaveCount(0)
    await dragPaints(page, canvas, [0.3, 0.65, 0.7, 0.65])

    await page.getByTestId('open-palette').click()
    await expect(page.getByTestId('palette-dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await dragPaints(page, canvas, [0.2, 0.5, 0.4, 0.5])

    expect(errors).toEqual([])
})
