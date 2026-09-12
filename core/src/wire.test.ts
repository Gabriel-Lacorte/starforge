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

describe('room frames', () => {
    it('round-trips presence with a negative cursor', () => {
        const frame = {
            type: 'presence',
            site: 3,
            x: -4,
            y: 65,
            tool: 0,
            layer: 'l1',
            frame: 'f1',
        } as const
        expect(decodeFrame(encodeFrame(frame))).toEqual(frame)
    })

    it('round-trips join, leave and resync', () => {
        const join = { type: 'peerJoin', site: 2, nickname: 'ada', color: 1 } as const
        expect(decodeFrame(encodeFrame(join))).toEqual(join)
        const leave = { type: 'peerLeave', site: 2 } as const
        expect(decodeFrame(encodeFrame(leave))).toEqual(leave)
        const resync = { type: 'resync', seq: 41, snapshot: Uint8Array.of(7, 8) } as const
        expect(decodeFrame(encodeFrame(resync))).toEqual(resync)
    })

    it('carries the member list in welcome', () => {
        const frame = {
            type: 'welcome',
            site: 1,
            seq: 0,
            lamport: 0,
            snapshot: Uint8Array.of(1),
            peers: [{ site: 2, nickname: 'ada', color: 9 }],
        } as const
        expect(decodeFrame(encodeFrame(frame))).toEqual(frame)
    })

    it('rejects truncated presence instead of reading past the end', () => {
        const bytes = encodeFrame({ type: 'peerLeave', site: 2 })
        expect(() => decodeFrame(bytes.slice(0, 1))).toThrow(RangeError)
    })

    it('assigns the room error codes', () => {
        expect(ErrorCode.roomNotFound).toBe(6)
        expect(ErrorCode.rateLimited).toBe(7)
        expect(ErrorCode.tooManyRooms).toBe(8)
    })
})
