import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// Dev-only parity with prod
const relayTarget = process.env.RELAY_URL ?? 'http://localhost:8131'

// https://vite.dev/config/
export default defineConfig({
    plugins: [preact()],
    server: {
        proxy: {
            '/api': { target: relayTarget, changeOrigin: true },
            '/wire': { target: relayTarget, changeOrigin: true, ws: true },
        },
    },
})
