import { expect, test } from '@playwright/test'

test('export the greeting star as a 4x GIF', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('canvas').waitFor()
    await expect(page.getByTestId('zoom')).not.toBeEmpty()

    await page.waitForTimeout(700)

    await page.getByTestId('export').click()
    await page.getByTestId('export-dialog').waitFor()

    await page.getByTestId('export-format').nth(1).click()
    await page.getByTestId('export-scale').nth(2).check({ force: true })

    const download = page.waitForEvent('download')
    await page.getByTestId('export-confirm').click()

    const file = await download
    expect(file.suggestedFilename()).toMatch(/\.gif$/)

    const stream = await file.createReadStream()
    const bytes = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []
        stream.on('data', (chunk: Buffer) => chunks.push(chunk))
        stream.on('end', () => resolve(Buffer.concat(chunks)))
        stream.on('error', reject)
    })

    expect(bytes.subarray(0, 6).toString('ascii')).toBe('GIF89a')
    expect(bytes.readUInt16LE(6)).toBe(256)
    expect(bytes.readUInt16LE(8)).toBe(256)
    expect(bytes[bytes.length - 1]).toBe(0x3b)

    await file.saveAs('docs/media/devlog8-star.gif')
})
