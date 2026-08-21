import { expect, test, type Page } from '@playwright/test'
import { canvasFingerprint, openEditor, painted } from './editor'

interface DevHandle {
    stats(): { recompositions: number }
}

async function recompositions(page: Page): Promise<number> {
    return page.evaluate(() => {
        const dev = (window as unknown as { __starforge?: DevHandle }).__starforge
        if (!dev) throw new Error('the dev handle is missing: the editor must run in dev mode')

        return dev.stats().recompositions
    })
}

test('an empty frame shows the neighbour behind it until the ghosts are switched off', async ({
    page,
}) => {
    const canvas = await openEditor(page)
    const onion = page.getByTestId('onion')

    await page.getByTestId('frame-add').click()
    await painted(page)
    const ghosted = await canvasFingerprint(canvas)

    await expect(onion).toHaveAttribute('aria-pressed', 'true')
    await onion.click()
    await expect(onion).toHaveAttribute('aria-pressed', 'false')
    await painted(page)

    const bare = await canvasFingerprint(canvas)
    expect(bare).not.toBe(ghosted)

    await onion.click()
    await painted(page)
    expect(await canvasFingerprint(canvas)).toBe(ghosted)
})

test('the ghosts step aside while the reel plays', async ({ page }) => {
    const canvas = await openEditor(page)
    const onion = page.getByTestId('onion')

    await page.getByTestId('frame-add').click()

    const duration = page.getByTestId('frame-duration')
    await duration.fill('5000')
    await duration.blur()
    await expect(duration).toHaveValue('5000')

    await painted(page)
    const ghosted = await canvasFingerprint(canvas)

    await onion.click()
    await painted(page)
    const bare = await canvasFingerprint(canvas)
    expect(bare).not.toBe(ghosted)

    await onion.click()
    await painted(page)
    expect(await canvasFingerprint(canvas)).toBe(ghosted)

    await page.getByTestId('playback-toggle').click()
    await painted(page)
    expect(await canvasFingerprint(canvas)).toBe(bare)

    await page.getByTestId('playback-toggle').click()
    await painted(page)
    expect(await canvasFingerprint(canvas)).toBe(ghosted)
})

test('switching the ghosts on and off composites nothing new', async ({ page }) => {
    const canvas = await openEditor(page)
    const onion = page.getByTestId('onion')

    await page.getByTestId('frame-add').click()
    await painted(page)
    await onion.click()
    await painted(page)
    await onion.click()
    await painted(page)

    const before = await recompositions(page)
    const drawn = await canvasFingerprint(canvas)

    for (let flip = 0; flip < 5; flip++) {
        await onion.click()
        await painted(page)
    }

    expect(await recompositions(page)).toBe(before)
    await onion.click()
    await painted(page)
    expect(await canvasFingerprint(canvas)).toBe(drawn)
})
