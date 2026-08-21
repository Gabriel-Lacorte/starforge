import type { Frame } from '@starforge/core'

export interface OnionSettings {
    readonly before: 0 | 1 | 2 | 3
    readonly after: 0 | 1 | 2 | 3
    readonly opacity: number
}

export interface Ghost {
    readonly id: string
    readonly alpha: number
}

export const ONION_SHOWN: OnionSettings = { before: 1, after: 1, opacity: 0.3 }
export const ONION_HIDDEN: OnionSettings = { before: 0, after: 0, opacity: ONION_SHOWN.opacity }

export function onionShowing(onion: OnionSettings): boolean {
    return onion.before > 0 || onion.after > 0
}

export function ghostFrames(
    frames: readonly Frame[],
    current: string,
    onion: OnionSettings,
): Ghost[] {
    const index = frames.findIndex((frame) => frame.id === current)
    if (index === -1) return []

    const ghosts: Ghost[] = []
    const add = (frame: Frame | undefined, alpha: number) => {
        if (frame) ghosts.push({ id: frame.id, alpha })
    }

    for (let distance = Math.max(onion.before, onion.after); distance >= 1; distance--) {
        const alpha = onion.opacity * 0.5 ** (distance - 1)

        if (distance <= onion.before) add(frames[index - distance], alpha)
        if (distance <= onion.after) add(frames[index + distance], alpha)
    }

    return ghosts
}
