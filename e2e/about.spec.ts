import { expect, test } from '@playwright/test'

test('about page names the project and links out', async ({ page, request }) => {
    await page.goto('/about')
    await expect(page.getByTestId('about')).toBeVisible()
    await expect(page.locator('header')).toContainText('Starforge')
    const github = page.locator('a[href="https://github.com/Gabriel-Lacorte/starforge"]')
    await expect(github).toContainText('GitHub')
    const home = await request.get('/about')
    expect(home.ok()).toBe(true)
    const discord = page.getByRole('link', { name: /discord/i })
    await expect(discord).toHaveAttribute('href', 'https://discord.gg/vMshxxF4ke')
    const nav = page.locator('header a').first()
    await expect(nav).toHaveCSS('color', 'rgb(255, 204, 51)')
    await expect(nav).toHaveCSS('text-decoration-line', 'underline')
    const stats = page.getByTestId('about-stats')
    await expect(stats).toBeVisible()
    await expect(stats).toContainText('rooms ever')
})
