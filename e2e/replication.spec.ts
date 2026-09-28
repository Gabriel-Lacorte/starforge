import { expect, test, type Page } from '@playwright/test'
import { canvasFingerprint } from './editor'

const CONVERGE = { timeout: 8000 }

async function layerIds(page: Page): Promise<string[]> {
    return page
        .getByTestId('layer-row')
        .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.layerId ?? ''))
}

async function frameIds(page: Page): Promise<string[]> {
    return page
        .getByTestId('frame-cell')
        .evaluateAll((cells) => cells.map((cell) => cell.parentElement!.dataset.frameId ?? ''))
}

async function fingerprint(page: Page): Promise<string> {
    return canvasFingerprint(page.getByTestId('canvas'))
}

test('structure ops converge on the other member without a reload', async ({
    browser,
    request,
}) => {
    test.setTimeout(90_000)
    const created = await request.post('/api/rooms', {
        data: { title: 'convergence', width: 64, height: 64 },
    })
    expect(created.ok()).toBe(true)
    const { id } = (await created.json()) as { id: string }
    const ctxA = await browser.newContext()
    const ctxB = await browser.newContext()
    const a = await ctxA.newPage()
    const b = await ctxB.newPage()
    try {
        await a.goto(`/r/${id}`)
        await b.goto(`/r/${id}`)
        await expect(a.getByTestId('room-status')).toContainText('open')
        await expect(b.getByTestId('room-status')).toContainText('open')

        const box = (await a.getByTestId('canvas').boundingBox())!
        const paintStroke = async (color: number, x0: number, x1: number): Promise<void> => {
            await a.getByTestId('swatch').nth(color).click()
            await a.mouse.move(box.x + box.width * x0, box.y + box.height * 0.5)
            await a.mouse.down()
            await a.mouse.move(box.x + box.width * x1, box.y + box.height * 0.5, { steps: 8 })
            await a.mouse.up()
        }

        const blank = await fingerprint(b)
        await paintStroke(5, 0.25, 0.6)
        await expect.poll(() => fingerprint(b), CONVERGE).not.toBe(blank)

        await a.getByTestId('layer-add').click()
        await expect.poll(async () => (await layerIds(b)).length, CONVERGE).toBe(2)
        await paintStroke(9, 0.4, 0.75)
        await expect.poll(() => fingerprint(b), CONVERGE).not.toBe(blank)

        const stacked = await fingerprint(b)

        const orderBeforeDrag = await layerIds(b)
        const rows = a.getByTestId('layer-row')
        const top = (await rows.nth(0).boundingBox())!
        const second = (await rows.nth(1).boundingBox())!
        await a.mouse.move(top.x + top.width / 2, top.y + top.height / 2)
        await a.mouse.down()
        await a.mouse.move(second.x + second.width / 2, second.y + second.height * 0.9, {
            steps: 8,
        })
        await a.mouse.up()
        await expect.poll(() => layerIds(b), CONVERGE).not.toEqual(orderBeforeDrag)
        await expect.poll(() => fingerprint(b), CONVERGE).not.toBe(stacked)

        const orderBeforeButton = await layerIds(b)
        await a.getByTestId('layer-select').nth(0).click()
        await a.getByTestId('layer-down').click()
        await expect.poll(() => layerIds(b), CONVERGE).not.toEqual(orderBeforeButton)

        const beforeEye = await fingerprint(b)
        await a.getByTestId('layer-eye').nth(0).click()
        await expect.poll(() => fingerprint(b), CONVERGE).not.toBe(beforeEye)
        await expect
            .poll(async () => b.getByTestId('layer-eye').nth(0).getAttribute('aria-pressed'))
            .toBe('true')

        await a.getByTestId('frame-add').click()
        await expect
            .poll(async () => (await frameIds(b)).length, CONVERGE)
            .toBe((await frameIds(a)).length)
        const framesBeforeDrag = await frameIds(b)
        const cells = a.getByTestId('frame-cell')
        const first = (await cells.nth(0).boundingBox())!
        const next = (await cells.nth(1).boundingBox())!
        await a.mouse.move(first.x + first.width / 2, first.y + first.height / 2)
        await a.mouse.down()
        await a.mouse.move(next.x + next.width * 0.9, next.y + next.height / 2, { steps: 8 })
        await a.mouse.up()
        await expect.poll(() => frameIds(b), CONVERGE).not.toEqual(framesBeforeDrag)

        const swatchesBefore = await b.getByTestId('swatch').count()
        await a.getByTestId('fg-color').click()
        const hex = a.getByTestId('hex')
        await hex.fill('#c0ffee')
        await hex.press('Enter')
        await a.keyboard.press('Escape')
        await a.getByTestId('swatch-add').click()
        await expect
            .poll(async () => b.getByTestId('swatch').count(), CONVERGE)
            .toBe(swatchesBefore + 1)

        await a.getByTestId('doc-title').click()
        await a.getByTestId('doc-title-input').fill('shared room')
        await a.keyboard.press('Enter')
        await expect
            .poll(async () => b.getByTestId('doc-title').textContent(), CONVERGE)
            .toBe('shared room')
    } finally {
        await ctxA.close()
        await ctxB.close()
    }
})
