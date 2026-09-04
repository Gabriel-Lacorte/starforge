import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasFingerprint, painted } from './editor'

async function stroke(
    page: Page,
    canvas: Locator,
    from: readonly [x: number, y: number],
    to: readonly [x: number, y: number],
): Promise<void> {
    const box = await canvas.boundingBox()
    if (!box) throw new Error('CRDT lab canvas is not visible')

    const point = ([x, y]: readonly [number, number]) => ({
        x: box.x + box.width * x,
        y: box.y + box.height * y,
    })
    const start = point(from)
    const end = point(to)

    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 12 })
    await page.mouse.up()
}

test('two real editors converge after reversed duplicate delivery', async ({ page }) => {
    await page.goto('/dev/crdt')

    const left = page.getByTestId('crdt-site-1')
    const right = page.getByTestId('crdt-site-2')
    const leftCanvas = left.getByTestId('canvas')
    const rightCanvas = right.getByTestId('canvas')

    await expect(leftCanvas).toBeVisible()
    await expect(rightCanvas).toBeVisible()
    await expect(page.getByTestId('zoom')).toHaveCount(2)
    await expect
        .poll(async () => [
            await canvasFingerprint(leftCanvas),
            await canvasFingerprint(rightCanvas),
        ])
        .toEqual([await canvasFingerprint(leftCanvas), await canvasFingerprint(leftCanvas)])

    await right.getByText('site 2', { exact: true }).click()
    await page.keyboard.press('e')
    await expect(left.getByTestId('status-tool')).toHaveText('pencil')
    await expect(right.getByTestId('status-tool')).toHaveText('eraser')
    await page.keyboard.press('p')

    await left.getByTestId('swatch').nth(5).click()
    await right.getByTestId('swatch').nth(9).click()
    await stroke(page, leftCanvas, [0.35, 0.5], [0.65, 0.5])
    await stroke(page, rightCanvas, [0.5, 0.35], [0.5, 0.65])
    await painted(page)

    await expect(page.getByTestId('crdt-queue-count')).toHaveText('2')
    await expect(page.getByTestId('crdt-status')).toContainText('documents differ')
    expect(await canvasFingerprint(leftCanvas)).not.toBe(await canvasFingerprint(rightCanvas))

    await page.getByTestId('crdt-reverse').click()
    await page.getByTestId('crdt-duplicate').click()
    await expect(page.getByTestId('crdt-queue-count')).toHaveText('3')
    await page.getByTestId('crdt-deliver-all').click()
    await painted(page)

    await expect(page.getByTestId('crdt-queue-count')).toHaveText('0')
    await expect(page.getByTestId('crdt-status')).toContainText('documents match')
    await expect
        .poll(() => canvasFingerprint(rightCanvas))
        .toBe(await canvasFingerprint(leftCanvas))

    // Central sweep: canvas letterbox around the fitted sprite maps the
    // corners out of bounds, so keep post-delivery strokes near the middle.
    await stroke(page, leftCanvas, [0.4, 0.4], [0.55, 0.55])
    await expect(page.getByTestId('crdt-queue-count')).toHaveText('1')
})
