import { describe, expect, it } from 'vitest'
import { LamportClock, MAX_LAMPORT, isNewer, packStamp, stampLamport, stampSite } from './stamp'

describe('packed Lamport stamps', () => {
    it('packs and unpacks the Lamport value and site ID', () => {
        expect(packStamp(1, 1)).toBe(0x00000101)
        expect(packStamp(MAX_LAMPORT, 255)).toBe(0xffffffff)
        expect(stampLamport(0x00000101)).toBe(1)
        expect(stampSite(0x00000101)).toBe(1)
    })

    it('rejects Lamport and site values outside their valid integer ranges', () => {
        for (const lamport of [0, MAX_LAMPORT + 1, 1.5, Number.NaN]) {
            expect(() => packStamp(lamport, 1)).toThrow(RangeError)
        }
        for (const site of [0, 256, 1.5, Number.NaN]) {
            expect(() => packStamp(1, site)).toThrow(RangeError)
        }
        expect(() => new LamportClock(0)).toThrow(RangeError)
    })

    it('compares packed values as unsigned stamps and rejects equal values', () => {
        const highBit = packStamp(0x800000, 1)
        const lowBit = packStamp(2, 1)
        expect(isNewer(highBit, lowBit)).toBe(true)
        expect(isNewer(lowBit, highBit)).toBe(false)
        expect(isNewer(highBit, highBit)).toBe(false)
    })

    it('increments before creating each local stamp', () => {
        const clock = new LamportClock(7)
        expect(clock.next()).toBe(packStamp(1, 7))
        expect(clock.next()).toBe(packStamp(2, 7))
    })

    it('advances to an observed remote Lamport value before issuing a local stamp', () => {
        const clock = new LamportClock(3)
        clock.observe(packStamp(9, 9))
        expect(clock.next()).toBe(packStamp(10, 3))
    })

    it('emits the maximum stamp once then throws LamportExhaustedError', () => {
        const clock = new LamportClock(255)
        clock.observe(packStamp(MAX_LAMPORT - 1, 1))
        expect(clock.next()).toBe(0xffffffff)
        expect(() => clock.next()).toThrow(
            expect.objectContaining({ name: 'LamportExhaustedError' }),
        )
    })
})
