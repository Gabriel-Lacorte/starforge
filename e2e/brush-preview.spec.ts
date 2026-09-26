import { expect, test, type Page } from '@playwright/test'

interface CursorInk {
    artSize: string
    cursorSize: string
    inked: number
    boundsW: number
    boundsH: number
}

async function cursorState(page: Page): Promise<CursorInk> {
    return page.evaluate(() => {
        const art = document.querySelector<HTMLCanvasElement>('[data-testid="canvas"]')!
        const cursor = document.querySelector<HTMLCanvasElement>('[data-testid="brush-cursor"]')!

        const data = cursor.getContext('2d')!.getImageData(0, 0, cursor.width, cursor.height).data
        let inked = 0
        let minX = Infinity
        let minY = Infinity
        let maxX = -1
        let maxY = -1
        for (let i = 3, p = 0; i < data.length; i += 4, p++) {
            if (data[i] === 0) continue
            inked++
            const x = p % cursor.width
            const y = (p / cursor.width) | 0
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
        }

        return {
            artSize: `${art.width}x${art.height}`,
            cursorSize: `${cursor.width}x${cursor.height}`,
            inked,
            boundsW: inked > 0 ? maxX - minX + 1 : 0,
            boundsH: inked > 0 ? maxY - minY + 1 : 0,
        }
    })
}

test('the brush preview inks its own layer and grows with the brush', async ({ page, request }) => {
    const created = await request.post('/api/rooms', {
        data: { title: 'brush-preview', width: 32, height: 32 },
    })
    expect(created.ok()).toBe(true)
    const { id } = (await created.json()) as { id: string }

    await page.goto(`/r/${id}`)
    await expect(page.getByTestId('room-status')).toContainText('open', { timeout: 15000 })

    const canvas = page.getByTestId('canvas')
    const box = await canvas.boundingBox()
    if (!box) throw new Error('canvas not visible')

    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
    await expect
        .poll(async () => (await cursorState(page)).inked, { timeout: 5000 })
        .toBeGreaterThan(0)

    const one = await cursorState(page)
    expect(one.cursorSize).toBe(one.artSize)

    await page.keyboard.press(']')
    await page.keyboard.press(']')
    await page.keyboard.press(']')
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5)
    await expect
        .poll(async () => (await cursorState(page)).boundsW, { timeout: 5000 })
        .toBeGreaterThan(one.boundsW)
    const four = await cursorState(page)
    expect(four.boundsH).toBeGreaterThan(one.boundsH)

    await page.mouse.move(box.x - 30, box.y - 30)
    await expect.poll(async () => (await cursorState(page)).inked, { timeout: 5000 }).toBe(0)
})

test('a marquee tool promises no pixel: no preview, a move cursor over its selection', async ({
    page,
    request,
}) => {
    const created = await request.post('/api/rooms', {
        data: { title: 'marquee-cursor', width: 32, height: 32 },
    })
    expect(created.ok()).toBe(true)
    const { id } = (await created.json()) as { id: string }

    await page.goto(`/r/${id}`)
    await expect(page.getByTestId('room-status')).toContainText('open', { timeout: 15000 })

    const canvas = page.getByTestId('canvas')
    const box = await canvas.boundingBox()
    if (!box) throw new Error('canvas not visible')

    await page.keyboard.press('m')
    const cx = box.x + box.width * 0.5
    const cy = box.y + box.height * 0.5
    await page.mouse.move(cx, cy)
    await page.waitForTimeout(300)
    expect(await cursorState(page)).toMatchObject({ inked: 0, boundsW: 0, boundsH: 0 })

    await page.keyboard.press('Control+a')
    await page.mouse.move(cx, cy)
    await expect
        .poll(
            () =>
                page.evaluate(() => {
                    const el = document.querySelector('[data-testid="canvas"]')!
                    return getComputedStyle(el).cursor
                }),
            { timeout: 5000 },
        )
        .toBe('move')

    expect(await cursorState(page)).toMatchObject({ inked: 0 })
})
