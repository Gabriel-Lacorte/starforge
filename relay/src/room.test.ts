import { describe, expect, it, vi } from 'vitest'
import {
    ErrorCode,
    decodeFrame,
    decodeSprite,
    encodeFrame,
    encodeOperation,
    type Hello,
} from '@starforge/core'
import type { Peer } from './ws/socket.js'
import { ConnLimits } from './limits.js'
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
    it('echoes every op to all members including the sender', () => {
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
        expect(a.sent.length).toBe(1)
        expect(b.sent.length).toBe(1)
        const echo = decodeFrame(a.sent[0]!)
        const forwarded = decodeFrame(b.sent[0]!)
        if (echo.type !== 'op' || forwarded.type !== 'op') throw new Error('expected ops')
        expect(echo.stamp).toBe(stamp)
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

    it('replays missed ops in order, then goes live', () => {
        const room = new Room()
        const a = new FakePeer()
        const b = new FakePeer()
        const ja = room.join(a, hello())
        if (!('site' in ja)) throw new Error('join failed')
        const { layer, frame } = roomIds(room)
        const stamp = (1 << 8) | ja.site
        const op = {
            kind: 'pixel.patch' as const,
            layer,
            frame,
            xs: Uint16Array.of(0),
            ys: Uint16Array.of(0),
            colors: Uint32Array.of(0xffffffff),
        }
        room.onBytes(ja.site, encodeFrame({ type: 'op', seq: 0, stamp, body: encodeOperation(op) }))
        room.onBytes(ja.site, encodeFrame({ type: 'op', seq: 0, stamp, body: encodeOperation(op) }))
        const jb = room.join(b, { ...hello(), since: 0 })
        if (!('site' in jb)) throw new Error('join failed')
        expect(b.sent.length).toBe(3)
        const first = decodeFrame(b.sent[0]!)
        if (first.type !== 'welcome') throw new Error('expected welcome')
        expect(first.seq).toBe(2)
        expect(first.peers!.length).toBe(1)
        const op1 = decodeFrame(b.sent[1]!)
        const op2 = decodeFrame(b.sent[2]!)
        if (op1.type !== 'op' || op2.type !== 'op') throw new Error('expected ops')
        expect(op1.seq).toBe(1)
        expect(op2.seq).toBe(2)
    })

    it('sends resync instead of a gap larger than the retained tail', () => {
        const appended: number[] = []
        let snapshots = 0
        const room = new Room(undefined, {
            append: (seq) => appended.push(seq),
            snapshot: () => {
                snapshots++
            },
        })
        const a = new FakePeer()
        const ja = room.join(a, hello())
        if (!('site' in ja)) throw new Error('join failed')
        const { layer, frame } = roomIds(room)
        const stamp = (1 << 8) | ja.site
        for (let i = 0; i < 1005; i++) {
            const op = {
                kind: 'pixel.patch' as const,
                layer,
                frame,
                xs: Uint16Array.of(i % 64),
                ys: Uint16Array.of(Math.floor(i / 64) % 64),
                colors: Uint32Array.of(0xff0000ff + (i % 7)),
            }
            room.onBytes(
                ja.site,
                encodeFrame({ type: 'op', seq: 0, stamp, body: encodeOperation(op) }),
            )
        }
        expect(snapshots).toBeGreaterThan(0)
        expect(appended.length).toBe(1005)
        const b = new FakePeer()
        const jb = room.join(b, { ...hello(), since: 0 })
        if (!('site' in jb)) throw new Error('join failed')
        expect(b.sent.length).toBe(2)
        const second = decodeFrame(b.sent[1]!)
        if (second.type !== 'resync') throw new Error('expected resync')
        expect(second.seq).toBe(1005)
    }, 30000)

    it('answers rate_limited once the op budget is spent', () => {
        vi.useFakeTimers()
        try {
            vi.setSystemTime(0)
            const room = new Room()
            const a = new FakePeer()
            const joined = room.join(a, hello())
            if (!('site' in joined)) throw new Error('join failed')
            const { layer, frame } = roomIds(room)
            const limits = new ConnLimits()
            const stamp = (1 << 8) | joined.site
            const bytes = encodeFrame({
                type: 'op',
                seq: 0,
                stamp,
                body: encodeOperation({
                    kind: 'pixel.patch',
                    layer,
                    frame,
                    xs: Uint16Array.of(1),
                    ys: Uint16Array.of(1),
                    colors: Uint32Array.of(0xff0000ff),
                }),
            })
            for (let i = 0; i < 60; i++) room.onBytes(joined.site, bytes, limits)
            a.sent.length = 0
            room.onBytes(joined.site, bytes, limits)
            expect(a.sent.length).toBe(1)
            const err = decodeFrame(a.sent[0]!)
            if (err.type !== 'error') throw new Error('expected error')
            expect(err.code).toBe(ErrorCode.rateLimited)
            expect(a.closed).toBe(null)
        } finally {
            vi.useRealTimers()
        }
    })

    it('drops presence past the byte budget without erroring', () => {
        vi.useFakeTimers()
        try {
            vi.setSystemTime(0)
            const room = new Room()
            const a = new FakePeer()
            const b = new FakePeer()
            const joinedA = room.join(a, hello())
            const joinedB = room.join(b, hello())
            if (!('site' in joinedA) || !('site' in joinedB)) throw new Error('join failed')
            const limits = new ConnLimits()
            expect(limits.admitBytes(262144)).toBe(true)
            a.sent.length = 0
            b.sent.length = 0
            room.onBytes(
                joinedA.site,
                encodeFrame({
                    type: 'presence',
                    site: joinedA.site,
                    x: 3,
                    y: 4,
                    tool: 0,
                    layer: 'l',
                    frame: 'f',
                }),
                limits,
            )
            expect(b.sent.length).toBe(0)
            expect(a.sent.length).toBe(0)
            expect(a.closed).toBe(null)
        } finally {
            vi.useRealTimers()
        }
    })
})

