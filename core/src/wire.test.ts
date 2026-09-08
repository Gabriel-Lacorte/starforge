import { describe, expect, it } from 'vitest'
import { decodeFrame, encodeFrame, ErrorCode, WIRE_PROTOCOL } from './wire'

describe('wire envelope', () => {
    it('round-trips a hello', () => {
        const bytes = encodeFrame({
            type: 'hello',
            protocol: WIRE_PROTOCOL,
            room: 'lab',
            nickname: 'ada',
            color: 0xffcc33ff,
            since: 0,
        })
        expect(decodeFrame(bytes)).toEqual({
            type: 'hello',
            protocol: WIRE_PROTOCOL,
            room: 'lab',
            nickname: 'ada',
            color: 0xffcc33ff,
            since: 0,
        })
    })

    it('rejects truncated input instead of reading past the end', () => {
        const bytes = encodeFrame({ type: 'error', code: ErrorCode.roomFull, message: 'full' })
        expect(() => decodeFrame(bytes.slice(0, bytes.length - 1))).toThrow(RangeError)
    })

    it('rejects an unknown frame type', () => {
        expect(() => decodeFrame(Uint8Array.of(99, 0))).toThrow(RangeError)
    })
})
