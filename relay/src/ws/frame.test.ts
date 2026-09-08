import { describe, expect, it } from 'vitest'
import { FrameDecoder, TooLargeError, encodeServerFrame } from './frame'

function masked(payload: readonly number[]): Uint8Array {
    const key = [1, 2, 3, 4]
    const len = payload.length
    let header: number[]
    if (len <= 125) {
        header = [0x82, 0x80 | len, ...key]
    } else if (len <= 0xffff) {
        header = [0x82, 0xfe, (len >>> 8) & 0xff, len & 0xff, ...key]
    } else {
        header = [
            0x82,
            0xff,
            0,
            0,
            0,
            0,
            (len >>> 24) & 0xff,
            (len >>> 16) & 0xff,
            (len >>> 8) & 0xff,
            len & 0xff,
            ...key,
        ]
    }
    const out = [...header]
    payload.forEach((byte, i) => out.push(byte ^ key[i % 4]!))
    return Uint8Array.from(out)
}

describe('frames', () => {
    it('decodes a masked client binary frame', () => {
        const decoder = new FrameDecoder(1024)
        expect(decoder.push(masked([9, 9]))).toEqual([
            { fin: true, opcode: 0x2, payload: Uint8Array.of(9, 9) },
        ])
    })

    it('reassembles a fragmented message', () => {
        const first = Uint8Array.of(0x02, 0x81, 1, 2, 3, 4, 6)
        const second = Uint8Array.of(0x80, 0x81, 5, 6, 7, 8, 12)
        const decoder = new FrameDecoder(1024)
        expect(decoder.push(first.slice(0, 3))).toEqual([])
        const rest = new Uint8Array(first.length - 3 + second.length)
        rest.set(first.slice(3), 0)
        rest.set(second, first.length - 3)
        expect(decoder.push(rest)).toEqual([
            { fin: true, opcode: 0x2, payload: Uint8Array.of(7, 9) },
        ])
    })

    it('rejects text frames and oversized payloads', () => {
        expect(() => new FrameDecoder(8).push(Uint8Array.of(0x81, 0x81, 1, 2, 3, 4, 6))).toThrow(
            RangeError,
        )
        expect(() =>
            new FrameDecoder(8).push(Uint8Array.of(0x82, 0xfe, 0x04, 0x00, 1, 2, 3, 4, 0, 0, 0, 0)),
        ).toThrow(TooLargeError)
    })

    it('round-trips a server frame past the 125-byte boundary', () => {
        const payload = Uint8Array.from({ length: 300 }, (_, i) => i & 0xff)
        const bytes = encodeServerFrame(0x2, payload)
        const decoder = new FrameDecoder(1024)

        const client = masked([...payload.slice(0, 300)])
        expect(decoder.push(client)[0]!.payload).toEqual(payload)
        expect(bytes[1]).toBe(126)
    })

    it('decides on a drip feed without retaining more than a bounded header', () => {
        const decoder = new FrameDecoder(8)
        const full = masked([9, 9, 9, 9, 9, 9, 9, 9])
        let completed = 0
        for (const byte of full) completed += decoder.push(Uint8Array.of(byte)).length
        expect(completed).toBe(1)

        const strict = new FrameDecoder(8)
        const header = [0x82, 0xfe, 0x00, 0x10]
        for (const byte of header.slice(0, 3)) expect(strict.push(Uint8Array.of(byte))).toEqual([])
        expect(() => strict.push(Uint8Array.of(header[3]!))).toThrow(TooLargeError)
    })
})
