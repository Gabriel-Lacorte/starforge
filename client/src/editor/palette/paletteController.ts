import {
    normalizePaletteName,
    rgbaToHex,
    type Palette,
    type RGBA,
    type Sprite,
} from '@starforge/core'
import type { DocumentSession } from '../../document/session'

export class PaletteController {
    readonly #sprite: Sprite
    readonly #session: DocumentSession

    constructor(sprite: Sprite, session: DocumentSession) {
        this.#sprite = sprite
        this.#session = session
    }

    get palette(): Palette {
        return this.#sprite.palette
    }

    add(color: RGBA): void {
        const hex = rgbaToHex(color)
        if (this.#colors.includes(hex)) return

        this.#session.apply('add palette colour', {
            kind: 'palette.add',
            color: hex,
            index: this.#colors.length,
        })
    }

    remove(index: number): void {
        if (!this.#has(index) || this.#colors.length <= 1) return

        this.#session.apply('remove palette colour', { kind: 'palette.remove', index })
    }

    move(from: number, to: number): void {
        if (!this.#has(from) || !this.#has(to) || from === to) return

        this.#session.apply('move palette colour', { kind: 'palette.move', from, to })
    }

    setColor(index: number, color: RGBA): void {
        const hex = rgbaToHex(color)
        if (!this.#has(index) || this.#colors[index] === hex) return

        this.#session.apply('replace palette colour', { kind: 'palette.set', index, color: hex })
    }

    rename(name: string): void {
        const next = normalizePaletteName(name)
        if (!next || next === this.palette.name) return

        this.#session.apply('rename palette', { kind: 'palette.rename', name: next })
    }

    replace(palette: Palette): void {
        this.#session.apply('replace palette', {
            kind: 'palette.replace',
            name: palette.name,
            colors: palette.colors,
        })
    }

    get #colors(): readonly string[] {
        return this.#sprite.palette.colors
    }

    #has(index: number): boolean {
        return Number.isInteger(index) && index >= 0 && index < this.#colors.length
    }
}
