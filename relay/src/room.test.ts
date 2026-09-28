import { describe, expect, it, vi } from 'vitest'
import {
    WIRE_PROTOCOL,
    ErrorCode,
    applyOperation,
    createFrame,
    createLayer,
    decodeFrame,
    decodeOperation,
    decodeSprite,
    documentFingerprint,
    encodeFrame,
    encodeOperation,
    layerSet,
    type DocumentOperation,
    type Hello,
} from '@starforge/core'
import type { Peer } from './ws/socket.js'
import { RelayLog } from './log.js'
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
        protocol: WIRE_PROTOCOL,
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
        room.onBytes(
            ja.site,
            encodeFrame({ type: 'op', seq: 0, stamp: stamp + 0x100, body: encodeOperation(op) }),
        )
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
                encodeFrame({
                    type: 'op',
                    seq: 0,
                    stamp: stamp + i * 0x100,
                    body: encodeOperation(op),
                }),
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
                    nickname: 'ada',
                    color: 1,
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

    it('treats a retried frame with a seen stamp as a no-op', () => {
        const { room, peer, site, layer, frame } = joinedRoom()
        const op = pixelOp(layer, frame)
        const stamp = (5 << 8) | site
        const bytes = encodeFrame({ type: 'op', seq: 0, stamp, body: encodeOperation(op) })

        room.onBytes(site, bytes)
        peer.sent.length = 0
        room.onBytes(site, bytes)

        expect(peer.sent).toHaveLength(0)

        const latecomer = new FakePeer()
        const joined = room.join(latecomer, { ...hello(), since: 0 })
        if (!('site' in joined)) throw new Error('join failed')
        const welcome = decodeFrame(latecomer.sent[0]!)
        if (welcome.type !== 'welcome') throw new Error('expected welcome')
        expect(welcome.seq).toBe(1)
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

describe('room observability', () => {
    function observedRoom(): { room: Room; peer: FakePeer; site: number; lines: string[] } {
        const lines: string[] = []
        const log = new RelayLog({ level: 'debug', write: (line) => lines.push(line) })
        const room = new Room(undefined, undefined, undefined, { label: 'lab12', log })
        const peer = new FakePeer()
        const joined = room.join(peer, hello())
        if (!('site' in joined)) throw new Error('join failed')
        return { room, peer, site: joined.site, lines }
    }

    it('logs the join with the catch-up mode', () => {
        const { lines } = observedRoom()
        const join = lines.find((line) => line.includes('join '))
        expect(join).toContain('room=lab12')
        expect(join).toContain('nickname=ada')
        expect(join).toContain('catchUp=')
    })

    it('names the op kind and the document reason when rejecting', () => {
        const { room, peer, site, lines } = observedRoom()
        peer.sent.length = 0
        const op = { kind: 'layer.remove' as const, layer: 'missing-layer' }
        room.onBytes(
            site,
            encodeFrame({ type: 'op', seq: 0, stamp: (1 << 8) | site, body: encodeOperation(op) }),
        )

        const err = decodeFrame(peer.sent[0]!)
        if (err.type !== 'error') throw new Error('expected error')
        expect(err.code).toBe(ErrorCode.invalidOperation)
        expect(err.message.startsWith('invalid operation: layer.remove:')).toBe(true)

        const rejected = lines.find((line) => line.includes('op_rejected'))
        expect(rejected).toContain('room=lab12')
        expect(rejected).toContain('kind=layer.remove')
        expect(rejected).toContain('reason=')
    })

    it('logs the hex head of an unreadable frame', () => {
        const { room, peer, site, lines } = observedRoom()
        peer.sent.length = 0
        room.onBytes(site, new Uint8Array([0xc0, 0xff, 0xee, 0x00]))
        const dropped = lines.find((line) => line.includes('frame_dropped'))
        expect(dropped).toContain('site=')
        expect(dropped).toContain('bytes=4')
        expect(dropped).toContain('head="c0 ff ee 00"')
    })

    it('logs applied ops only at debug level', () => {
        const lines: string[] = []
        const log = new RelayLog({ level: 'info', write: (line) => lines.push(line) })
        const room = new Room(undefined, undefined, undefined, { label: 'lab12', log })
        const peer = new FakePeer()
        const joined = room.join(peer, hello())
        if (!('site' in joined)) throw new Error('join failed')
        const { layer, frame } = roomIds(room)

        const op = {
            kind: 'pixel.patch' as const,
            layer,
            frame,
            xs: Uint16Array.of(0),
            ys: Uint16Array.of(0),
            colors: Uint32Array.of(0xffffffff),
        }
        room.onBytes(
            joined.site,
            encodeFrame({
                type: 'op',
                seq: 0,
                stamp: (1 << 8) | joined.site,
                body: encodeOperation(op),
            }),
        )

        expect(lines.some((line) => line.includes('op_applied'))).toBe(false)
        expect(lines.some((line) => line.includes('join '))).toBe(true)
    })
})

describe('room structural ops over the wire', () => {
    it('every op kind reaches the other member byte-identical and lands in the snapshot', () => {
        const room = new Room()
        const a = new FakePeer()
        const b = new FakePeer()
        const ja = room.join(a, hello())
        const jb = room.join(b, hello())
        if (!('site' in ja) || !('site' in jb)) throw new Error('join failed')
        const { layer, frame } = roomIds(room)

        const mirror = decodeSprite(
            JSON.parse(new TextDecoder().decode(room.snapshotBytes())) as unknown,
        )
        let lamport = 0
        let applied = 0

        const send = (op: DocumentOperation, orderKey?: number): void => {
            lamport += 1
            applied += 1
            applyOperation(mirror, op)
            a.sent.length = 0
            b.sent.length = 0
            const stamp = (lamport << 8) | ja.site
            room.onBytes(
                ja.site,
                encodeFrame({
                    type: 'op',
                    seq: 0,
                    stamp,
                    body: encodeOperation(op),
                    ...(orderKey !== undefined ? { orderKey } : {}),
                }),
            )

            for (const peer of [a, b]) {
                expect(peer.sent.length, `${op.kind} reached everyone`).toBe(1)
                const echoed = decodeFrame(peer.sent[0]!)
                if (echoed.type !== 'op') throw new Error(`expected op echo, got ${echoed.type}`)
                expect(echoed.stamp).toBe(stamp)
                expect(echoed.seq).toBe(applied)
                expect(echoed.body).toEqual(encodeOperation(op))
                expect(echoed.orderKey).toBe(orderKey)
                const decoded = decodeOperation(echoed.body)
                expect(decoded.kind).toBe(op.kind)
            }
        }

        const second = createLayer('Layer 2')
        const third = createLayer('Layer 3')
        const extraFrame = createFrame(500)

        send({ kind: 'layer.add', layer: second, after: layer }, 1)
        send({ kind: 'layer.add', layer: third, after: null }, 0.5)
        send({ kind: 'layer.move', layer: third.id, after: second.id }, 0.75)
        send(layerSet(second.id, 'name', 'renamed'))
        send(layerSet(second.id, 'opacity', 128))
        send(layerSet(second.id, 'visible', false))
        send(layerSet(second.id, 'blendMode', 'multiply'))
        send({ kind: 'frame.add', frame: extraFrame, after: frame }, 1)
        send({ kind: 'frame.move', frame: extraFrame.id, after: null }, 0.5)
        send({ kind: 'frame.setDuration', frame: extraFrame.id, duration: 900 })
        send({ kind: 'palette.add', color: '#ff0000', index: 0 })
        send({ kind: 'palette.set', index: 0, color: '#00ff00' })
        send({ kind: 'palette.add', color: '#0000ff', index: 1 })
        send({ kind: 'palette.move', from: 0, to: 1 })
        send({ kind: 'palette.rename', name: 'room pal' })
        send({ kind: 'palette.remove', index: 1 })
        send({ kind: 'document.rename', title: 'renamed room' })
        send({
            kind: 'pixel.patch',
            layer,
            frame,
            xs: Uint16Array.of(3, 4),
            ys: Uint16Array.of(5, 5),
            colors: Uint32Array.of(0xff00ffff, 0x00ffffff),
        })
        send({ kind: 'layer.remove', layer: third.id })

        const late = new FakePeer()
        const joined = room.join(late, { ...hello(), since: 0 })
        if (!('site' in joined)) throw new Error('late join failed')
        const welcome = decodeFrame(late.sent[0]!)
        if (welcome.type !== 'welcome') throw new Error('expected welcome')
        const served = decodeSprite(
            JSON.parse(new TextDecoder().decode(welcome.snapshot)) as unknown,
        )
        expect(documentFingerprint(served)).toBe(documentFingerprint(mirror))
        expect(served.layers.map((l) => l.name)).toEqual(['Layer 1', 'renamed'])
        expect(served.frames.map((f) => f.duration)).toEqual(mirror.frames.map((f) => f.duration))
        expect(served.meta.title).toBe('renamed room')
    })
})
