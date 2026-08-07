import type { CellWrite, RGBA, Sprite } from '@starforge/core'
import type { EditorState } from '../store'

export interface Mods {
    shift: boolean
    alt: boolean
    ctrl: boolean
}

export interface ToolHost {
    readonly sprite: Sprite
    readonly layer: string
    readonly frame: string

    readonly state: EditorState

    write(x: number, y: number, color: RGBA): void
    absorb(writes: readonly CellWrite[]): void

    preview(cells: Iterable<number>, color: RGBA): void
    clearPreview(): void
}

export interface Tool {
    begin(x: number, y: number, mods: Mods): void
    move(x: number, y: number, mods: Mods): void
    end(x: number, y: number, mods: Mods): boolean
}
