import { describe, expect, it } from 'vitest'
import { createFrame, DEFAULT_FRAME_DURATION, type Frame } from '@starforge/core'
import { DEFAULT_FRAME_CACHE } from './compositor'
import { ghostFrames, onionShowing, ONION_HIDDEN, ONION_SHOWN, type OnionSettings } from './onion'

function reel(names: string): readonly Frame[] {
    return Array.from(names, (name) => createFrame(DEFAULT_FRAME_DURATION, name))
}

function onion(before: OnionSettings['before'], after: OnionSettings['after']): OnionSettings {
    return { ...ONION_SHOWN, before, after }
}

describe('ghostFrames', () => {
    it('ghosts one neighbour on each side at the settled opacity', () => {
        expect(ghostFrames(reel('abcde'), 'c', onion(1, 1))).toEqual([
            { id: 'b', alpha: 0.3 },
            { id: 'd', alpha: 0.3 },
        ])
    })

    it('halves the alpha per step away and paints the farthest ghost first', () => {
        expect(ghostFrames(reel('abcde'), 'c', onion(2, 1))).toEqual([
            { id: 'a', alpha: 0.15 },
            { id: 'b', alpha: 0.3 },
            { id: 'd', alpha: 0.3 },
        ])
    })

    it('orders both sides by distance, not by side', () => {
        expect(ghostFrames(reel('abcde'), 'c', onion(1, 2))).toEqual([
            { id: 'e', alpha: 0.15 },
            { id: 'b', alpha: 0.3 },
            { id: 'd', alpha: 0.3 },
        ])
    })

    it('keeps halving out to the third neighbour', () => {
        expect(ghostFrames(reel('abcdefg'), 'd', onion(3, 3)).map((ghost) => ghost.alpha)).toEqual([
            0.075, 0.075, 0.15, 0.15, 0.3, 0.3,
        ])
    })

    it('stops at the ends of the film instead of wrapping around', () => {
        expect(ghostFrames(reel('abc'), 'a', onion(1, 1))).toEqual([{ id: 'b', alpha: 0.3 }])
        expect(ghostFrames(reel('abc'), 'c', onion(1, 1))).toEqual([{ id: 'b', alpha: 0.3 }])
    })

    it('clamps at both ends at once when the film is shorter than the reach', () => {
        expect(ghostFrames(reel('abc'), 'b', onion(3, 3))).toEqual([
            { id: 'a', alpha: 0.3 },
            { id: 'c', alpha: 0.3 },
        ])
    })

    it('has nothing to ghost in a document of one frame', () => {
        expect(ghostFrames(reel('a'), 'a', onion(1, 1))).toEqual([])
    })

    it('ghosts nothing when both counts are zero', () => {
        expect(ghostFrames(reel('abcde'), 'c', ONION_HIDDEN)).toEqual([])
    })

    it('ghosts nothing for a frame that is not on the film', () => {
        expect(ghostFrames(reel('abcde'), 'z', ONION_SHOWN)).toEqual([])
    })

    it('asks for no more composites at full reach than the frame cache holds', () => {
        const ghosts = ghostFrames(reel('abcdefghijk'), 'f', onion(3, 3))

        expect(ghosts).toHaveLength(6)
        expect(1 + ghosts.length).toBeLessThanOrEqual(DEFAULT_FRAME_CACHE)
    })
})

describe('onionShowing', () => {
    it('is on with a neighbour on either side and off with none', () => {
        expect(onionShowing(ONION_SHOWN)).toBe(true)
        expect(onionShowing(ONION_HIDDEN)).toBe(false)
        expect(onionShowing(onion(0, 1))).toBe(true)
        expect(onionShowing(onion(1, 0))).toBe(true)
    })
})
