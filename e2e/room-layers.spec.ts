import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasFingerprint } from './editor'

async function openLayers(page: Page): Promise<void> {
    const panel = page.getByTestId('layers-panel')
    if (await panel.isVisible().catch(() => false)) return
    const canvas = page.getByTestId('canvas')
    const box = await canvas.boundingBox()
    if (!box) throw new Error('canvas not visible')
    await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * 0.5)
    await expect(page.getByTestId('layers-panel')).toBeVisible()
}

function layerRows(page: Page): Locator {
    return page.getByTestId('layer-row')
}

test('layer add, rename and remove reach the other painter and survive reload', async ({
    browser,
    request,
}) => {
    const created = await request.post('/api/rooms', {
        data: { title: 'e2e', width: 64, height: 64 },
    })
    expect(created.ok()).toBe(true)
    const { id } = (await created.json()) as { id: string }
    const first = await browser.newContext()
    const second = await browser.newContext()
    const a = await first.newPage()
    const b = await second.newPage()
    a.on('pageerror', (err): void => {
        console.log(`[A PAGEERROR] ${err.message}`)
    })
    b.on('pageerror', (err): void => {
        console.log(`[B PAGEERROR] ${err.message}`)
    })
    try {
        await a.goto(`/r/${id}?debug`)
        await b.goto(`/r/${id}`)
        await expect(a.getByTestId('canvas')).toBeVisible()
        await expect(b.getByTestId('canvas')).toBeVisible()
        await expect(a.getByTestId('room-status')).toContainText('open')
        await expect(b.getByTestId('room-status')).toContainText('open')

        await openLayers(a)
        await expect(layerRows(a)).toHaveCount(1)

        await a.getByTestId('layer-add').click()
        await expect(layerRows(a)).toHaveCount(2)

        await expect
            .poll(async () => layerRows(b).count(), { timeout: 8000 })
            .toBeGreaterThanOrEqual(2)

        await openLayers(b)
        await b.getByTestId('layer-row').first().click()
        const canvasB = b.getByTestId('canvas')
        const boxB = await canvasB.boundingBox()
        if (!boxB) throw new Error('B canvas not visible')
        const before = await canvasFingerprint(a.getByTestId('canvas'))
        await b.mouse.move(boxB.x + boxB.width * 0.3, boxB.y + boxB.height * 0.3)
        await b.mouse.down()
        await b.mouse.move(boxB.x + boxB.width * 0.7, boxB.y + boxB.height * 0.3, { steps: 8 })
        await b.mouse.up()
        await expect
            .poll(() => canvasFingerprint(a.getByTestId('canvas')), { timeout: 10000 })
            .not.toBe(before)

        await a.reload()
        await expect(a.getByTestId('room-status')).toContainText('open', { timeout: 15000 })
        await openLayers(a)
        await expect(layerRows(a)).toHaveCount(2)

        await a.getByTestId('layer-delete').click()
        await expect(layerRows(a)).toHaveCount(1)
        await expect.poll(async () => layerRows(b).count(), { timeout: 8000 }).toBe(1)
    } finally {
        const dump = await a
            .evaluate((): string => {
                const host = window as { __starforgeNetDump?: () => string }
                return host.__starforgeNetDump?.() ?? ''
            })
            .catch(() => '')
        if (dump !== '') console.log(`=== DUMP A ===\n${dump}`)
        await first.close()
        await second.close()
    }
})
