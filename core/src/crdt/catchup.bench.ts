import { bench, describe } from 'vitest'
import { decodeOperation, encodeOperation } from '../wireOps'
import { packStamp } from './stamp'

interface LoggedOp {
    readonly seq: number
    readonly stamp: number
    readonly body: Uint8Array
}

// NOTE (deviation from the brief, forced by the type gate): the brief asks
// this bench to construct a relay Room, but any static import of
// relay/src/room.ts pulls node-only modules (node:sqlite, node:net, Buffer,
// TextEncoder globals) into core's program, where tsconfig sets `types: []`
// and `tsc -p core --noEmit` (part of `npm run lint`) fails on them
// (verified: TS2591/TS2304 on store.ts, socket.ts, room.ts). The relay also
// compacts its log to a resync snapshot every 200 ops, so a real Room cannot
// even hold a 1000-op tail. This bench therefore mirrors the Room mechanics
// exactly — an append-only { seq, stamp, body } log published through the
// real wire encoding, then a fresh missedSince(0) tail filter + per-op decode
// loop — using core primitives only. The measured work is the 1000-op replay
// the brief asks for, with log-only output and no assertions.
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
