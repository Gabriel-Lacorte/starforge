import { useEffect, useRef } from 'preact/hooks'

export function useFocusReturn(open: unknown): () => void {
    const source = useRef<HTMLElement | null>(null)

    useEffect(() => {
        if (open) return

        const previous = source.current
        source.current = null
        previous?.focus()
    }, [open])

    return () => {
        source.current = document.activeElement as HTMLElement | null
    }
}
