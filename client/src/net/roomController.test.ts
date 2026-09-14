import { describe, expect, it, vi } from 'vitest'
import {
    createSprite,
    decodeOperation,
    decodeSprite,
    encodeOperation,
    encodeSprite,
    Replica,
    type NetFrame,
    type Sprite,
} from '@starforge/core'
import type { DocumentSession } from '../document/session'
import type { ToolId } from '../editor/store'
import type { ConnStatus } from './connection'
import type { PendingStore } from './pendingStore'
import { createRoom, RoomController } from './roomController'

class FakeConnection {
    onFrame: (frame: NetFrame) => void = (): void => undefined
    onError: (message: string) => void = (): void => undefined
    readonly sent: NetFrame[] = []
    closed = false
    lastSeq = 0
    private line: ConnStatus = 'open'
    private readonly listeners = new Set<() => void>()

    send(frame: NetFrame): void {
        this.sent.push(frame)
    }

    status(): ConnStatus {
        return this.closed ? 'closed' : this.line
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener)
        return (): void => {
            this.listeners.delete(listener)
        }
    }

    /** Simulates a drop (`connecting`) or redial (`open`) reaching the page. */
    setStatus(next: ConnStatus): void {
        this.line = next
        for (const listener of [...this.listeners]) listener()
    }

    resetSeq(seq: number): void {
        this.lastSeq = seq
    }

    close(): void {
        this.closed = true
    }

    connect(): void {
        /* fake is already "open" */
    }
}

function sprite16(): Sprite {
    return createSprite({ width: 16, height: 16, title: 'room' })
}

function snapshotBytes(doc: Sprite): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(encodeSprite(doc)))
}

function opsOf(conn: FakeConnection): Extract<NetFrame, { type: 'op' }>[] {
    return conn.sent.filter(
        (entry): entry is Extract<NetFrame, { type: 'op' }> => entry.type === 'op',
    )
}

function welcomeFrame(doc: Sprite, site = 1): NetFrame {
    return {
        type: 'welcome',
        site,
        seq: 0,
        lamport: 0,
        peers: [],
        snapshot: snapshotBytes(doc),
    }
}

async function connected(
    opts?: Partial<{
        site: number
        toolStore: { state: { tool: ToolId } }
        readout: {
            state: { hover: { x: number; y: number; color: number } | null }
        }
    }>,
): Promise<{ controller: RoomController; conn: FakeConnection; doc: Sprite }> {
    const doc = sprite16()
    const conn = new FakeConnection()
    const controller = new RoomController({
        url: 'ws://x/wire',
        room: 'abc',
        profile: { nickname: 'ada', color: 1 },
        connection: conn,
        ...(opts?.toolStore !== undefined ? { store: opts.toolStore } : {}),
        ...(opts?.readout !== undefined ? { readout: opts.readout } : {}),
    })
    const pending = controller.connect()
    conn.onFrame(welcomeFrame(doc, opts?.site ?? 1))
    await pending
    return { controller, conn, doc }
}

