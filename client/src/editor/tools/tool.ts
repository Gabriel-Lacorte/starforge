import type { CellWrite, InkContext, RGBA, Sprite } from '@starforge/core'
import type { ToolSettings } from './definition'

export interface Mods {
    shift: boolean
    alt: boolean
    ctrl: boolean
}

export interface ToolHost {
    readonly sprite: Sprite
    readonly layer: string
    readonly frame: string

    readonly settings: ToolSettings

    write(x: number, y: number, ink: InkContext): void
    absorb(writes: readonly CellWrite[]): void

    preview(cells: Iterable<number>, color: RGBA): void
    clearPreview(): void
}

export interface Tool {
    begin(x: number, y: number, mods: Mods): void
    move(x: number, y: number, mods: Mods): void
    end(x: number, y: number, mods: Mods): boolean
}
