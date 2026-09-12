import { describe, expect, it, vi } from 'vitest'
import { ConnLimits, TokenBucket, createThrottle } from './limits'

describe('limits', () => {
    it('refills the bucket over time', () => {
        vi.useFakeTimers()
        try {
            vi.setSystemTime(0)
            const bucket = new TokenBucket(2, 1)
            expect(bucket.take()).toBe(true)
            expect(bucket.take()).toBe(true)
            expect(bucket.take()).toBe(false)
            vi.setSystemTime(2000)
            expect(bucket.take()).toBe(true)
        } finally {
            vi.useRealTimers()
        }
    })

    it('allows 20 rooms per hour per IP, then denies', () => {
        const throttle = createThrottle(20)
        for (let i = 0; i < 20; i++) expect(throttle('1.2.3.4', i * 1000)).toBe(true)
        expect(throttle('1.2.3.4', 20 * 1000)).toBe(false)
        expect(throttle('5.6.7.8', 20 * 1000)).toBe(true)
        expect(throttle('1.2.3.4', 3600 * 1000 + 1)).toBe(true)
    })
})

describe('conn limits', () => {
    it('admits a burst of 60 ops, then denies the 61st', () => {
        vi.useFakeTimers()
        try {
            vi.setSystemTime(0)
            const limits = new ConnLimits()
            for (let i = 0; i < 60; i++) expect(limits.admit(10)).toBe(true)
            expect(limits.admit(10)).toBe(false)
        } finally {
            vi.useRealTimers()
        }
    })

    it('denies a single 300 KiB message', () => {
        vi.useFakeTimers()
        try {
            vi.setSystemTime(0)
            expect(new ConnLimits().admit(300 * 1024)).toBe(false)
        } finally {
            vi.useRealTimers()
        }
    })

    it('refills after 1 s', () => {
        vi.useFakeTimers()
        try {
            vi.setSystemTime(0)
            const limits = new ConnLimits()
            for (let i = 0; i < 60; i++) expect(limits.admit(10)).toBe(true)
            expect(limits.admit(10)).toBe(false)
            vi.setSystemTime(1000)
            expect(limits.admit(10)).toBe(true)
        } finally {
            vi.useRealTimers()
        }
    })

    it('gates bytes and ops independently', () => {
        vi.useFakeTimers()
        try {
            vi.setSystemTime(0)
            const limits = new ConnLimits()
            expect(limits.admitBytes(300 * 1024)).toBe(false)
            expect(limits.admitBytes(1024)).toBe(true)
            for (let i = 0; i < 60; i++) expect(limits.admitOp()).toBe(true)
            expect(limits.admitOp()).toBe(false)
        } finally {
            vi.useRealTimers()
        }
    })
})
