import { hexToRgba, type RGBA } from '@starforge/core'

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

export type ToolId = 'pencil' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'bucket' | 'select'

export interface EditorState {
    readonly tool: ToolId
    readonly color: RGBA

    /** 1..64 */
    readonly brushSize: number
    /** rect/ellipse draw filled */
    readonly shapeFill: boolean

    readonly fillTolerance: number
    readonly fillContiguous: boolean
}

export class EditorStore extends Store<EditorState> {
    constructor() {
        super({
            tool: 'pencil',
            color: hexToRgba('#ffffff'),
            brushSize: 1,
            shapeFill: false,
            fillTolerance: 0,
            fillContiguous: true,
        })
    }
}
