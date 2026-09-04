import { describe, expect, it } from 'vitest'
import {
    createLayer,
    createSprite,
    decodeSprite,
    documentFingerprint,
    encodeSprite,
} from '@starforge/core'
import { DocumentSession } from '../document/session'
import { createCrdtDemo } from './crdtDemo'

const RED = 0xff0000ff
const BLUE = 0x0000ffff

function sessions(): {
    left: DocumentSession
    right: DocumentSession
    layer: string
    frame: string
} {
    const original = createSprite({ width: 16, height: 16, id: 'demo-sprite' })
    const left = new DocumentSession(decodeSprite(encodeSprite(original)))
    const right = new DocumentSession(decodeSprite(encodeSprite(original)))
    return {
        left,
        right,
        layer: original.layers[0]!.id,
        frame: original.frames[0]!.id,
    }
}

describe('createCrdtDemo', () => {
    it('converges conflicting and independent writes after reverse duplicate delivery', () => {
        const { left, right, layer, frame } = sessions()
        const demo = createCrdtDemo(left, right, 1, 2)

        left.apply('left pixels', {
            kind: 'pixel.patch',
            layer,
            frame,
            xs: Uint16Array.of(2, 6),
            ys: Uint16Array.of(3, 3),
            colors: Uint32Array.of(RED, RED),
        })
        right.apply('right pixels', {
            kind: 'pixel.patch',
            layer,
            frame,
            xs: Uint16Array.of(2, 10),
            ys: Uint16Array.of(3, 3),
            colors: Uint32Array.of(BLUE, BLUE),
        })

        const duplicate = demo.queue[0]!
        demo.queue.reverse()
        demo.queue.push(duplicate)
        demo.deliverAll()

        expect(documentFingerprint(left.doc)).toBe(documentFingerprint(right.doc))
    })

    it('applies every structural operation released by one replica result', () => {
        const { left, right, layer } = sessions()
        const demo = createCrdtDemo(left, right, 1, 2)
        const added = createLayer('Ink', 'ink-layer')

        left.apply('add ink', { kind: 'layer.add', layer: added, after: layer })
        left.apply('dim ink', { kind: 'layer.set', layer: added.id, prop: 'opacity', value: 90 })

        demo.deliver(1)
        demo.deliver(0)

        expect(right.doc.layers.find(({ id }) => id === added.id)?.opacity).toBe(90)
        expect(documentFingerprint(left.doc)).toBe(documentFingerprint(right.doc))
    })

    it('exposes controlled queue operations for the browser lab', () => {
        const { left, right } = sessions()
        const demo = createCrdtDemo(left, right, 1, 2) as unknown as Record<string, unknown>

        expect(typeof demo.subscribe).toBe('function')
        expect(typeof demo.reverse).toBe('function')
        expect(typeof demo.duplicate).toBe('function')
    })

    it('notifies queue observers for enqueue, reorder, duplicate, and delivery', () => {
        const { left, right, layer, frame } = sessions()
        const demo = createCrdtDemo(left, right, 1, 2)
        const sizes: number[] = []
        const off = demo.subscribe(() => sizes.push(demo.queue.length))

        left.apply('left pixel', {
            kind: 'pixel.patch',
            layer,
            frame,
            xs: Uint16Array.of(4),
            ys: Uint16Array.of(4),
            colors: Uint32Array.of(RED),
        })
        demo.reverse()
        demo.duplicate(0)
        demo.deliver(0)
        off()
        demo.deliverAll()

        expect(sizes).toEqual([1, 1, 2, 1])
        expect(demo.queue).toHaveLength(0)
    })

    it('rejects duplicating a message that is not in the queue', () => {
        const { left, right } = sessions()
        const demo = createCrdtDemo(left, right, 1, 2)

        expect(() => demo.duplicate(0)).toThrow(RangeError)
    })
})
