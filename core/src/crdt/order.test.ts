import { describe, expect, it } from 'vitest'
import { OrderBook } from './order'
import { packStamp } from './stamp'

describe('OrderBook', () => {
    it('seeds consecutive integer keys and rejects duplicate identifiers', () => {
        const order = new OrderBook()
        order.seed(['a', 'b', 'c'])

        expect(order.key('a')).toBe(0)
        expect(order.key('b')).toBe(1)
        expect(order.key('c')).toBe(2)
        expect(() => new OrderBook().seed(['a', 'a'])).toThrow(RangeError)
    })

    it('sorts by numeric key then id without mutating supplied ids', () => {
        const order = new OrderBook()
        order.seed(['b', 'a', 'c'])
        const move = packStamp(1, 1)
        order.accept('a', 0, move)
        const ids = ['c', 'b', 'a']

        expect(order.sorted(ids)).toEqual(['a', 'b', 'c'])
        expect(ids).toEqual(['c', 'b', 'a'])
    })

    it('accepts a newer midpoint move and rejects stale moves', () => {
        const order = new OrderBook()
        order.seed(['a', 'b', 'c'])
        const current = packStamp(3, 1)

        expect(order.accept('a', 1.5, current)).toBe(true)
        expect(order.key('a')).toBe(1.5)
        expect(order.accept('a', 0.5, current)).toBe(false)
        expect(order.accept('a', 0.5, packStamp(2, 255))).toBe(false)
        expect(order.key('a')).toBe(1.5)
    })

    it('registers a newly created id with its stamped finite key', () => {
        const order = new OrderBook()
        order.seed(['a'])

        order.add('b', 0.5, packStamp(1, 1))

        expect(order.sorted(['a', 'b'])).toEqual(['a', 'b'])
        expect(() => order.add('b', 1, packStamp(2, 1))).toThrow(RangeError)
        expect(() => order.add('c', Number.NaN, packStamp(2, 1))).toThrow(RangeError)
    })

    it('rejects unknown ids and non-finite move keys', () => {
        const order = new OrderBook()
        order.seed(['a'])
        const stamp = packStamp(1, 1)

        expect(() => order.key('missing')).toThrow(RangeError)
        expect(() => order.accept('missing', 0, stamp)).toThrow(RangeError)
        expect(() => order.accept('a', Number.NaN, stamp)).toThrow(RangeError)
        expect(() => order.sorted(['missing'])).toThrow(RangeError)
    })

    it('applies a winning rebalance atomically and rejects stale or invalid tables', () => {
        const order = new OrderBook()
        order.seed(['a', 'b'])
        const rebalance = packStamp(4, 1)

        expect(
            order.applyRebalance(
                [
                    ['a', 2],
                    ['b', 1],
                ],
                rebalance,
            ),
        ).toBe(true)
        expect(order.sorted(['a', 'b'])).toEqual(['b', 'a'])
        expect(
            order.applyRebalance(
                [
                    ['a', 0],
                    ['b', 3],
                ],
                rebalance,
            ),
        ).toBe(false)
        expect(order.key('a')).toBe(2)
        expect(() =>
            order.applyRebalance(
                [
                    ['a', 0],
                    ['a', 1],
                ],
                packStamp(5, 1),
            ),
        ).toThrow(RangeError)
        expect(() => order.applyRebalance([['missing', 0]], packStamp(5, 1))).toThrow(RangeError)
        expect(() => order.applyRebalance([['a', Infinity]], packStamp(5, 1))).toThrow(RangeError)
        expect(order.key('a')).toBe(2)
        expect(order.key('b')).toBe(1)
    })

    it('allows a newer individual move after a rebalance', () => {
        const order = new OrderBook()
        order.seed(['a', 'b'])
        order.applyRebalance(
            [
                ['a', 5],
                ['b', 6],
            ],
            packStamp(4, 1),
        )

        expect(order.accept('a', 1, packStamp(5, 1))).toBe(true)
        expect(order.sorted(['a', 'b'])).toEqual(['a', 'b'])
    })

    it('converges a move and rebalance under reverse delivery', () => {
        const move = packStamp(10, 1)
        const rebalance = packStamp(4, 1)
        const left = new OrderBook()
        const right = new OrderBook()
        left.seed(['a', 'b'])
        right.seed(['a', 'b'])

        left.accept('a', -1, move)
        left.applyRebalance(
            [
                ['a', 2],
                ['b', 1],
            ],
            rebalance,
        )
        right.applyRebalance(
            [
                ['a', 2],
                ['b', 1],
            ],
            rebalance,
        )
        right.accept('a', -1, move)

        expect(left.sorted(['a', 'b'])).toEqual(['a', 'b'])
        expect(right.sorted(['a', 'b'])).toEqual(['a', 'b'])
    })
})
