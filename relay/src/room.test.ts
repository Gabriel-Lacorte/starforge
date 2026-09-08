import { describe, expect, it } from 'vitest'
import {
    decodeFrame,
    decodeSprite,
    encodeFrame,
    encodeOperation,
    type Hello,
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

function roomIds(room: Room): { layer: string; frame: string; probeSite: number } {
    const probe = new FakePeer()
    const joined = room.join(probe, hello())
    if (!('site' in joined)) throw new Error('probe join failed')
    const welcome = decodeFrame(probe.sent[0]!)
    if (welcome.type !== 'welcome') throw new Error('expected welcome')
    const doc = decodeSprite(JSON.parse(new TextDecoder().decode(welcome.snapshot)) as unknown)
    const layer = doc.layers[0]!.id
    const frame = doc.frames[0]!.id
    room.leave(joined.site)
    return { layer, frame, probeSite: joined.site }
}

describe('room', () => {
    it('broadcasts a pixel op to the other member only', () => {
        const room = new Room()
        const a = new FakePeer()
        const b = new FakePeer()
        const joinedA = room.join(a, hello())
        const joinedB = room.join(b, hello())
        if (!('site' in joinedA) || !('site' in joinedB)) throw new Error('join failed')
        const { layer, frame } = roomIds(room)
        a.sent.length = 0
        b.sent.length = 0

        const op = {
            kind: 'pixel.patch' as const,
            layer,
            frame,
            xs: Uint16Array.of(1, 2),
            ys: Uint16Array.of(1, 1),
            colors: Uint32Array.of(0xff0000ff, 0x00ff00ff),
        }
        const stamp = (1 << 8) | joinedA.site
        room.onBytes(
            joinedA.site,
            encodeFrame({ type: 'op', seq: 0, stamp, body: encodeOperation(op) }),
        )
        expect(a.sent.length).toBe(0)
        expect(b.sent.length).toBe(1)
        const forwarded = decodeFrame(b.sent[0]!)
        if (forwarded.type !== 'op') throw new Error('expected op')
        expect(forwarded.stamp).toBe(stamp)
    })

    it('rejects an invalid op but keeps the connection open', () => {
        const room = new Room()
        const a = new FakePeer()
        const joined = room.join(a, hello())
        if (!('site' in joined)) throw new Error('join failed')
        const { layer } = roomIds(room)
        a.sent.length = 0
        const badOp = { kind: 'layer.remove' as const, layer }
        const stamp = (1 << 8) | joined.site
        room.onBytes(
            joined.site,
            encodeFrame({ type: 'op', seq: 0, stamp, body: encodeOperation(badOp) }),
        )
        expect(a.sent.length).toBe(1)
        const err = decodeFrame(a.sent[0]!)
        if (err.type !== 'error') throw new Error('expected error')
        expect(err.code).toBe(1)
        expect(a.closed).toBe(null)
    })

    it('refuses the 17th member with roomFull', () => {
        const room = new Room()
        for (let i = 0; i < 16; i++) {
            const p = new FakePeer()
            const r = room.join(p, hello())
            if (!('site' in r)) throw new Error(`join ${String(i)} failed`)
        }
        const extra = new FakePeer()
        const result = room.join(extra, hello())
        expect('error' in result).toBe(true)
        expect(extra.sent.length).toBe(1)
        const err = decodeFrame(extra.sent[0]!)
        if (err.type !== 'error') throw new Error('expected error')
        expect(err.code).toBe(4)
        expect(extra.closed).toBe(1011)
    })

    it('stops sending to members that left', () => {
        const room = new Room()
        const a = new FakePeer()
        const b = new FakePeer()
        const ja = room.join(a, hello())
        const jb = room.join(b, hello())
        if (!('site' in ja) || !('site' in jb)) throw new Error('join failed')
        room.leave(jb.site)
        const { layer, frame } = roomIds(room)
        b.sent.length = 0
        a.sent.length = 0
        const op = {
            kind: 'pixel.patch' as const,
            layer,
            frame,
            xs: Uint16Array.of(0),
            ys: Uint16Array.of(0),
            colors: Uint32Array.of(0xffffffff),
        }
        room.onBytes(
            ja.site,
            encodeFrame({
                type: 'op',
                seq: 0,
                stamp: (1 << 8) | ja.site,
                body: encodeOperation(op),
            }),
        )
        expect(b.sent.length).toBe(0)
    })

    it('recycles site ids instead of overflowing the u8', () => {
        const room = new Room()
        for (let i = 0; i < 300; i++) {
            const p = new FakePeer()
            const r = room.join(p, hello())
            if (!('site' in r)) throw new Error(`join ${String(i)} failed`)
            expect(r.site).toBeGreaterThanOrEqual(1)
            expect(r.site).toBeLessThanOrEqual(255)
            room.leave(r.site)
        }
        const actives = new Set<number>()
        for (let i = 0; i < 5; i++) {
            const p = new FakePeer()
            const r = room.join(p, hello())
            if (!('site' in r)) throw new Error('join failed')
            actives.add(r.site)
        }
        expect(actives.size).toBe(5)
    })
})
