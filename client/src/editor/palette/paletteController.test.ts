import { describe, expect, it } from 'vitest'
import { createSprite, parsePalette, rgba, rgbaToHex, type Sprite } from '@starforge/core'
import { DocumentSession } from '../../document/session'
import { EditorStore } from '../store'
import { PaletteController } from './paletteController'

const RED = rgba(255, 0, 0)

function setup(): {
    sprite: Sprite
    session: DocumentSession
    palette: PaletteController
    colors: () => readonly string[]
} {
    const sprite = createSprite({ width: 16, height: 16 })
    const session = new DocumentSession(sprite)

    return {
        sprite,
        session,
        palette: new PaletteController(sprite, session),
        colors: () => sprite.palette.colors,
    }
}

describe('PaletteController', () => {
    it('adds the current colour once and undoes as one step', () => {
        const { session, palette, colors } = setup()
        const size = colors().length

        palette.add(RED)
        palette.add(RED)
        expect(colors()).toHaveLength(size + 1)
        expect(colors().at(-1)).toBe(rgbaToHex(RED))

        session.undo()
        expect(colors()).toHaveLength(size)
        expect(session.canUndo).toBe(false)
    })

    it('reorders a swatch and undo puts the order back', () => {
        const { session, palette, colors } = setup()
        const before = [...colors()]

        palette.move(0, 3)
        expect(colors()[3]).toBe(before[0])

        session.undo()
        expect([...colors()]).toEqual(before)
    })

    it('replaces one swatch without disturbing the rest', () => {
        const { palette, colors } = setup()
        const before = [...colors()]

        palette.setColor(2, RED)
        expect(colors()[2]).toBe(rgbaToHex(RED))
        expect(colors().filter((_, at) => at !== 2)).toEqual(before.filter((_, at) => at !== 2))
    })

    it('leaves the colour being painted with alone when its swatch is removed', () => {
        const { sprite, palette, colors } = setup()
        const store = new EditorStore()
        store.pickColor(RED)
        palette.add(RED)
        palette.remove(colors().indexOf(rgbaToHex(RED)))

        expect(sprite.palette.colors).not.toContain(rgbaToHex(RED))
        expect(store.state.color).toBe(RED)
    })

    it('keeps the last colour, so the palette can never empty itself', () => {
        const { palette, colors } = setup()
        while (colors().length > 1) palette.remove(0)

        palette.remove(0)
        expect(colors()).toHaveLength(1)
    })

    it('renames only when the normalized name is new', () => {
        const { sprite, session, palette } = setup()
        const original = sprite.palette.name

        palette.rename('   ')
        palette.rename(original)
        expect(session.canUndo).toBe(false)

        palette.rename('  Deep   Cave  ')
        expect(sprite.palette.name).toBe('Deep Cave')
        session.undo()
        expect(sprite.palette.name).toBe(original)
    })

    it('swaps an imported palette in one undoable step', () => {
        const { sprite, session, palette } = setup()
        const before = [...sprite.palette.colors]

        palette.replace(parsePalette('#ff0000\n#00ff00\n', 'imported'))
        expect(sprite.palette).toEqual({ name: 'imported', colors: ['#ff0000', '#00ff00'] })

        session.undo()
        expect(sprite.palette.colors).toEqual(before)
    })

    it('treats a swatch that vanished under the click as a no-op', () => {
        const { session, palette, colors } = setup()
        const before = [...colors()]

        expect(() => {
            palette.remove(99)
            palette.move(0, 99)
            palette.move(1, 1)
            palette.setColor(-1, RED)
            palette.setColor(0, hexAt(colors(), 0))
        }).not.toThrow()

        expect([...colors()]).toEqual(before)
        expect(session.canUndo).toBe(false)
    })
})

function hexAt(colors: readonly string[], index: number): number {
    return Number.parseInt(colors[index]!.slice(1).padEnd(8, 'f'), 16) >>> 0
}
