import { bench, describe } from 'vitest'
import { decodeOperation, encodeOperation } from '../wireOps'
import { packStamp } from './stamp'

interface LoggedOp {
    readonly seq: number
    readonly stamp: number
    readonly body: Uint8Array
}

const OPS = 1000
const log: LoggedOp[] = []
for (let index = 0; index < OPS; index++) {
    log.push({
        seq: index + 1,
        stamp: packStamp(index + 1, 7),
        body: encodeOperation({
            kind: 'pixel.patch',
            layer: 'layer-1',
            frame: 'frame-1',
            xs: Uint16Array.of(index % 64),
            ys: Uint16Array.of(Math.floor(index / 64) % 64),
            colors: Uint32Array.of(0xff000000 | index),
        }),
    })
}

function missedSince(since: number): LoggedOp[] {
    return log.filter((entry) => entry.seq > since)
}

describe('wire-decode replay', () => {
    bench(
        'decode 1000 pixel.patch bodies',
        () => {
            for (const entry of missedSince(0)) decodeOperation(entry.body)
        },
        { time: 1000, warmupTime: 200 },
    )
})
