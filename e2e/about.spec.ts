import { expect, test } from '@playwright/test'

test('about page names the project and links out', async ({ page, request }) => {
    await page.goto('/about')
    await expect(page.getByTestId('about')).toBeVisible()
    await expect(page.getByTestId('about')).toContainText('Starforge')
    const github = page.getByRole('link', { name: /GitHub: Gabriel-Lacorte/ })
    await expect(github).toHaveAttribute('href', 'https://github.com/Gabriel-Lacorte/starforge')
    const home = await request.get('/about')
    expect(home.ok()).toBe(true)
    const discord = page.getByRole('link', { name: /discord/i })
    await expect(discord).toHaveAttribute('href', 'https://discord.gg/vMshxxF4ke')
    const nav = page.locator('header a').first()
    await expect(nav).toHaveCSS('color', 'rgb(255, 204, 51)')
    await expect(nav).toHaveCSS('text-decoration-line', 'underline')
})
