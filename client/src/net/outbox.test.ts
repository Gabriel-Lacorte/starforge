import { describe, expect, it } from 'vitest'
import { MAX_PENDING, Outbox } from './outbox'

function body(byte: number): Uint8Array {
    return Uint8Array.of(byte)
}

describe('outbox', () => {
    it('acks a pending stamp and reports unknown stamps as missing', () => {
        const outbox = new Outbox()
        outbox.add(11, body(1))
        expect(outbox.pending).toHaveLength(1)
        expect(outbox.ack(12)).toBe(false)
        expect(outbox.pending).toHaveLength(1)
        expect(outbox.ack(11)).toBe(true)
        expect(outbox.pending).toHaveLength(0)
        expect(outbox.ack(11)).toBe(false)
    })

    it('takeAll drains pending entries in send order', () => {
        const outbox = new Outbox()
        outbox.add(1, body(1))
        outbox.add(2, body(2))
        outbox.add(3, body(3))
        const drained = outbox.takeAll()
        expect(drained.map((entry) => entry.stamp)).toEqual([1, 2, 3])
        expect(drained.map((entry) => entry.body)).toEqual([body(1), body(2), body(3)])
        expect(outbox.pending).toHaveLength(0)
        expect(outbox.takeAll()).toEqual([])
    })

    it('drops the oldest entry once more than MAX_PENDING are waiting', () => {
        const outbox = new Outbox()
        for (let stamp = 1; stamp <= MAX_PENDING + 1; stamp++) {
            outbox.add(stamp, body(stamp % 256))
        }
        expect(MAX_PENDING).toBe(500)
        expect(outbox.pending).toHaveLength(MAX_PENDING)
        expect(outbox.pending[0]!.stamp).toBe(2)
        expect(outbox.pending[MAX_PENDING - 1]!.stamp).toBe(MAX_PENDING + 1)
    })

    it('clear drops everything without returning it', () => {
        const outbox = new Outbox()
        outbox.add(1, body(1))
        outbox.add(2, body(2))
        outbox.clear()
        expect(outbox.pending).toHaveLength(0)
        expect(outbox.ack(1)).toBe(false)
    })
})
