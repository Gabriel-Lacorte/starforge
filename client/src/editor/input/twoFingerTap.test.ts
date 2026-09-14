import { describe, expect, it } from 'vitest'
import { TwoFingerTap } from './twoFingerTap'

function touches(
    entries: [number, { x: number; y: number }][],
): Map<number, { x: number; y: number }> {
    return new Map(entries)
}

describe('two-finger tap', () => {
    it('fires when the second finger lifts quickly without drifting', () => {
        let now = 1000
        const tap = new TwoFingerTap(() => now)
        tap.press(1, touches([[1, { x: 10, y: 10 }]]))
        tap.press(
            2,
            touches([
                [1, { x: 10, y: 10 }],
                [2, { x: 40, y: 40 }],
            ]),
        )
        now = 1200
        expect(tap.release(2)).toBe(true)
    })

    it('ignores a slow lift', () => {
        let now = 1000
        const tap = new TwoFingerTap(() => now)
        tap.press(
            2,
            touches([
                [1, { x: 10, y: 10 }],
                [2, { x: 40, y: 40 }],
            ]),
        )
        now = 1400
        expect(tap.release(2)).toBe(false)
    })

    it('dies when either finger drifts', () => {
        const tap = new TwoFingerTap(() => 1000)
        tap.press(
            2,
            touches([
                [1, { x: 10, y: 10 }],
                [2, { x: 40, y: 40 }],
            ]),
        )
        expect(
            tap.drifted(
                touches([
                    [1, { x: 10, y: 10 }],
                    [2, { x: 60, y: 40 }],
                ]),
            ),
        ).toBe(true)
        expect(
            tap.drifted(
                touches([
                    [1, { x: 10, y: 10 }],
                    [2, { x: 42, y: 41 }],
                ]),
            ),
        ).toBe(false)
    })

    it('dies on a third finger and on a foreign release', () => {
        const tap = new TwoFingerTap(() => 1000)
        tap.press(
            2,
            touches([
                [1, { x: 10, y: 10 }],
                [2, { x: 40, y: 40 }],
            ]),
        )
        tap.press(
            3,
            touches([
                [1, { x: 10, y: 10 }],
                [2, { x: 40, y: 40 }],
                [3, { x: 70, y: 70 }],
            ]),
        )
        expect(tap.release(2)).toBe(false)
        expect(tap.release(9)).toBe(false)
    })

    it('survives the primary lifting first', () => {
        let now = 1000
        const tap = new TwoFingerTap(() => now)
        tap.press(
            2,
            touches([
                [1, { x: 10, y: 10 }],
                [2, { x: 40, y: 40 }],
            ]),
        )
        now = 1100
        expect(tap.release(1)).toBe(false)
        expect(tap.release(2)).toBe(true)
    })

    it('completes only once per tap', () => {
        let now = 1000
        const tap = new TwoFingerTap(() => now)
        tap.press(
            2,
            touches([
                [1, { x: 10, y: 10 }],
                [2, { x: 40, y: 40 }],
            ]),
        )
        now = 1100
        expect(tap.release(2)).toBe(true)
        expect(tap.release(2)).toBe(false)
    })
})
