import type { RGBA } from '@starforge/core'
import type { SaveState } from '../storage/autosave'
import { Store } from './store'

export interface Hover {
    readonly x: number
    readonly y: number
    readonly color: RGBA
}

export type ExportState = 'working' | 'done' | 'failed'

export interface ReadoutState {
    readonly zoom: number
    readonly hover: Hover | null
    readonly save: SaveState | null
    readonly exportState: ExportState | null

    readonly canUndo: boolean
    readonly canRedo: boolean
}

export class ReadoutStore extends Store<ReadoutState> {
    constructor() {
        super({
            zoom: 1,
            hover: null,
            save: null,
            exportState: null,
            canUndo: false,
            canRedo: false,
        })
    }
}
