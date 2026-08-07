import { useEffect, useState } from 'preact/hooks'

export interface Subscribable<T> {
    readonly state: T
    subscribe(listener: () => void): () => void
}

export function useStore<T>(store: Subscribable<T>): T {
    const [state, setState] = useState(store.state)
    useEffect(() => {
        setState(store.state)
        return store.subscribe(() => {
            setState(store.state)
        })
    }, [store])
    return state
}
