import { defineConfig, devices } from '@playwright/test'

const PORT = 5199
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
    testDir: 'e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? 'github' : 'list',

    use: {
        baseURL: BASE_URL,
        trace: 'retain-on-failure',
    },

    projects: [
        {
            name: 'chromium',
            testMatch: /\.spec\.ts$/,
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'bench',
            testMatch: /\.pw\.ts$/,
            use: { ...devices['Desktop Chrome'] },
        },
    ],

    /* the editor needs the dev build: the bench handle only exists there */
    webServer: {
        command: `npm run dev -w client -- --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        stdout: 'ignore',
    },
})