describe('room abuse gates', () => {
    function joinedRoom(): {
        room: Room
        peer: FakePeer
        site: number
        layer: string
        frame: string
    } {
        const room = new Room()
        const peer = new FakePeer()
        const joined = room.join(peer, hello())
        if (!('site' in joined)) throw new Error('join failed')
        const { layer, frame } = roomIds(room)
        peer.sent.length = 0
        return { room, peer, site: joined.site, layer, frame }
    }

    function pixelOp(layer: string, frame: string) {
        return {
            kind: 'pixel.patch' as const,
            layer,
            frame,
            xs: Uint16Array.of(0),
            ys: Uint16Array.of(0),
            colors: Uint32Array.of(0xffffffff),
        }
    }

    function opBytes(stamp: number, layer: string, frame: string): Uint8Array {
        return encodeFrame({
            type: 'op',
            seq: 0,
            stamp,
            body: encodeOperation(pixelOp(layer, frame)),
        })
    }

    it('rejects ops with invalid stamps without broadcasting or mutating the doc', () => {
        const { room, peer, site, layer, frame } = joinedRoom()
        const before = room.snapshotBytes()
        for (const stamp of [0, site, 1 << 8]) {
            peer.sent.length = 0
            room.onBytes(site, opBytes(stamp, layer, frame))
            expect(peer.sent.length).toBe(1)
            const err = decodeFrame(peer.sent[0]!)
            if (err.type !== 'error') throw new Error('expected error')
            expect(err.code).toBe(ErrorCode.invalidOperation)
            expect(peer.closed).toBe(null)
        }
        expect(room.snapshotBytes()).toEqual(before)
    })

    it('rejects a stamp minted for another site without broadcasting or mutating the doc', () => {
        const room = new Room()
        const a = new FakePeer()
        const b = new FakePeer()
        const ja = room.join(a, hello())
        const jb = room.join(b, hello())
        if (!('site' in ja) || !('site' in jb)) throw new Error('join failed')
        const { layer, frame } = roomIds(room)
        const before = room.snapshotBytes()
        a.sent.length = 0
        b.sent.length = 0
        const foreign = (2 << 8) | (ja.site === 99 ? 100 : 99)
        room.onBytes(ja.site, opBytes(foreign, layer, frame))
        expect(a.sent.length).toBe(1)
        const err = decodeFrame(a.sent[0]!)
        if (err.type !== 'error') throw new Error('expected error')
        expect(err.code).toBe(ErrorCode.invalidOperation)
        expect(a.closed).toBe(null)
        expect(b.sent.length).toBe(0)
        expect(room.snapshotBytes()).toEqual(before)
    })

    it('sheds load with ERROR rateLimited and keeps the connection open', () => {
        const { room, peer, site, layer, frame } = joinedRoom()
        const limits = new ConnLimits()
        for (let i = 0; i < 60; i++) expect(limits.admit(1)).toBe(true)
        const before = room.snapshotBytes()
        room.onBytes(site, opBytes((1 << 8) | site, layer, frame), limits)
        expect(peer.sent.length).toBe(1)
        const err = decodeFrame(peer.sent[0]!)
        if (err.type !== 'error') throw new Error('expected error')
        expect(err.code).toBe(ErrorCode.rateLimited)
        expect(peer.closed).toBe(null)
        expect(room.snapshotBytes()).toEqual(before)
    })

    it('drops oversized raw frames before decode', () => {
        const { room, peer, site } = joinedRoom()
        const limits = new ConnLimits()
        room.onBytes(site, new Uint8Array(300 * 1024), limits)
        expect(peer.sent.length).toBe(1)
        const err = decodeFrame(peer.sent[0]!)
        if (err.type !== 'error') throw new Error('expected error')
        expect(err.code).toBe(ErrorCode.rateLimited)
        expect(peer.closed).toBe(null)
    })

    it('does not charge the op budget for frames that fail to decode', () => {
        const { room, peer, site, layer, frame } = joinedRoom()
        const limits = new ConnLimits()
        const garbage = new Uint8Array([0xff, 0x00, 0x01])
        for (let i = 0; i < 61; i++) {
            peer.sent.length = 0
            room.onBytes(site, garbage, limits)
            const err = decodeFrame(peer.sent[0]!)
            if (err.type !== 'error') throw new Error('expected error')
            expect(err.code).toBe(ErrorCode.invalidOperation)
        }
        peer.sent.length = 0
        room.onBytes(site, opBytes((1 << 8) | site, layer, frame), limits)
        const echo = decodeFrame(peer.sent[0]!)
        if (echo.type !== 'op') throw new Error(`expected op echo, got ${echo.type}`)
    })
})
