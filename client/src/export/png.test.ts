import { describe, expect, it } from 'vitest'
import { portablePngFilename, slug, visualPngFilename } from './png'

describe('export file names', () => {
    it('slugs a title down to something a file system accepts', () => {
        expect(slug('Moon Café')).toBe('moon-cafe')
        expect(slug('  ../../etc/passwd  ')).toBe('etc-passwd')
        expect(slug('★ ☆ ★')).toBe('starforge')
        expect(slug('x'.repeat(200))).toHaveLength(80)
    })

    it('separates the flat image from the one carrying the project', () => {
        expect(visualPngFilename('Moon Café')).toBe('moon-cafe.png')
        expect(portablePngFilename('Moon Café')).toBe('moon-cafe.starforge.png')
    })

    it('keeps both names openable as images', () => {
        for (const name of [visualPngFilename('a'), portablePngFilename('a')]) {
            expect(name.endsWith('.png')).toBe(true)
        }
    })
})
