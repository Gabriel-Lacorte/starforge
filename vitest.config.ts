import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        include: ['core/src/**/*.test.ts', 'client/src/**/*.test.ts'],
    },
})
