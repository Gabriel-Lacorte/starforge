import { bench, describe } from 'vitest'
import { createSprite } from '../doc'
import { applyOperation, type PixelPatchOperation } from '../operation'
import { Replica, type StampedOperation } from './replica'
import { packStamp } from './stamp'

const SIDE = 30
const PIXELS = SIDE * SIDE
const doc = createSprite({ width: 64, height: 64, id: 'crdt-bench' })
doc.layers[0]!.id = 'layer-1'
doc.frames[0]!.id = 'frame-1'

const xs = new Uint16Array(PIXELS)
const ys = new Uint16Array(PIXELS)
for (let index = 0; index < PIXELS; index++) {
    xs[index] = index % SIDE
    ys[index] = Math.floor(index / SIDE)
}

function patch(color: number): PixelPatchOperation {
    const colors = new Uint32Array(PIXELS)
    colors.fill(color)
    return { kind: 'pixel.patch', layer: 'layer-1', frame: 'frame-1', xs, ys, colors }
}

const patches = [patch(0xffcc33ff), patch(0x6ee7ffff)] as const
const replica = new Replica(doc, 2)
let lamport = 0

describe('CRDT replica', () => {
    bench(
        'receive and apply a 900-pixel patch',
        () => {
            const message: StampedOperation = {
                type: 'operation',
                stamp: packStamp(++lamport, 1),
                operation: patches[lamport & 1]!,
            }
            const received = replica.receive(message)
            for (const operation of received.operations) applyOperation(doc, operation)
        },
        { time: 1000, warmupTime: 200 },
    )
})
