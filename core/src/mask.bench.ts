import { bench, describe } from 'vitest'
import { polygonMask, rectMask } from './mask'

/* a lasso is rebuilt on every pointer sample, so this is a per-frame cost */
describe.each([
    [64, 128],
    [256, 512],
    [1024, 1024],
])('lasso on a %d-row document with %d points', (size, count) => {
    const radius = size * 0.4
    const centre = size / 2
    const points = Array.from({ length: count }, (_, index) => {
        const angle = (index / count) * Math.PI * 2
        return {
            x: Math.round(centre + radius * Math.cos(angle)),
            y: Math.round(centre + radius * Math.sin(angle)),
        }
    })

    bench(
        'polygonMask',
        () => {
            polygonMask(size, size, points)
        },
        { time: 400, warmupTime: 100 },
    )
})

describe('rectangle marquee', () => {
    bench(
        'rectMask 1024',
        () => {
            rectMask(1024, 1024, 0, 0, 1023, 1023)
        },
        { time: 300, warmupTime: 100 },
    )
})
