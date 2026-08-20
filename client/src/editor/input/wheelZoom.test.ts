import { describe, expect, it } from 'vitest'
import { NOTCH, WheelZoom } from './wheelZoom'

const steps = (wheel: WheelZoom, deltaY: number, times: number, deltaMode = 0): number[] => {
    const out: number[] = []
    for (let i = 0; i < times; i++) out.push(wheel.step(deltaY, deltaMode))
    return out
}

describe('WheelZoom', () => {
    it('gives a mouse notch exactly one step, in the direction the wheel turned', () => {
        const wheel = new WheelZoom()
        expect(wheel.step(-NOTCH)).toBe(1)
        expect(wheel.step(NOTCH)).toBe(-1)
    })

    it('gives a trackpad one step per notch of glide, not one per event', () => {
        const wheel = new WheelZoom()
        const emitted = steps(wheel, -4, 25)

        expect(emitted.filter((s) => s !== 0)).toHaveLength(1)
        expect(emitted.at(-1)).toBe(1)
    })

    it('keeps gliding at one step per notch instead of stalling after the first', () => {
        const wheel = new WheelZoom()
        expect(steps(wheel, -4, 75).filter((s) => s === 1)).toHaveLength(3)
    })

    it('starts a fresh notch when the glide turns around', () => {
        const wheel = new WheelZoom()
        steps(wheel, -4, 24)

        expect(steps(wheel, 4, 24)).toEqual(Array<number>(24).fill(0))
        expect(wheel.step(4)).toBe(-1)
    })

    it('drops the overshoot of a fling so one gesture cannot bank steps', () => {
        const wheel = new WheelZoom()
        expect(wheel.step(-NOTCH * 5)).toBe(1)
        expect(wheel.step(-1)).toBe(0)
    })

    it('reads line and page deltas as the notches they stand for', () => {
        expect(new WheelZoom().step(-3, 1)).toBe(1)
        expect(new WheelZoom().step(1, 2)).toBe(-1)
    })

    it('ignores an event that carries no vertical intent', () => {
        expect(new WheelZoom().step(0)).toBe(0)
    })
})
