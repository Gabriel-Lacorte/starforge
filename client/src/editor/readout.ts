import type { RGBA } from '@starforge/core'
import { Store } from './store'

export interface Hover {
    readonly x: number
    readonly y: number
    readonly color: RGBA
}

export interface ReadoutState {
    readonly zoom: number
    readonly hover: Hover | null
}

export class ReadoutStore extends Store<ReadoutState> {
    constructor() {
        super({ zoom: 1, hover: null })
    }
}
