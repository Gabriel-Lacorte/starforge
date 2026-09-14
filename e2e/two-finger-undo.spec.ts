import { devices, expect, test } from '@playwright/test'
import { canvasFingerprint } from './editor'

test.use({ ...devices['Pixel 7'], hasTouch: true, isMobile: true })

test('a two-finger tap undoes the last stroke', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => {
        errors.push(String(error))
    })
    await page.goto('/')
    const canvas = page.getByTestId('canvas')
    await expect(canvas).toBeVisible()
    const box = await canvas.boundingBox()
    if (!box) throw new Error('canvas is not visible')
    const blank = await canvasFingerprint(canvas)

    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => canvasFingerprint(canvas)).not.toBe(blank)

    const cx = box.x + box.width * 0.5
    const cy = box.y + box.height * 0.5
    const cdp = await page.context().newCDPSession(page)
    try {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [
                { x: cx - 20, y: cy, id: 1 },
                { x: cx + 20, y: cy, id: 2 },
            ],
        })
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchEnd',
            touchPoints: [
                { x: cx - 20, y: cy, id: 1 },
                { x: cx + 20, y: cy, id: 2 },
            ],
        })
    } finally {
        await cdp.detach()
    }
    await expect.poll(() => canvasFingerprint(canvas), { timeout: 5000 }).toBe(blank)
    expect(errors).toEqual([])
})
