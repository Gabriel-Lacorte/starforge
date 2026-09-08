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

    webServer: [
        {
            command: `npm run dev -w client -- --port ${PORT} --strictPort`,
            url: BASE_URL,
            reuseExistingServer: !process.env.CI,
            stdout: 'ignore',
        },
        {
            command: 'npm run relay',
            port: 8131,
            reuseExistingServer: !process.env.CI,
            stdout: 'ignore',
            env: { PORT: '8131' },
        },
    ],
})
