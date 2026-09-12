import { describe, expect, it } from 'vitest'
import {
    applyOperation,
    decodeFrame,
    decodeOperation,
    decodeSprite,
    documentFingerprint,
    encodeFrame,
    encodeOperation,
    packStamp,
    Replica,
    type DocumentOperation,
    type Hello,
    type Sprite,
} from '@starforge/core'
import type { Peer } from './ws/socket.js'
import { Room } from './room.js'

class FakePeer implements Peer {
    readonly sent: Uint8Array[] = []
    closed: number | null = null

    send(bytes: Uint8Array): void {
        this.sent.push(bytes)
    }

    close(code: number): void {
        this.closed = code
    }
}

function hello(): Hello {
    return {
        type: 'hello',
        protocol: 1,
        room: 'lab',
        nickname: 'ada',
        color: 0xffcc33ff,
        since: 0,
    }
}

function mulberry32(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state |= 0
        state = (state + 0x6d2b79f5) | 0
        let t = Math.imul(state ^ (state >>> 15), 1 | state)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function roomIds(room: Room): { layer: string; frame: string } {
    const probe = new FakePeer()
    const joined = room.join(probe, hello())
    if (!('site' in joined)) throw new Error('probe join failed')
    const welcome = decodeFrame(probe.sent[0]!)
    if (welcome.type !== 'welcome') throw new Error('expected welcome')
    const doc = decodeSprite(JSON.parse(new TextDecoder().decode(welcome.snapshot)) as unknown)
    const layer = doc.layers[0]!.id
    const frame = doc.frames[0]!.id
    room.leave(joined.site)
    return { layer, frame }
}

interface PublishedOp {
    readonly seq: number
    readonly stamp: number
    readonly operation: DocumentOperation
}

function shuffle<T>(values: readonly T[], rng: () => number): T[] {
    const out = [...values]
    for (let index = out.length - 1; index > 0; index--) {
        const swap = Math.floor(rng() * (index + 1))
        ;[out[index], out[swap]] = [out[swap]!, out[index]!]
    }
    return out
}

function cloneDoc(snapshot: string): Sprite {
    return decodeSprite(JSON.parse(snapshot) as unknown)
}

function deliver(doc: Sprite, replica: Replica, messages: readonly PublishedOp[]): void {
    for (const { stamp, operation } of messages) {
        const result = replica.receive({ type: 'operation', stamp, operation })
        for (const applied of result.operations) applyOperation(doc, applied)
    }
}

function runChaosSeed(seed: number): void {
    const rng = mulberry32(seed)
    const room = new Room()
    const publisher = new FakePeer()
    const joined = room.join(publisher, hello())
    if (!('site' in joined)) throw new Error('publisher join failed')
    const site = joined.site
    const initialSnapshot = new TextDecoder().decode(room.snapshotBytes())
    const { layer, frame } = roomIds(room)
    publisher.sent.length = 0

    for (let index = 0; index < 60; index++) {
        const op: DocumentOperation = {
            kind: 'pixel.patch',
            layer,
            frame,
            xs: Uint16Array.of(index % 64),
            ys: Uint16Array.of(Math.floor(index / 64) % 64),
            colors: Uint32Array.of((rng() * 0xffffffff) >>> 0),
        }
        room.onBytes(
            site,
            encodeFrame({
                type: 'op',
                seq: 0,
                stamp: packStamp(index + 1, site),
                body: encodeOperation(op),
            }),
        )
    }

    const published: PublishedOp[] = []
    for (const bytes of publisher.sent) {
        const echoed = decodeFrame(bytes)
        if (echoed.type !== 'op') continue
        published.push({
            seq: echoed.seq,
            stamp: echoed.stamp,
            operation: decodeOperation(echoed.body),
        })
    }
    published.sort((left, right) => left.seq - right.seq)
    expect(published).toHaveLength(60)

    const controlDoc = cloneDoc(initialSnapshot)
    deliver(controlDoc, new Replica(controlDoc, 41), published)
    const fingerprints = [documentFingerprint(controlDoc)]

    for (let replica = 0; replica < 3; replica++) {
        const received = new Set<number>()
        const stream = shuffle(published, rng).filter((op) => {
            const keep = rng() >= 0.2
            if (keep) received.add(op.seq)
            return keep
        })
        const duplicates = Math.max(1, Math.floor(stream.length * 0.1))
        for (let dup = 0; dup < duplicates; dup++) {
            const pick = stream[Math.floor(rng() * stream.length)]!
            stream.splice(Math.floor(rng() * (stream.length + 1)), 0, pick)
        }
        expect(received.size).toBeLessThan(published.length)

        const doc = cloneDoc(initialSnapshot)
        const fed = new Replica(doc, 42 + replica)
        deliver(doc, fed, stream)

        const missing: PublishedOp[] = []
        for (const entry of room.missedSince(0)) {
            if (entry.type !== 'op' || received.has(entry.seq)) continue
            missing.push({
                seq: entry.seq,
                stamp: entry.stamp,
                operation: decodeOperation(entry.body),
            })
        }
        missing.sort((left, right) => left.seq - right.seq)
        expect(missing.length).toBeGreaterThan(0)
        deliver(doc, fed, missing)

        fingerprints.push(documentFingerprint(doc))
    }

    expect(new Set(fingerprints).size).toBe(1)
}

describe('chaos convergence', () => {
    for (const seed of [7, 42, 137]) {
        it(`converges 60 room ops through shuffle+drop+duplicates (seed ${seed})`, () => {
            runChaosSeed(seed)
        })
    }
})
