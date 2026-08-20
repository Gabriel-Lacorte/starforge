import { describe, expect, it } from 'vitest'
import { createFrame, type Frame } from './doc'
import { advancePlayback, startPlayback, totalDuration } from './playback'

const REEL: Frame[] = [createFrame(100, 'a'), createFrame(30, 'b'), createFrame(70, 'c')]

function run(deltas: readonly number[], loop = true): string[] {
    let state = startPlayback(REEL)
    const seen = [state.frame]
    for (const delta of deltas) {
        state = advancePlayback(REEL, state, delta, loop)
        seen.push(state.frame)
    }

    return seen
}

describe('playback clock', () => {
    it('shows each frame for the time that frame asked for', () => {
        expect(run([99, 1, 29, 1, 69, 1])).toEqual(['a', 'a', 'b', 'b', 'c', 'c', 'a'])
    })

    it('carries the leftover instead of dropping it', () => {
        let state = advancePlayback(REEL, startPlayback(REEL), 120, true)
        expect(state).toMatchObject({ frame: 'b', elapsed: 20 })

        state = advancePlayback(REEL, state, 10, true)
        expect(state.frame).toBe('c')
    })

    it('does not drift over a thousand uneven ticks', () => {
        const total = totalDuration(REEL)
        let state = startPlayback(REEL)
        let clock = 0

        for (let step = 0; step < 1000; step++) {
            state = advancePlayback(REEL, state, 7, true)
            clock += 7
        }

        let remaining = clock % total
        let expected = REEL[0]!
        for (const frame of REEL) {
            if (remaining < frame.duration) {
                expected = frame
                break
            }
            remaining -= frame.duration
        }

        expect(state.frame).toBe(expected.id)
        expect(state.elapsed).toBe(remaining)
    })

    it('folds away whole passes when a backgrounded tab hands back minutes', () => {
        const state = advancePlayback(REEL, startPlayback(REEL), 60_000 + 120, true)

        expect(state.frame).toBe('b')
        expect(state.playing).toBe(true)
    })

    it('stops on the last frame when it is not asked to loop', () => {
        const state = advancePlayback(REEL, startPlayback(REEL), 10_000, false)

        expect(state).toMatchObject({ frame: 'c', elapsed: 70, playing: false })
    })

    it('stays put once stopped, however much time passes', () => {
        const stopped = advancePlayback(REEL, startPlayback(REEL), 10_000, false)

        expect(advancePlayback(REEL, stopped, 5_000, false)).toBe(stopped)
        expect(advancePlayback(REEL, stopped, 5_000, true)).toBe(stopped)
    })

    it('ignores a tick that carries no time', () => {
        const state = startPlayback(REEL)

        expect(advancePlayback(REEL, state, 0, true)).toBe(state)
        expect(advancePlayback(REEL, state, -20, true)).toBe(state)
    })

    it('starts from a frame that exists, and from the first when it does not', () => {
        expect(startPlayback(REEL, 'c').frame).toBe('c')
        expect(startPlayback(REEL, 'gone').frame).toBe('a')
        expect(startPlayback(REEL).frame).toBe('a')
    })

    it('recovers when the frame it was showing has been removed', () => {
        const orphan = { frame: 'gone', elapsed: 10, playing: true }

        expect(advancePlayback(REEL, orphan, 5, true)).toMatchObject({ frame: 'a', elapsed: 0 })
    })

    it('survives a single frame shorter than one tick', () => {
        const blink = [createFrame(1, 'only')]
        const state = advancePlayback(blink, startPlayback(blink), 5_000, true)

        expect(state.frame).toBe('only')
        expect(state.elapsed).toBeLessThan(1)
    })
})