describe('room controller', () => {
    it('sends exactly one OP frame with the replica stamp for a local pixel op', async () => {
        const { controller, conn } = await connected()
        const session = controller.session!
        const layer = session.doc.layers[0]!.id
        const frame = session.doc.frames[0]!.id

        session.apply('paint', {
            kind: 'pixel.patch',
            layer,
            frame,
            xs: Uint16Array.of(2),
            ys: Uint16Array.of(3),
            colors: Uint32Array.of(0xff0000ff),
        })

        const ops = conn.sent.filter(
            (entry): entry is Extract<NetFrame, { type: 'op' }> => entry.type === 'op',
        )
        expect(ops).toHaveLength(1)
        const op = ops[0]!
        expect(op.stamp & 0xff).toBe(1)
        controller.close()
    })

    it('applies a remote op through the replica (session subscriber fires once)', async () => {
        const { controller, conn, doc } = await connected()
        const session = controller.session!
        const layer = session.doc.layers[0]!.id
        const frame = session.doc.frames[0]!.id
        let fires = 0
        session.subscribe(() => {
            fires += 1
        })

        const remoteDoc = decodeSprite(encodeSprite(doc))
        const remote = new Replica(remoteDoc, 2)
        const message = remote.publish({
            kind: 'pixel.patch',
            layer,
            frame,
            xs: Uint16Array.of(4),
            ys: Uint16Array.of(4),
            colors: Uint32Array.of(0x0000ffff),
        }).message
        if (message?.type !== 'operation') throw new Error('expected remote message')
        conn.onFrame({
            type: 'op',
            seq: 1,
            stamp: message.stamp,
            body: encodeOperation(message.operation),
        })

        expect(fires).toBe(1)
        controller.close()
    })

    it('throttles presence to one send per change (50 ms ticks)', async () => {
        vi.useFakeTimers()
        try {
            const toolStore = { state: { tool: 'pencil' as ToolId } }
            const readout = {
                state: {
                    hover: { x: 3, y: 5, color: 0xffffffff } as {
                        x: number
                        y: number
                        color: number
                    } | null,
                },
            }
            const { controller, conn } = await connected({ toolStore, readout })

            vi.advanceTimersByTime(50)
            vi.advanceTimersByTime(50)
            const first = conn.sent.filter(
                (entry): entry is Extract<NetFrame, { type: 'presence' }> =>
                    entry.type === 'presence',
            )
            expect(first).toHaveLength(1)
            const presence = first[0]!
            expect(presence.x).toBe(3)
            expect(presence.y).toBe(5)

            vi.advanceTimersByTime(50)
            expect(conn.sent.filter((entry) => entry.type === 'presence')).toHaveLength(1)
            controller.close()
        } finally {
            vi.useRealTimers()
        }
    })

    it('surfaces a non-geometry publish failure as a notice', async () => {
        const { controller } = await connected()
        const session = controller.session!
        const layer = session.doc.layers[0]!.id
        const frame = session.doc.frames[0]!.id
        const failure = new Error('relay dropped the op')
        const publish = vi.spyOn(Replica.prototype, 'publish').mockImplementationOnce((): never => {
            throw failure
        })
        try {
            session.apply('paint', {
                kind: 'pixel.patch',
                layer,
                frame,
                xs: Uint16Array.of(2),
                ys: Uint16Array.of(3),
                colors: Uint32Array.of(0xff0000ff),
            })
        } finally {
            publish.mockRestore()
        }
        expect(controller.notices).toContain('relay dropped the op')
        controller.close()
    })

    it('closes the connection and records a notice for a geometry op', async () => {
        const { controller, conn } = await connected()
        const session = controller.session!

        session.apply('resize', {
            kind: 'document.resize',
            width: 32,
            height: 32,
            offsetX: 0,
            offsetY: 0,
        })

        expect(conn.closed).toBe(true)
        expect(controller.notices.join('\n')).toMatch(
            /canvas size is locked while the room is open/,
        )
        controller.close()
    })

    it('fires onResync with the decoded doc for a RESYNC frame', async () => {
        const { controller, conn } = await connected()
        let got: Sprite | null = null
        controller.onResync = (doc: Sprite): void => {
            got = doc
        }
        const fresh = sprite16()
        conn.onFrame({ type: 'resync', seq: 7, snapshot: snapshotBytes(fresh) })
        expect(got).not.toBeNull()
        expect((got as unknown as Sprite).width).toBe(16)
        controller.close()
    })

    it('routes peer frames to the presence store', async () => {
        const { controller, conn } = await connected()
        conn.onFrame({ type: 'peerJoin', site: 2, nickname: 'grace', color: 9 })
        expect(controller.peers.peers().map((peer) => peer.site)).toEqual([2])
        conn.onFrame({
            type: 'presence',
            site: 2,
            x: 7,
            y: 9,
            tool: 1,
            layer: 'layer-1',
            frame: 'frame-1',
        })
        expect(controller.peers.peers().find((peer) => peer.site === 2)?.x).toBe(7)
        conn.onFrame({ type: 'peerLeave', site: 2 })
        expect(controller.peers.peers()).toHaveLength(0)
        controller.close()
    })

    it('treats your own echo as an ack without double-applying', async () => {
        const { controller, conn } = await connected()
        const session = controller.session!
        const layer = session.doc.layers[0]!.id
        const frame = session.doc.frames[0]!.id
        session.apply('paint', {
            kind: 'pixel.patch',
            layer,
            frame,
            xs: Uint16Array.of(2),
            ys: Uint16Array.of(3),
            colors: Uint32Array.of(0xff0000ff),
        })
        const first = opsOf(conn)
        expect(first).toHaveLength(1)

        let fires = 0
        session.subscribe(() => {
            fires += 1
        })
        conn.onFrame({ type: 'op', seq: 1, stamp: first[0]!.stamp, body: first[0]!.body })
        expect(fires).toBe(0)
        conn.setStatus('connecting')
        conn.setStatus('open')
        expect(opsOf(conn)).toHaveLength(1)
        controller.close()
    })

    it('replays unacked ops with the same stamp and body after a reconnect', async () => {
        const { controller, conn } = await connected()
        const session = controller.session!
        const layer = session.doc.layers[0]!.id
        const frame = session.doc.frames[0]!.id
        session.apply('paint', {
            kind: 'pixel.patch',
            layer,
            frame,
            xs: Uint16Array.of(2),
            ys: Uint16Array.of(3),
            colors: Uint32Array.of(0xff0000ff),
        })
        expect(opsOf(conn)).toHaveLength(1)

        conn.setStatus('connecting')
        conn.setStatus('open')
        const resent = opsOf(conn)
        expect(resent).toHaveLength(2)
        expect(resent[1]!.stamp).toBe(resent[0]!.stamp)
        expect(resent[1]!.body).toEqual(resent[0]!.body)
        controller.close()
    })

    it('drops pending ops and re-anchors the line on RESYNC', async () => {
        const { controller, conn } = await connected()
        const session = controller.session!
        const layer = session.doc.layers[0]!.id
        const frame = session.doc.frames[0]!.id
        session.apply('paint', {
            kind: 'pixel.patch',
            layer,
            frame,
            xs: Uint16Array.of(2),
            ys: Uint16Array.of(3),
            colors: Uint32Array.of(0xff0000ff),
        })
        expect(opsOf(conn)).toHaveLength(1)

        let got: Sprite | null = null
        let seq = -1
        controller.onResync = (doc: Sprite, next: number): void => {
            got = doc
            seq = next
        }
        conn.onFrame({ type: 'resync', seq: 7, snapshot: snapshotBytes(sprite16()) })
        expect((got as unknown as Sprite).width).toBe(16)
        expect(seq).toBe(7)
        expect(conn.lastSeq).toBe(7)

        conn.setStatus('connecting')
        conn.setStatus('open')
        expect(opsOf(conn)).toHaveLength(1)

        controller.close()
    })

    it('carries the resync seq into the remount so the fresh hello resumes there', async () => {
        const { controller, conn } = await connected()
        let seq = -1
        controller.onResync = (_doc: Sprite, next: number): void => {
            seq = next
        }
        conn.onFrame({ type: 'resync', seq: 41, snapshot: snapshotBytes(sprite16()) })
        expect(conn.lastSeq).toBe(41)
        expect(seq).toBe(41)

        const remountConn = new FakeConnection()
        const remount = new RoomController({
            url: 'ws://x/wire',
            room: 'abc',
            profile: { nickname: 'ada', color: 1 },
            connection: remountConn,
            since: seq,
        })
        expect(remountConn.lastSeq).toBe(41)
        controller.close()
        remount.close()
    })

    it('detaches the session on close so later local ops never reach the wire', async () => {
        const { controller, conn } = await connected()
        controller.close()
        const session = controller.session!
        const layer = session.doc.layers[0]!.id
        const frame = session.doc.frames[0]!.id
        session.apply('paint', {
            kind: 'pixel.patch',
            layer,
            frame,
            xs: Uint16Array.of(2),
            ys: Uint16Array.of(3),
            colors: Uint32Array.of(0xff0000ff),
        })

        conn.setStatus('connecting')
        conn.setStatus('open')
        expect(opsOf(conn)).toHaveLength(0)
    })

    it('detaches the session on the geometry backstop so paints stop queuing', async () => {
        const { controller, conn } = await connected()
        const session = controller.session!
        session.apply('resize', {
            kind: 'document.resize',
            width: 32,
            height: 32,
            offsetX: 0,
            offsetY: 0,
        })
        expect(conn.closed).toBe(true)
        const layer = session.doc.layers[0]!.id
        const frame = session.doc.frames[0]!.id
        session.apply('paint', {
            kind: 'pixel.patch',
            layer,
            frame,
            xs: Uint16Array.of(1),
            ys: Uint16Array.of(1),
            colors: Uint32Array.of(0xff0000ff),
        })
        expect(opsOf(conn)).toHaveLength(0)
        controller.close()
    })

    it('publishes only the filtered inverse once on collaborative undo', async () => {
        const { controller, conn, doc } = await connected()
        const session = controller.session!
        const layer = session.doc.layers[0]!.id
        const frame = session.doc.frames[0]!.id
        session.apply('paint', {
            kind: 'pixel.patch',
            layer,
            frame,
            xs: Uint16Array.of(0, 1),
            ys: Uint16Array.of(0, 0),
            colors: Uint32Array.of(0xff0000ff, 0xff0000ff),
        })
        expect(opsOf(conn)).toHaveLength(1)

        const remote = new Replica(decodeSprite(encodeSprite(doc)), 2)
        const stolen = remote.publish({
            kind: 'pixel.patch',
            layer,
            frame,
            xs: Uint16Array.of(1),
            ys: Uint16Array.of(0),
            colors: Uint32Array.of(0x0000ffff),
        }).message
        if (stolen?.type !== 'operation') throw new Error('expected remote message')
        conn.onFrame({
            type: 'op',
            seq: 1,
            stamp: stolen.stamp,
            body: encodeOperation(stolen.operation),
        })

        const before = opsOf(conn).length
        session.undo()
        const fresh = opsOf(conn).slice(before)
        expect(fresh).toHaveLength(1)
        const inverse = decodeOperation(fresh[0]!.body)
        if (inverse.kind !== 'pixel.patch') throw new Error('expected a pixel inverse')
        expect([...inverse.xs]).toEqual([0])
        expect([...inverse.ys]).toEqual([0])
        expect([...inverse.colors]).toEqual([0])
        controller.close()
    })

    function memorySeqStore(initial = 0): {
        load(roomId: string): number
        save(roomId: string, seq: number): void
        saved: { room: string; seq: number }[]
    } {
        let value = initial
        const saved: { room: string; seq: number }[] = []
        return {
            load: (): number => value,
            save: (room: string, seq: number): void => {
                value = seq
                saved.push({ room, seq })
            },
            saved,
        }
    }

    it('seeds the hello seq from the seq store', () => {
        const store = memorySeqStore(41)
        const conn = new FakeConnection()
        const controller = new RoomController({
            url: 'ws://x/wire',
            room: 'abc',
            profile: { nickname: 'ada', color: 1 },
            connection: conn,
            seqStore: store,
        })
        expect(conn.lastSeq).toBe(41)
        controller.close()
    })

    it('persists seq on welcome and on op', async () => {
        const doc = sprite16()
        const store = memorySeqStore()
        const conn = new FakeConnection()
        const controller = new RoomController({
            url: 'ws://x/wire',
            room: 'abc',
            profile: { nickname: 'ada', color: 1 },
            connection: conn,
            seqStore: store,
        })
        const pending = controller.connect()
        conn.onFrame({
            type: 'welcome',
            site: 1,
            seq: 7,
            lamport: 0,
            peers: [],
            snapshot: snapshotBytes(doc),
        })
        await pending
        expect(store.saved).toContainEqual({ room: 'abc', seq: 7 })
        const session = controller.session!
        const layer = session.doc.layers[0]!.id
        const frame = session.doc.frames[0]!.id
        conn.onFrame({
            type: 'op',
            seq: 9,
            stamp: (5 << 8) | 2,
            body: encodeOperation({
                kind: 'pixel.patch',
                layer,
                frame,
                xs: Uint16Array.of(4),
                ys: Uint16Array.of(5),
                colors: Uint32Array.of(0x0000ffff),
            }),
        })
        expect(store.saved).toContainEqual({ room: 'abc', seq: 9 })
        controller.close()
    })

    function memoryPendingStore(initial: { stamp: number; body: Uint8Array }[] = []): PendingStore {
        let kept = [...initial]
        return {
            load: (): { stamp: number; body: Uint8Array }[] => [...kept],
            save: (_room: string, ops: readonly { stamp: number; body: Uint8Array }[]): void => {
                kept = [...ops]
            },
        }
    }

    function paintOne(session: DocumentSession): void {
        const layer = session.doc.layers[0]!.id
        const frame = session.doc.frames[0]!.id
        session.apply('paint', {
            kind: 'pixel.patch',
            layer,
            frame,
            xs: Uint16Array.of(2),
            ys: Uint16Array.of(3),
            colors: Uint32Array.of(0xff0000ff),
        })
    }

    it('replays persisted ops with their original stamps after a fresh join', async () => {
        const doc = sprite16()
        const store = memoryPendingStore()
        const connA = new FakeConnection()
        const first = new RoomController({
            url: 'ws://x/wire',
            room: 'abc',
            profile: { nickname: 'ada', color: 1 },
            connection: connA,
            pendingStore: store,
        })
        const pendingA = first.connect()
        connA.onFrame(welcomeFrame(doc, 1))
        await pendingA
        paintOne(first.session!)
        const sentA = opsOf(connA)
        expect(sentA).toHaveLength(1)
        const stamp = sentA[0]!.stamp
        expect(store.load('abc')).toHaveLength(1)
        first.close()

        const connB = new FakeConnection()
        const second = new RoomController({
            url: 'ws://x/wire',
            room: 'abc',
            profile: { nickname: 'ada', color: 1 },
            connection: connB,
            pendingStore: store,
        })
        const pendingB = second.connect()
        connB.onFrame(welcomeFrame(doc, 2))
        await pendingB
        const sentB = opsOf(connB)
        expect(sentB).toHaveLength(1)
        expect(sentB[0]!.stamp).toBe(stamp)
        expect(sentB[0]!.body).toEqual(sentA[0]!.body)
        second.close()
    })

    it('forgets persisted ops once the relay echoes them', async () => {
        const doc = sprite16()
        const store = memoryPendingStore()
        const conn = new FakeConnection()
        const controller = new RoomController({
            url: 'ws://x/wire',
            room: 'abc',
            profile: { nickname: 'ada', color: 1 },
            connection: conn,
            pendingStore: store,
        })
        const pending = controller.connect()
        conn.onFrame(welcomeFrame(doc, 1))
        await pending
        paintOne(controller.session!)
        const sent = opsOf(conn)
        expect(sent).toHaveLength(1)
        expect(store.load('abc')).toHaveLength(1)
        conn.onFrame({ type: 'op', seq: 3, stamp: sent[0]!.stamp, body: sent[0]!.body })
        expect(store.load('abc')).toHaveLength(0)
        controller.close()
    })
})

