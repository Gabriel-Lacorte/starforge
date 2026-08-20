import { describe, expect, it } from 'vitest'
import { PALETTE_MAX_COLORS } from './doc'
import {
    PALETTE_IMPORT_LIMITS,
    PaletteImportError,
    normalizePaletteName,
    parsePalette,
} from './palette'

const GPL = `GIMP Palette
Name: Cave
Columns: 4
#
  0   0   0	Black
255 204  51	Gold
 11  11  18	Ink
`

function code(run: () => unknown): string {
    try {
        run()
    } catch (error) {
        if (error instanceof PaletteImportError) return error.code
        throw error
    }

    throw new Error('expected the import to be rejected')
}

describe('parsePalette', () => {
    it('reads a GIMP palette, its name and its colours', () => {
        expect(parsePalette(GPL, 'fallback')).toEqual({
            name: 'Cave',
            colors: ['#000000', '#ffcc33', '#0b0b12'],
        })
    })

    it('falls back to the file name when the palette does not carry one', () => {
        expect(parsePalette('GIMP Palette\n255 0 0\n', 'sunset').name).toBe('sunset')
    })

    it('reads a plain list of hex colours in the shapes people write them', () => {
        const palette = parsePalette('#ff0000\n00ff00\n#00f\n#11223344\n', 'list')

        expect(palette.colors).toEqual(['#ff0000', '#00ff00', '#0000ff', '#11223344'])
    })

    it('drops a fully opaque alpha so a colour has one canonical spelling', () => {
        expect(parsePalette('#112233ff\n', 'list').colors).toEqual(['#112233'])
    })

    it('normalizes a name that would otherwise bloat the document', () => {
        expect(normalizePaletteName('  spaced   out  ')).toBe('spaced out')
        expect(normalizePaletteName('y'.repeat(500))).toHaveLength(64)
        expect(parsePalette('GIMP Palette\nName:   Deep   Cave  \n0 0 0\n', 'x').name).toBe(
            'Deep Cave',
        )
    })

    it('refuses a file that carries no colour', () => {
        expect(code(() => parsePalette('', 'x'))).toBe('EMPTY')
        expect(code(() => parsePalette('GIMP Palette\n#\n', 'x'))).toBe('EMPTY')
    })

    it('refuses junk instead of guessing at it', () => {
        expect(code(() => parsePalette('not a colour\n', 'x'))).toBe('FORMAT')
        expect(code(() => parsePalette('GIMP Palette\n300 0 0\n', 'x'))).toBe('FORMAT')
        expect(code(() => parsePalette('#12345\n', 'x'))).toBe('FORMAT')
    })

    it('refuses a file bigger than the limits before doing any work', () => {
        expect(code(() => parsePalette('#ff0000\n'.repeat(200_000), 'x'))).toBe('LIMIT')
        expect(code(() => parsePalette('\n'.repeat(PALETTE_IMPORT_LIMITS.maxLines + 1), 'x'))).toBe(
            'LIMIT',
        )
        expect(code(() => parsePalette('#ff0000\n'.repeat(PALETTE_MAX_COLORS + 1), 'x'))).toBe(
            'LIMIT',
        )
    })
})
