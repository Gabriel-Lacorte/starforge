import { expect, test } from '@playwright/test'
import { canvasFingerprint, painted } from './editor'

test('two browsers converge through the hand-rolled relay', async ({ browser, request }) => {
    const created = await request.post('/api/rooms', {
        data: { title: 'netlab', width: 64, height: 64 },
    })
    expect(created.ok()).toBe(true)
    const { id } = (await created.json()) as { id: string }
    const first = await browser.newContext()
    const second = await browser.newContext()
    const a = await first.newPage()
    const b = await second.newPage()
    try {
        await a.goto(`/dev/net?room=${id}`)
        await b.goto(`/dev/net?room=${id}`)
        const canvasA = a.getByTestId('canvas')
        const canvasB = b.getByTestId('canvas')
        await expect(canvasA).toBeVisible()
        await expect(canvasB).toBeVisible()
        await expect(a.getByTestId('net-status')).toContainText('open')
        await expect(b.getByTestId('net-status')).toContainText('open')

        const boxA = await canvasA.boundingBox()
        const boxB = await canvasB.boundingBox()
        if (!boxA || !boxB || boxA.width === 0 || boxB.width === 0)
            throw new Error('lab canvas is not visible')
        await painted(a)
        await painted(b)
        const blank = await canvasFingerprint(canvasA)
        await a.mouse.move(boxA.x + boxA.width * 0.4, boxA.y + boxA.height * 0.5)
        await a.mouse.down()
        await a.mouse.move(boxA.x + boxA.width * 0.6, boxA.y + boxA.height * 0.5, { steps: 12 })
        await a.mouse.up()
        await b.mouse.move(boxB.x + boxB.width * 0.5, boxB.y + boxB.height * 0.4)
        await b.mouse.down()
        await b.mouse.move(boxB.x + boxB.width * 0.5, boxB.y + boxB.height * 0.6, { steps: 12 })
        await b.mouse.up()
        await painted(a)
        await painted(b)
        await expect
            .poll(async () => canvasFingerprint(canvasA), { timeout: 15000 })
            .not.toBe(blank)
        await expect
            .poll(async () => canvasFingerprint(canvasB), { timeout: 15000 })
            .not.toBe(blank)
        await expect
            .poll(
                async () => {
                    const left = await canvasFingerprint(canvasA)
                    const right = await canvasFingerprint(canvasB)
                    return left === right && left !== blank ? 'converged' : `${left}/${right}`
                },
                { timeout: 15000 },
            )
            .toBe('converged')
    } finally {
        await first.close()
        await second.close()
    }
})
