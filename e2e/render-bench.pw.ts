import { test } from '@playwright/test'
import type { ComposeBenchResult } from '../client/src/render/composeBench'

declare global {
    interface Window {
        __starforge: {
            benchCompose(size?: number, layers?: number): Promise<ComposeBenchResult>
        }
    }
}

const CASES: readonly (readonly [number, number])[] = [
    [64, 4],
    [256, 8],
    [512, 12],
]

test('compositor: full recomposite vs dirty rect', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('canvas').waitFor()

    const rows: ComposeBenchResult[] = []
    for (const [size, layers] of CASES) {
        rows.push(
            await page.evaluate(([px, count]) => window.__starforge.benchCompose(px, count), [
                size,
                layers,
            ] as const),
        )
    }

    console.table(
        rows.map((row) => ({
            document: `${row.size}x${row.size}`,
            layers: row.layers,
            'full (ms)': row.fullMs.toFixed(3),
            'dirty (ms)': row.dirtyMs.toFixed(3),
            speedup: `${(row.fullMs / row.dirtyMs).toFixed(1)}x`,
        })),
    )
})
