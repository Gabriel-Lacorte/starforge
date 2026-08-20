import { useEffect, useRef } from 'preact/hooks'

export interface Notice {
    fade(clear: () => void): void
    hold(): void
}

export function useNotice(delay: number): Notice {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const hold = () => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = null
    }

    useEffect(() => hold, [])

    return {
        hold,
        fade(clear) {
            hold()
            timer.current = setTimeout(() => {
                timer.current = null
                clear()
            }, delay)
        },
    }
}
