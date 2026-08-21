import { hexToRgba, type RGBA } from '@starforge/core'
import { Store } from '../store'
import { ONION_HIDDEN, ONION_SHOWN, onionShowing, type OnionSettings } from '../render/onion'

export type ToolId =
    | 'pencil'
    | 'eraser'
    | 'line'
    | 'rect'
    | 'ellipse'
    | 'bucket'
    | 'select'
    | 'selectEllipse'
    | 'lasso'
    | 'wand'
    | 'eyedropper'

export const RECENT_COLORS_MAX = 12

export const DEFAULT_FOREGROUND: RGBA = hexToRgba('#ffffff')
export const DEFAULT_BACKGROUND: RGBA = hexToRgba('#0b0b12')

export interface EditTarget {
    readonly layer: string
    readonly frame: string
}

export interface EditorState {
    readonly tool: ToolId

    readonly color: RGBA
    readonly background: RGBA
    readonly recentColors: readonly RGBA[]
    readonly inkOpacity: number

    readonly brushSize: number
    readonly pixelPerfect: boolean
    readonly lockAlpha: boolean
    readonly shapeFill: boolean

    readonly fillTolerance: number
    readonly fillContiguous: boolean

    readonly onion: OnionSettings
}

export class EditorStore extends Store<EditorState> {
    constructor() {
        super({
            tool: 'pencil',
            color: DEFAULT_FOREGROUND,
            background: DEFAULT_BACKGROUND,
            recentColors: [],
            inkOpacity: 255,
            brushSize: 1,
            pixelPerfect: true,
            lockAlpha: false,
            shapeFill: false,
            fillTolerance: 0,
            fillContiguous: true,
            onion: ONION_SHOWN,
        })
    }

    get onionShown(): boolean {
        return onionShowing(this.state.onion)
    }

    setOnion(shown: boolean): void {
        if (shown === this.onionShown) return

        this.patch({ onion: shown ? ONION_SHOWN : ONION_HIDDEN })
    }

    setColor(color: RGBA): void {
        if (color !== this.state.color) this.patch({ color })
    }

    pickColor(color: RGBA): void {
        const current = this.state.color
        if (color === current) return

        this.patch({ color, recentColors: remember(this.state.recentColors, current) })
    }

    rememberColor(color: RGBA): void {
        if (color === this.state.color) return

        this.patch({ recentColors: remember(this.state.recentColors, color) })
    }

    swapColors(): void {
        this.patch({ color: this.state.background, background: this.state.color })
    }

    resetColors(): void {
        this.patch({ color: DEFAULT_FOREGROUND, background: DEFAULT_BACKGROUND })
    }
}

function remember(recent: readonly RGBA[], color: RGBA): readonly RGBA[] {
    return [color, ...recent.filter((entry) => entry !== color)].slice(0, RECENT_COLORS_MAX)
}
