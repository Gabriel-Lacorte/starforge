import { expect, test } from '@playwright/test'
import { canvasFingerprint } from './editor'

test('two browsers converge through the hand-rolled relay', async ({ browser }) => {
    const first = await browser.newContext()
    const second = await browser.newContext()
    const a = await first.newPage()
    const b = await second.newPage()
    try {
        await a.goto('/dev/net')
        await b.goto('/dev/net')
        const canvasA = a.getByTestId('canvas')
        const canvasB = b.getByTestId('canvas')
        await expect(canvasA).toBeVisible()
        await expect(canvasB).toBeVisible()
        await expect(a.getByTestId('net-status')).toContainText('open')
        await expect(b.getByTestId('net-status')).toContainText('open')

        const boxA = await canvasA.boundingBox()
        const boxB = await canvasB.boundingBox()
        if (!boxA || !boxB) throw new Error('lab canvas is not visible')
        await a.mouse.move(boxA.x + boxA.width * 0.4, boxA.y + boxA.height * 0.5)
        await a.mouse.down()
        await a.mouse.move(boxA.x + boxA.width * 0.6, boxA.y + boxA.height * 0.5, { steps: 12 })
        await a.mouse.up()
        await b.mouse.move(boxB.x + boxB.width * 0.5, boxB.y + boxB.height * 0.4)
        await b.mouse.down()
        await b.mouse.move(boxB.x + boxB.width * 0.5, boxB.y + boxB.height * 0.6, { steps: 12 })
        await b.mouse.up()

        await expect.poll(() => canvasFingerprint(canvasB)).toBe(await canvasFingerprint(canvasA))
    } finally {
        await first.close()
        await second.close()
    }
})
