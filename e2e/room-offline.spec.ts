import { expect, test } from '@playwright/test'

test('an unknown room link shows not-found', async ({ page }) => {
    await page.goto('/r/000000000000')
    await expect(page.getByTestId('room-missing')).toContainText('Room not found')
    await expect(page.getByTestId('room-offline')).toHaveCount(0)
})

test('a dead relay shows offline with a working retry', async ({ page, request }) => {
    const created = await request.post('/api/rooms', {
        data: { title: 'e2e', width: 64, height: 64 },
    })
    expect(created.ok()).toBe(true)
    const { id } = (await created.json()) as { id: string }
    await page.route('**/api/rooms/*', (route) => route.abort())
    await page.goto(`/r/${id}`)
    await expect(page.getByTestId('room-offline')).toContainText('Relay offline')
    await expect(page.getByTestId('room-missing')).toHaveCount(0)
    await page.unrouteAll({ behavior: 'wait' })
    await page.getByTestId('room-retry').click()
    await expect(page.getByTestId('canvas')).toBeVisible()
    await expect(page.getByTestId('room-status')).toContainText('open')
    await expect(page.getByTestId('room-offline')).toHaveCount(0)
})
