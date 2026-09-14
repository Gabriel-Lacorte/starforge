import { expect, test } from '@playwright/test'
import { canvasFingerprint } from './editor'

test('two tabs share one room link and converge', async ({ browser, request }) => {
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
        await expect(a.getByTestId('peer')).toHaveCount(1)
        await expect(b.getByTestId('peer')).toHaveCount(1)

        const boxA = await canvasA.boundingBox()
        const boxB = await canvasB.boundingBox()
        if (!boxA || !boxB) throw new Error('room canvas is not visible')
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

        await expect.poll(() => canvasFingerprint(canvasB)).toBe(await canvasFingerprint(canvasA))
    } finally {
        await first.close()
        await second.close()
    }
})

test('canvas size locks while the room is open', async ({ page, request }) => {
    const created = await request.post('/api/rooms', {
        data: { title: 'e2e', width: 64, height: 64 },
    })
    expect(created.ok()).toBe(true)
    const { id } = (await created.json()) as { id: string }
    await page.goto(`/r/${id}`)
    await expect(page.getByTestId('canvas')).toBeVisible()
    await expect(page.getByTestId('room-status')).toContainText('open')
    await expect(page.getByRole('link', { name: 'About' })).toHaveCSS(
        'text-decoration-line',
        'underline',
    )
    await page.getByTestId('canvas-size').click()
    await expect(page.getByTestId('room-size-locked')).toContainText(
        'Canvas size is locked while the room is open.',
    )
})

test('rooms show no storage banner; the share panel carries the link', async ({
    page,
    request,
}) => {
    const created = await request.post('/api/rooms', {
        data: { title: 'e2e', width: 64, height: 64 },
    })
    expect(created.ok()).toBe(true)
    const { id } = (await created.json()) as { id: string }
    await page.goto(`/r/${id}`)
    await expect(page.getByTestId('canvas')).toBeVisible()
    await expect(page.getByTestId('room-status')).toContainText('open')
    await expect(page.getByTestId('status-project')).toBeHidden()
    await page.getByTestId('share').click()
    await expect(page.getByTestId('share-panel')).toBeVisible()
    await expect(page.getByTestId('share-link')).toHaveValue(new RegExp(`/r/${id}$`))
})

test('the room tab close button leaves back home', async ({ page, request }) => {
    const created = await request.post('/api/rooms', {
        data: { title: 'e2e', width: 64, height: 64 },
    })
    expect(created.ok()).toBe(true)
    const { id } = (await created.json()) as { id: string }
    await page.goto(`/r/${id}`)
    await expect(page.getByTestId('canvas')).toBeVisible()
    await expect(page.getByTestId('room-status')).toContainText('open')
    await page.getByTestId('room-tab-close').click()
    await expect(page.getByTestId('room-status')).toBeHidden()
    await expect(page).toHaveURL(/\/$/)
})

test('share in the solo editor opens a room link both windows paint', async ({ browser }) => {
    const first = await browser.newContext()
    const page = await first.newPage()
    try {
        await page.goto('/')
        await expect(page.getByTestId('canvas')).toBeVisible()
        await page.getByTestId('share').click()
        await page.waitForURL(/\/r\/[A-Za-z0-9_-]{12}/, { timeout: 15000 })
        const url = page.url()
        await expect(page.getByTestId('share-panel')).toBeVisible()
        await expect(page.getByTestId('share-link')).toHaveValue(url)
        const second = await browser.newContext()
        const other = await second.newPage()
        try {
            await other.goto(new URL(url).pathname)
            await expect(other.getByTestId('canvas')).toBeVisible()
            await expect(other.getByTestId('room-status')).toContainText('open', {
                timeout: 15000,
            })
            await expect(page.getByTestId('room-status')).toContainText('open', {
                timeout: 15000,
            })
        } finally {
            await second.close()
        }
    } finally {
        await first.close()
    }
})

test('share disables while the room is being created', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('canvas')).toBeVisible()
    await page.route('**/api/rooms', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 500))
        await route.continue()
    })
    try {
        await page.getByTestId('share').click()
        await expect(page.getByTestId('share')).toBeDisabled()
        await page.waitForURL(/\/r\/[A-Za-z0-9_-]{12}/, { timeout: 15000 })
    } finally {
        await page.unrouteAll({ behavior: 'wait' })
    }
})