describe('createRoom', () => {
    const init = { title: 'atelier', width: 16, height: 16 }

    it('POSTs JSON to ${apiBase}/api/rooms and returns the id', async () => {
        const calls: { url: string; body: string }[] = []
        const fetchImpl = ((url: string, request: { body: string }) => {
            calls.push({ url, body: request.body })
            return Promise.resolve({
                ok: true,
                status: 201,
                json: (): Promise<unknown> => Promise.resolve({ id: 'room1' }),
            })
        }) as unknown as typeof fetch

        const result = await createRoom('https://relay.example', init, fetchImpl)
        expect(result).toEqual({ id: 'room1' })
        expect(calls[0]!.url).toBe('https://relay.example/api/rooms')
        expect(JSON.parse(calls[0]!.body)).toEqual(init)
    })

    it('maps 429 to a too-many-rooms error', async () => {
        const fetchImpl = (() =>
            Promise.resolve({
                ok: false,
                status: 429,
                json: (): Promise<unknown> => Promise.resolve({ error: 'too_many_rooms' }),
            })) as unknown as typeof fetch
        await expect(createRoom('https://relay.example', init, fetchImpl)).rejects.toThrow(
            /too many rooms/,
        )
    })

    it('maps 400 + document_too_large to a canvas-too-large error', async () => {
        const fetchImpl = (() =>
            Promise.resolve({
                ok: false,
                status: 400,
                json: (): Promise<unknown> => Promise.resolve({ error: 'document_too_large' }),
            })) as unknown as typeof fetch
        await expect(createRoom('https://relay.example', init, fetchImpl)).rejects.toThrow(
            /canvas too large/,
        )
    })

    it('rethrows a network rejection as-is', async () => {
        const failure = new Error('network down')
        const fetchImpl = ((): Promise<never> => Promise.reject(failure)) as unknown as typeof fetch
        await expect(createRoom('https://relay.example', init, fetchImpl)).rejects.toBe(failure)
    })
})
