export interface EditTarget {
    readonly layer: string
    readonly frame: string
}

export class Store<T extends object> {
    #state: T
    readonly #listeners = new Set<() => void>()

    constructor(initial: T) {
        this.#state = initial
    }

    get state(): T {
        return this.#state
    }

    patch(partial: Partial<T>): void {
        this.#state = { ...this.#state, ...partial }
        for (const listener of this.#listeners) listener()
    }

    subscribe(listener: () => void): () => void {
        this.#listeners.add(listener)
        return () => this.#listeners.delete(listener)
    }
}
