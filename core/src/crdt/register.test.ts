import { describe, expect, it } from 'vitest'
import { LwwRegisters } from './register'
import { packStamp } from './stamp'

describe('LwwRegisters', () => {
    it('tracks stamps independently for document and layer keys', () => {
        const registers = new LwwRegisters()
        const opacity = packStamp(2, 1)
        const duration = packStamp(3, 1)

        expect(registers.stamp('layer:ink:opacity')).toBe(0)
        expect(registers.stamp('frame:f1:duration')).toBe(0)
        expect(registers.accept('layer:ink:opacity', opacity)).toBe(true)
        expect(registers.accept('frame:f1:duration', duration)).toBe(true)
        expect(registers.stamp('layer:ink:opacity')).toBe(opacity)
        expect(registers.stamp('frame:f1:duration')).toBe(duration)
    })

    it('rejects stale and duplicate updates without changing a key', () => {
        const registers = new LwwRegisters()
        const current = packStamp(4, 1)

        expect(registers.accept('document:title', current)).toBe(true)
        expect(registers.accept('document:title', current)).toBe(false)
        expect(registers.accept('document:title', packStamp(3, 255))).toBe(false)
        expect(registers.stamp('document:title')).toBe(current)
    })

    it('accepts a newer stamp for a different document key', () => {
        const registers = new LwwRegisters()
        const palette = packStamp(5, 2)

        expect(registers.accept('document:palette', palette)).toBe(true)
        expect(registers.stamp('document:palette')).toBe(palette)
        expect(registers.stamp('document:title')).toBe(0)
    })
})
