import { expect, test } from '@playwright/test'
import { canvasFingerprint } from './editor'

test('a dropped tab rejoins and catches up to the live room', async ({ browser, request }) => {
    const created = await request.post('/api/rooms', {
        data: { title: 'e2e', width: 64, height: 64 },
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

        const boxA = await canvasA.boundingBox()
        if (!boxA) throw new Error('room canvas is not visible')
        const blankA = await canvasFingerprint(canvasA)
        await a.mouse.move(boxA.x + boxA.width * 0.4, boxA.y + boxA.height * 0.5)
        await a.mouse.down()
        await a.mouse.move(boxA.x + boxA.width * 0.6, boxA.y + boxA.height * 0.5, {
            steps: 12,
        })
        await a.mouse.up()

        await expect.poll(() => canvasFingerprint(canvasA)).not.toBe(blankA)
        await expect.poll(() => canvasFingerprint(canvasB)).toBe(await canvasFingerprint(canvasA))
        const firstStroke = await canvasFingerprint(canvasA)
        expect(firstStroke).not.toBe(blankA)

        await a.close()

        const third = await browser.newContext()
        const c = await third.newPage()
        try {
            await c.goto(`/r/${id}`)
            const canvasC = c.getByTestId('canvas')
            await expect(canvasC).toBeVisible()
            await expect(c.getByTestId('room-status')).toContainText('open')

            await expect.poll(() => canvasFingerprint(canvasC)).toBe(firstStroke)
            await expect(b.getByTestId('peer')).toHaveCount(1)

            const boxC = await canvasC.boundingBox()
            if (!boxC) throw new Error('rejoined canvas is not visible')
            const beforeSecond = await canvasFingerprint(canvasC)
            await c.mouse.move(boxC.x + boxC.width * 0.5, boxC.y + boxC.height * 0.4)
            await c.mouse.down()
            await c.mouse.move(boxC.x + boxC.width * 0.5, boxC.y + boxC.height * 0.6, {
                steps: 12,
            })
            await c.mouse.up()

            await expect.poll(() => canvasFingerprint(canvasC)).not.toBe(beforeSecond)
            await expect
                .poll(() => canvasFingerprint(canvasB))
                .toBe(await canvasFingerprint(canvasC))
        } finally {
            await third.close()
        }
    } finally {
        await first.close()
        await second.close()
    }
})

test('strokes painted offline replay after reconnect', async ({ browser, request }) => {
    const created = await request.post('/api/rooms', {
        data: { title: 'e2e', width: 64, height: 64 },
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

        await first.setOffline(true)
        const boxA = await canvasA.boundingBox()
        if (!boxA) throw new Error('room canvas is not visible')
        const blankA = await canvasFingerprint(canvasA)
        await a.mouse.move(boxA.x + boxA.width * 0.4, boxA.y + boxA.height * 0.5)
        await a.mouse.down()
        await a.mouse.move(boxA.x + boxA.width * 0.6, boxA.y + boxA.height * 0.5, {
            steps: 12,
        })
        await a.mouse.up()
        await expect.poll(() => canvasFingerprint(canvasA)).not.toBe(blankA)
        await first.setOffline(false)

        await expect(a.getByTestId('room-status')).toContainText('open', { timeout: 15000 })
        await expect
            .poll(() => canvasFingerprint(canvasB), { timeout: 15000 })
            .toBe(await canvasFingerprint(canvasA))
    } finally {
        await first.close()
        await second.close()
    }
})

test('undo never takes the other painter pixels', async ({ browser, request }) => {
    const created = await request.post('/api/rooms', {
        data: { title: 'e2e', width: 64, height: 64 },
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

        const boxA = await canvasA.boundingBox()
        const boxB = await canvasB.boundingBox()
        if (!boxA || !boxB) throw new Error('room canvas is not visible')
        const blank = await canvasFingerprint(canvasA)
        await a.mouse.move(boxA.x + boxA.width * 0.4, boxA.y + boxA.height * 0.5)
        await a.mouse.down()
        await a.mouse.move(boxA.x + boxA.width * 0.6, boxA.y + boxA.height * 0.5, {
            steps: 12,
        })
        await a.mouse.up()
        await b.mouse.move(boxB.x + boxB.width * 0.5, boxB.y + boxB.height * 0.4)
        await b.mouse.down()
        await b.mouse.move(boxB.x + boxB.width * 0.5, boxB.y + boxB.height * 0.6, {
            steps: 12,
        })
        await b.mouse.up()
        await expect
            .poll(() => canvasFingerprint(canvasB), { timeout: 15000 })
            .toBe(await canvasFingerprint(canvasA))

        await a.keyboard.press('Control+z')
        await expect
            .poll(() => canvasFingerprint(canvasB), { timeout: 15000 })
            .toBe(await canvasFingerprint(canvasA))
        expect(await canvasFingerprint(canvasA)).not.toBe(blank)
    } finally {
        await first.close()
        await second.close()
    }
})
