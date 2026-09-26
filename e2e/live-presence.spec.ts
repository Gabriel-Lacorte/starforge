import { expect, test } from '@playwright/test'
import { canvasFingerprint } from './editor'

test('live strokes: a held-down drag paints on the other screen before release', async ({
    browser,
    request,
}) => {
    const created = await request.post('/api/rooms', {
        data: { title: 'live-stroke', width: 64, height: 64 },
    })
    expect(created.ok()).toBe(true)
    const { id } = (await created.json()) as { id: string }
    const first = await browser.newContext()
    const second = await browser.newContext()
    const a = await first.newPage()
    const b = await second.newPage()
    try {
        await a.goto(`/r/${id}`)
        await b.goto(`/r/${id}`)
        const canvasA = a.getByTestId('canvas')
        const canvasB = b.getByTestId('canvas')
        await expect(canvasA).toBeVisible()
        await expect(canvasB).toBeVisible()
        await expect(a.getByTestId('room-status')).toContainText('open')
        await expect(b.getByTestId('room-status')).toContainText('open')

        const previewPixels = (page: typeof a): Promise<number> =>
            page.getByTestId('overlay').evaluate((el) => {
                const canvas = el as HTMLCanvasElement
                const ctx = canvas.getContext('2d')!
                const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
                let painted = 0
                for (let i = 0; i < data.length; i += 4) {
                    if (
                        data[i + 3] !== 0 &&
                        data[i] === 255 &&
                        data[i + 1] === 255 &&
                        data[i + 2] === 255
                    )
                        painted++
                }
                return painted
            })

        const box = await canvasA.boundingBox()
        if (!box) throw new Error('no canvas box')
        const blank = await canvasFingerprint(canvasB)

        await a.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5)
        await a.mouse.down()
        await a.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 24 })
        await expect.poll(() => previewPixels(b), { timeout: 8000 }).toBeGreaterThan(200)

        await a.mouse.up()
        await expect.poll(() => canvasFingerprint(canvasB), { timeout: 8000 }).not.toBe(blank)
    } finally {
        await first.close()
        await second.close()
    }
})

test('live cursors: hover in one room painter draws on the other overlay', async ({
    browser,
    request,
}) => {
    const created = await request.post('/api/rooms', {
        data: { title: 'cursors', width: 32, height: 32 },
    })
    expect(created.ok()).toBe(true)
    const { id } = (await created.json()) as { id: string }
    const first = await browser.newContext()
    const second = await browser.newContext()
    const a = await first.newPage()
    const b = await second.newPage()
    try {
        await a.goto(`/r/${id}`)
        await b.goto(`/r/${id}`)
        const canvasA = a.getByTestId('canvas')
        const canvasB = b.getByTestId('canvas')
        await expect(canvasA).toBeVisible()
        await expect(canvasB).toBeVisible()
        await expect(a.getByTestId('room-status')).toContainText('open')
        await expect(b.getByTestId('room-status')).toContainText('open')

        const box = await canvasA.boundingBox()
        if (!box) throw new Error('no canvas box')
        await a.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5)
        await expect(a.getByTestId('hover-pos')).not.toHaveText('-')

        const overlayPixels = (page: typeof a): Promise<number> =>
            page.getByTestId('overlay').evaluate((el) => {
                const canvas = el as HTMLCanvasElement
                const ctx = canvas.getContext('2d')!
                const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
                let painted = 0
                for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) painted++
                return painted
            })

        await expect.poll(() => overlayPixels(b), { timeout: 8000 }).toBeGreaterThan(0)

        await a.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.7)
        await expect.poll(() => overlayPixels(b), { timeout: 8000 }).toBeGreaterThan(0)
    } finally {
        await first.close()
        await second.close()
    }
})

test('live identity: a color change reaches the other painter without reload', async ({
    browser,
    request,
}) => {
    const created = await request.post('/api/rooms', {
        data: { title: 'colors', width: 32, height: 32 },
    })
    expect(created.ok()).toBe(true)
    const { id } = (await created.json()) as { id: string }
    const first = await browser.newContext()
    const second = await browser.newContext()
    const a = await first.newPage()
    const b = await second.newPage()
    try {
        await a.goto(`/r/${id}`)
        await b.goto(`/r/${id}`)
        await expect(a.getByTestId('room-status')).toContainText('open')
        await expect(b.getByTestId('room-status')).toContainText('open')

        await a
            .getByTestId('share')
            .click()
            .catch(async () => {
                await a.getByRole('button', { name: /share/i }).first().click()
            })
        const swatches = a.getByTestId('share-swatch')
        await swatches.nth(3).click()

        const dot = b.getByTestId('peer').first().locator('span').first()
        await expect
            .poll(() => dot.evaluate((el) => getComputedStyle(el).backgroundColor), {
                timeout: 8000,
            })
            .toBe('rgb(51, 204, 255)')
    } finally {
        await first.close()
        await second.close()
    }
})
