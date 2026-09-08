import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        include: [
            'core/src/**/*.test.ts',
            'client/src/**/*.test.ts',
            'tools/**/*.test.ts',
            'relay/src/**/*.test.ts',
        ],
        benchmark: {
            include: ['core/src/**/*.bench.ts', 'client/src/**/*.bench.ts'],
        },
    },
})
