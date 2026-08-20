import type { Frame } from './doc'

export interface PlaybackState {
    readonly frame: string
    readonly elapsed: number
    readonly playing: boolean
}

export function startPlayback(frames: readonly Frame[], from?: string): PlaybackState {
    const frame = frames.some((candidate) => candidate.id === from) ? from! : frames[0]!.id
    return { frame, elapsed: 0, playing: true }
}

export function totalDuration(frames: readonly Frame[]): number {
    return frames.reduce((total, frame) => total + frame.duration, 0)
}

export function advancePlayback(
    frames: readonly Frame[],
    state: PlaybackState,
    delta: number,
    loop: boolean,
): PlaybackState {
    if (!state.playing || delta <= 0 || frames.length === 0) return state

    let index = frames.findIndex((frame) => frame.id === state.frame)
    if (index === -1) return startPlayback(frames)

    const total = totalDuration(frames)
    let elapsed = state.elapsed + (loop && delta >= total ? delta % total : delta)

    for (;;) {
        const duration = frames[index]!.duration
        if (elapsed < duration) break

        if (index === frames.length - 1 && !loop) {
            return { frame: frames[index]!.id, elapsed: duration, playing: false }
        }

        elapsed -= duration
        index = (index + 1) % frames.length
    }

    return { frame: frames[index]!.id, elapsed, playing: true }
}
