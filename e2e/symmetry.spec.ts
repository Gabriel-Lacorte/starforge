import { expect, test, type Page } from '@playwright/test'
import { openEditor, painted } from './editor'

interface DevHandle {
    sprite: {
        width: number
        height: number
        layers: { id: string; cels: Map<string, { pixels: Uint8Array }> }[]
    }
    session: { target: { state: { layer: string; frame: string } } }
}

/* painted (non-transparent) cells in each half of the active cel */
async function halves(page: Page): Promise<{ left: number; right: number }> {
    return page.evaluate(() => {
        const dev = (window as unknown as { __starforge?: DevHandle }).__starforge
        if (!dev) throw new Error('the dev handle is missing: the editor must run in dev mode')

        const { sprite, session } = dev
        const { layer, frame } = session.target.state
        const cel = sprite.layers.find((l) => l.id === layer)?.cels.get(frame)
        if (!cel) return { left: 0, right: 0 }

        const { width: w, height: h } = sprite
        const mid = Math.floor(w / 2)

        let left = 0
        let right = 0
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if ((cel.pixels[(y * w + x) * 4 + 3] ?? 0) === 0) continue
                if (x < mid) left++
                else if (x >= Math.ceil(w / 2)) right++
            }
        }
        return { left, right }
    })
}

/* a short stroke kept entirely on the left of centre */
async function strokeLeftOfCentre(page: Page): Promise<void> {
    const box = (await page.getByTestId('canvas').boundingBox())!
    const y = box.y + box.height * 0.3
    await page.mouse.move(box.x + box.width * 0.3, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.45, y, { steps: 12 })
    await page.mouse.up()
    await painted(page)
}

/*
 * The starter drawing already covers both halves, so these compare what the
 * stroke ADDS to each side, never the absolute counts.
 */
test('one stroke paints both sides once the mirror is on', async ({ page }) => {
    await openEditor(page)
    await page.getByTestId('swatch').nth(5).click()

    const toggle = page.getByTestId('symmetry-h')
    await toggle.check()
    await expect(toggle).toBeChecked()

    const before = await halves(page)
    await strokeLeftOfCentre(page)
    const after = await halves(page)

    /* the stroke never crossed the axis, so the right half only gained its mirror */
    const drawn = after.left - before.left
    const mirrored = after.right - before.right

    expect(drawn).toBeGreaterThan(0)
    expect(mirrored).toBe(drawn)
})

test('the mirror stays off until the toggle is on', async ({ page }) => {
    await openEditor(page)
    await page.getByTestId('swatch').nth(5).click()

    await expect(page.getByTestId('symmetry-h')).not.toBeChecked()

    const before = await halves(page)
    await strokeLeftOfCentre(page)
    const after = await halves(page)

    expect(after.left - before.left).toBeGreaterThan(0)
    expect(after.right - before.right).toBe(0)
})
