import { describe, expect, it } from 'vitest'
import { rgba } from './color'
import { createSprite } from './doc'
import { writePixel } from './ops'
import { Command } from './undo'

const RED = rgba(255, 0, 0)
const GREEN = rgba(0, 255, 0)
const BLUE = rgba(0, 0, 255)

describe('Command', () => {
    it('collapses writes to the same cell into first-before + last-after', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        const layer = sprite.layers[0]!.id
        const frame = sprite.frames[0]!.id
        const command = new Command('stroke')

        for (const color of [RED, GREEN, BLUE]) {
            const write = writePixel(sprite, layer, frame, 8, 8, color)
            if (write) command.record(write)
        }

        const writes = command.writes()
        expect(writes).toHaveLength(1)
        expect(writes[0]).toMatchObject({ x: 8, y: 8, before: 0, after: BLUE })
    })

    it('keeps distinct cells apart', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        const layer = sprite.layers[0]!.id
        const frame = sprite.frames[0]!.id
        const command = new Command('stroke')

        command.record(writePixel(sprite, layer, frame, 0, 0, RED)!)
        command.record(writePixel(sprite, layer, frame, 1, 0, GREEN)!)
        expect(command.writes()).toHaveLength(2)
    })

    it('drops cells whose net effect is nothing', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        const layer = sprite.layers[0]!.id
        const frame = sprite.frames[0]!.id
        const command = new Command('paint and erase')

        command.record(writePixel(sprite, layer, frame, 2, 2, RED)!)
        command.record(writePixel(sprite, layer, frame, 2, 2, 0)!)
        expect(command.writes()).toHaveLength(0)
    })

    it('does not retain or mutate caller records', () => {
        const command = new Command('stroke')
        const record = { layer: 'l', frame: 'f', x: 0, y: 0, before: 0, after: RED }
        command.record(record)
        command.record({ ...record, before: RED, after: GREEN })
        expect(record.after).toBe(RED)
        expect(command.writes()[0]).toMatchObject({ before: 0, after: GREEN })
    })

    it('returns fresh records mutating the result', () => {
        const command = new Command('stroke')
        command.record({ layer: 'l', frame: 'f', x: 3, y: 4, before: 0, after: RED })
        const leaked = command.writes()[0]!
        leaked.after = GREEN
        leaked.x = 99
        expect(command.writes()[0]).toMatchObject({ x: 3, y: 4, before: 0, after: RED })
    })

    it('rejects writes that span more than one (layer, frame)', () => {
        const command = new Command('stroke')
        command.record({ layer: 'a', frame: 'f', x: 0, y: 0, before: 0, after: RED })
        expect(() => {
            command.record({ layer: 'b', frame: 'f', x: 1, y: 0, before: 0, after: RED })
        }).toThrow(/single \(layer, frame\)/)
        expect(() => {
            command.record({ layer: 'a', frame: 'g', x: 1, y: 0, before: 0, after: RED })
        }).toThrow(/single \(layer, frame\)/)
    })
})
