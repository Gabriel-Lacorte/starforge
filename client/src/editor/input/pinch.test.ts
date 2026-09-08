import { describe, expect, it } from 'vitest'
import { pinchStepForRatio } from './pinch'

describe('pinchStepForRatio', () => {
    it('ignores a steady hold', () => {
        expect(pinchStepForRatio(1)).toBe(0)
    })

    it('zooms in on a small spread', () => {
        expect(pinchStepForRatio(1.2)).toBe(1)
    })

    it('zooms out on a small squeeze', () => {
        expect(pinchStepForRatio(0.8)).toBe(-1)
    })

    it('ignores jitter around the resting distance', () => {
        expect(pinchStepForRatio(1.05)).toBe(0)
        expect(pinchStepForRatio(0.95)).toBe(0)
    })
})
