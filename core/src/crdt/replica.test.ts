import { describe, expect, it } from 'vitest'
import {
    applyOperation,
    createFrame,
    createLayer,
    createSprite,
    documentFingerprint,
    getPixel,
    OperationError,
    type DocumentOperation,
    type PixelPatchOperation,
    type Sprite,
} from '..'
import { GeometryLockedError, Replica, type ReplicaMessage } from './replica'
import { packStamp } from './stamp'

function sprite(): Sprite {
    const doc = createSprite({ width: 16, height: 16, id: 'sprite-1', title: 'Ship' })
    doc.layers[0]!.id = 'layer-1'
    doc.frames[0]!.id = 'frame-1'
    doc.meta.createdAt = '2026-09-01T00:00:00.000Z'
    doc.meta.updatedAt = '2026-09-01T00:00:00.000Z'
    return doc
}

function patch(cells: readonly [x: number, y: number, color: number][]): PixelPatchOperation {
    return {
        kind: 'pixel.patch',
        layer: 'layer-1',
        frame: 'frame-1',
        xs: Uint16Array.from(cells.map(([x]) => x)),
        ys: Uint16Array.from(cells.map(([, y]) => y)),
        colors: Uint32Array.from(cells.map(([, , color]) => color)),
    }
}

function accept(doc: Sprite, result: { readonly operations: readonly DocumentOperation[] }): void {
    for (const operation of result.operations) applyOperation(doc, operation)
}

function acceptAll(
    doc: Sprite,
    result: { readonly operations: readonly DocumentOperation[] },
): void {
    accept(doc, result)
}

function structuralMessage(
    stamp: number,
    operation: Exclude<DocumentOperation, { readonly kind: 'pixel.patch' }>,
    orderKey: number,
): ReplicaMessage {
    return { type: 'operation', stamp, operation, orderKey }
}

function messageOperation(message: ReplicaMessage | null): DocumentOperation | undefined {
    return message?.type === 'operation' ? message.operation : undefined
}

describe('Replica', () => {
    it('publishes local pixels and converges after remote delivery without duplicating', () => {
        const local = sprite()
        const remote = sprite()
        const sent = new Replica(local, 1).publish(patch([[2, 3, 0xff0000ff]]))

        expect(sent.message?.stamp).toBe(packStamp(1, 1))
        expect(sent.operation).toMatchObject({
            kind: 'pixel.patch',
            layer: 'layer-1',
            frame: 'frame-1',
        })
        accept(local, sent)

        const receiver = new Replica(remote, 2)
        accept(remote, receiver.receive(sent.message!))
        expect(getPixel(remote, 'layer-1', 'frame-1', 2, 3)).toBe(0xff0000ff)
        expect(receiver.receive(sent.message!)).toEqual({
            message: null,
            operation: null,
            operations: [],
        })
        expect(documentFingerprint(remote)).toBe(documentFingerprint(local))
    })

    it('converges overlapping and independent pixels under reversed delivery', () => {
        const left = sprite()
        const right = sprite()
        const red = new Replica(sprite(), 1).publish(
            patch([
                [1, 1, 0xff0000ff],
                [2, 1, 0xff0000ff],
            ]),
        )
        const blue = new Replica(sprite(), 2).publish(
            patch([
                [1, 1, 0x0000ffff],
                [3, 1, 0x0000ffff],
            ]),
        )

        const leftReplica = new Replica(left, 3)
        accept(left, leftReplica.receive(red.message!))
        accept(left, leftReplica.receive(blue.message!))
        const rightReplica = new Replica(right, 4)
        accept(right, rightReplica.receive(blue.message!))
        accept(right, rightReplica.receive(red.message!))

        expect(getPixel(left, 'layer-1', 'frame-1', 1, 1)).toBe(0x0000ffff)
        expect(getPixel(left, 'layer-1', 'frame-1', 2, 1)).toBe(0xff0000ff)
        expect(getPixel(left, 'layer-1', 'frame-1', 3, 1)).toBe(0x0000ffff)
        expect(documentFingerprint(right)).toBe(documentFingerprint(left))
    })

    it('discards stale and equal pixel stamps per coordinate', () => {
        const doc = sprite()
        const replica = new Replica(doc, 3)
        const newer: ReplicaMessage = {
            type: 'operation',
            stamp: packStamp(2, 1),
            operation: patch([[1, 1, 0x111111ff]]),
        }
        const older: ReplicaMessage = {
            type: 'operation',
            stamp: packStamp(1, 255),
            operation: patch([
                [1, 1, 0x222222ff],
                [2, 1, 0x333333ff],
            ]),
        }

        accept(doc, replica.receive(newer))
        expect(replica.receive(newer)).toEqual({ message: null, operation: null, operations: [] })
        const accepted = replica.receive(older)
        expect(accepted.operation).toMatchObject({ kind: 'pixel.patch' })
        accept(doc, accepted)
        expect(getPixel(doc, 'layer-1', 'frame-1', 1, 1)).toBe(0x111111ff)
        expect(getPixel(doc, 'layer-1', 'frame-1', 2, 1)).toBe(0x333333ff)
    })

    it('returns null for duplicate title and frame duration messages', () => {
        const doc = sprite()
        const replica = new Replica(doc, 2)
        const title: ReplicaMessage = {
            type: 'operation',
            stamp: packStamp(1, 1),
            operation: { kind: 'document.rename', title: 'Remote title' },
        }
        const duration: ReplicaMessage = {
            type: 'operation',
            stamp: packStamp(2, 1),
            operation: { kind: 'frame.setDuration', frame: 'frame-1', duration: 120 },
        }

        accept(doc, replica.receive(title))
        accept(doc, replica.receive(duration))

        expect(replica.receive(title)).toEqual({ message: null, operation: null, operations: [] })
        expect(replica.receive(duration)).toEqual({
            message: null,
            operation: null,
            operations: [],
        })
    })

    it('copies default local pixel patches before exposing and recording them', () => {
        const doc = sprite()
        const xs = new Uint16Array([1])
        const ys = new Uint16Array([1])
        const colors = new Uint32Array([0xff0000ff])
        const replica = new Replica(doc, 1)
        const result = replica.publish({
            kind: 'pixel.patch',
            layer: 'layer-1',
            frame: 'frame-1',
            xs,
            ys,
            colors,
        })

        xs[0] = 2
        ys[0] = 2
        colors[0] = 0x0000ffff

        expect(result.operation).toEqual(patch([[1, 1, 0xff0000ff]]))
        expect(messageOperation(result.message)).toEqual(patch([[1, 1, 0xff0000ff]]))
        expect(replica.receive(result.message!)).toEqual({
            message: null,
            operation: null,
            operations: [],
        })
    })

    it('does not advance the clock for malformed remote input', () => {
        const doc = sprite()
        const replica = new Replica(doc, 7)
        const malformed: ReplicaMessage = {
            type: 'operation',
            stamp: packStamp(100, 1),
            operation: {
                kind: 'pixel.patch',
                layer: 'layer-1',
                frame: 'frame-1',
                xs: new Uint16Array([1]),
                ys: new Uint16Array(),
                colors: new Uint32Array([0xff0000ff]),
            },
        }

        expect(() => replica.receive(malformed)).toThrow(OperationError)
        expect(
            replica.publish({ kind: 'document.rename', title: 'Local title' }).message?.stamp,
        ).toBe(packStamp(1, 7))
    })

    it('observes valid duplicate messages before the next local publication', () => {
        const doc = sprite()
        const replica = new Replica(doc, 7)
        const remote: ReplicaMessage = {
            type: 'operation',
            stamp: packStamp(10, 1),
            operation: { kind: 'document.rename', title: 'Remote title' },
        }

        accept(doc, replica.receive(remote))
        expect(replica.receive(remote)).toEqual({ message: null, operation: null, operations: [] })
        expect(
            replica.publish({ kind: 'document.rename', title: 'Local title' }).message?.stamp,
        ).toBe(packStamp(11, 7))
    })

    it('rejects invalid remote stamps before they affect replica state', () => {
        const doc = sprite()
        const replica = new Replica(doc, 2)
        for (const stamp of [-1, 0, 1.5]) {
            const message: ReplicaMessage = {
                type: 'operation',
                stamp,
                operation: { kind: 'document.rename', title: 'Remote title' },
            }
            expect(() => replica.receive(message)).toThrow(RangeError)
        }

        expect(
            replica.publish({ kind: 'document.rename', title: 'Local title' }).message?.stamp,
        ).toBe(packStamp(1, 2))
    })

    it('converges scalar and palette registers under reversed delivery', () => {
        const low = sprite()
        const high = sprite()
        const lowReplica = new Replica(low, 3)
        const highReplica = new Replica(high, 4)
        const paletteAdd = new Replica(sprite(), 1).publish({
            kind: 'palette.add',
            color: '#111111',
            index: 0,
        })
        const older: ReplicaMessage[] = [
            {
                type: 'operation',
                stamp: packStamp(1, 1),
                operation: { kind: 'layer.set', layer: 'layer-1', prop: 'opacity', value: 10 },
            },
            {
                type: 'operation',
                stamp: packStamp(2, 1),
                operation: { kind: 'frame.setDuration', frame: 'frame-1', duration: 120 },
            },
            {
                type: 'operation',
                stamp: packStamp(3, 1),
                operation: { kind: 'document.rename', title: 'Old title' },
            },
            paletteAdd.message!,
        ]
        const newer: ReplicaMessage[] = [
            {
                type: 'operation',
                stamp: packStamp(5, 2),
                operation: { kind: 'layer.set', layer: 'layer-1', prop: 'opacity', value: 20 },
            },
            {
                type: 'operation',
                stamp: packStamp(6, 2),
                operation: { kind: 'frame.setDuration', frame: 'frame-1', duration: 140 },
            },
            {
                type: 'operation',
                stamp: packStamp(7, 2),
                operation: { kind: 'document.rename', title: 'New title' },
            },
            {
                type: 'operation',
                stamp: packStamp(8, 2),
                operation: { kind: 'palette.replace', name: 'New', colors: ['#222222'] },
            },
        ]

        for (const message of [...older, ...newer]) accept(low, lowReplica.receive(message))
        for (const message of [...newer, ...older]) accept(high, highReplica.receive(message))

        expect(low.layers[0]!.opacity).toBe(20)
        expect(low.frames[0]!.duration).toBe(140)
        expect(low.meta.title).toBe('New title')
        expect(low.palette).toEqual({ name: 'New', colors: ['#222222'] })
        expect(messageOperation(paletteAdd.message)?.kind).toBe('palette.replace')
        expect(documentFingerprint(high)).toBe(documentFingerprint(low))
    })

    it('canonicalizes palette additions to a whole palette replacement', () => {
        const doc = sprite()
        const result = new Replica(doc, 1).publish({
            kind: 'palette.add',
            color: '#123456',
            index: 1,
        })

        expect(messageOperation(result.message)).toEqual({
            kind: 'palette.replace',
            name: 'Starforge',
            colors: [
                '#0b0b12',
                '#123456',
                '#161626',
                '#241b3d',
                '#3b2160',
                '#7b2fbf',
                '#c33bd4',
                '#ff4fd8',
                '#ff8fab',
                '#ebb7ff',
                '#26c9ff',
                '#6ee7ff',
                '#b6f6ff',
                '#ffd166',
                '#ffe564',
                '#fff3b0',
                '#ffffff',
                '#8892b0',
            ],
        })
        expect(result.operation).toEqual(messageOperation(result.message))
        expect(doc.palette.colors).not.toContain('#123456')
    })

    it('publishes an already applied palette as a canonical replacement without another operation', () => {
        const doc = sprite()
        applyOperation(doc, { kind: 'palette.add', color: '#123456', index: 1 })

        const result = new Replica(doc, 1).publish(
            { kind: 'palette.add', color: '#123456', index: 1 },
            { alreadyApplied: true },
        )

        expect(result.operation).toBeNull()
        expect(messageOperation(result.message)).toEqual({
            kind: 'palette.replace',
            name: 'Starforge',
            colors: [
                '#0b0b12',
                '#123456',
                '#161626',
                '#241b3d',
                '#3b2160',
                '#7b2fbf',
                '#c33bd4',
                '#ff4fd8',
                '#ff8fab',
                '#ebb7ff',
                '#26c9ff',
                '#6ee7ff',
                '#b6f6ff',
                '#ffd166',
                '#ffe564',
                '#fff3b0',
                '#ffffff',
                '#8892b0',
            ],
        })
    })

    it('rejects geometry operations without document mutation', () => {
        const doc = sprite()
        const replica = new Replica(doc, 1)
        const before = documentFingerprint(doc)

        for (const operation of [
            { kind: 'document.resize', width: 32, height: 32, offsetX: 0, offsetY: 0 },
            { kind: 'document.scale', width: 32, height: 32 },
            { kind: 'document.restore', width: 16, height: 16, cels: [] },
        ] as const) {
            expect(() => replica.publish(operation)).toThrow(GeometryLockedError)
            expect(documentFingerprint(doc)).toBe(before)
        }
    })

    it('does not retain metadata for a malformed remote patch that can later be corrected', () => {
        const doc = sprite()
        const replica = new Replica(doc, 2)
        const malformed = {
            type: 'operation' as const,
            stamp: packStamp(1, 1),
            operation: {
                kind: 'pixel.patch',
                layer: 'layer-1',
                frame: 'frame-1',
                xs: new Uint16Array([1]),
                ys: new Uint16Array(),
                colors: new Uint32Array([0xaabbccff]),
            },
        } as ReplicaMessage

        expect(() => replica.receive(malformed)).toThrow()
        const corrected: ReplicaMessage = {
            type: 'operation',
            stamp: packStamp(1, 1),
            operation: patch([[1, 1, 0xaabbccff]]),
        }
        const result = replica.receive(corrected)
        expect(result.operation).toMatchObject({ kind: 'pixel.patch' })
        accept(doc, result)
        expect(getPixel(doc, 'layer-1', 'frame-1', 1, 1)).toBe(0xaabbccff)
    })

    it('uses clone validation for unknown remote operations before touching registers', () => {
        const doc = sprite()
        const replica = new Replica(doc, 2)
        const malformed: ReplicaMessage = {
            type: 'operation',
            stamp: packStamp(2, 1),
            operation: { kind: 'not.an.operation' } as unknown as DocumentOperation,
        }

        expect(() => replica.receive(malformed)).toThrow(OperationError)
        const corrected: ReplicaMessage = {
            ...malformed,
            operation: { kind: 'document.rename', title: 'Recovered title' },
        }
        expect(replica.receive(corrected).operation).toEqual(corrected.operation)
    })

    it('converges layer add/remove in either delivery order and resurrects its painted payload', () => {
        const layer = createLayer('Engine', 'layer-engine')
        const add = structuralMessage(
            packStamp(1, 1),
            { kind: 'layer.add', layer, after: 'layer-1' },
            1,
        )
        const paint: ReplicaMessage = {
            type: 'operation',
            stamp: packStamp(2, 1),
            operation: { ...patch([[4, 4, 0xff0000ff]]), layer: 'layer-engine' },
        }
        const remove = structuralMessage(
            packStamp(3, 1),
            { kind: 'layer.remove', layer: 'layer-engine' },
            1,
        )
        const resurrect = structuralMessage(
            packStamp(4, 1),
            { kind: 'layer.add', layer, after: null },
            -1,
        )
        const first = sprite()
        const second = sprite()
        const firstReplica = new Replica(first, 2)
        const secondReplica = new Replica(second, 3)

        for (const message of [add, paint, remove, resurrect])
            acceptAll(first, firstReplica.receive(message))
        for (const message of [remove, add, paint, resurrect])
            acceptAll(second, secondReplica.receive(message))

        expect(first.layers.map(({ id }) => id)).toEqual(['layer-engine', 'layer-1'])
        expect(getPixel(first, 'layer-engine', 'frame-1', 4, 4)).toBe(0xff0000ff)
        expect(documentFingerprint(second)).toBe(documentFingerprint(first))
    })

    it('converges frame add/remove in either delivery order and resurrects its retained payload', () => {
        const frame = createFrame(100, 'frame-engine')
        const add = structuralMessage(
            packStamp(1, 1),
            { kind: 'frame.add', frame, after: 'frame-1' },
            1,
        )
        const remove = structuralMessage(
            packStamp(2, 1),
            { kind: 'frame.remove', frame: 'frame-engine' },
            1,
        )
        const resurrect = structuralMessage(
            packStamp(3, 1),
            { kind: 'frame.add', frame, after: null },
            -1,
        )
        const first = sprite()
        const second = sprite()
        const firstReplica = new Replica(first, 2)
        const secondReplica = new Replica(second, 3)

        for (const message of [add, remove, resurrect])
            acceptAll(first, firstReplica.receive(message))
        for (const message of [remove, add, resurrect])
            acceptAll(second, secondReplica.receive(message))

        expect(first.frames.map(({ id }) => id)).toEqual(['frame-engine', 'frame-1'])
        expect(documentFingerprint(second)).toBe(documentFingerprint(first))
    })

    it('defers the final layer and frame removals until an addition makes each invariant valid', () => {
        const doc = sprite()
        const replica = new Replica(doc, 2)
        acceptAll(
            doc,
            replica.receive(
                structuralMessage(packStamp(1, 1), { kind: 'layer.remove', layer: 'layer-1' }, 0),
            ),
        )
        acceptAll(
            doc,
            replica.receive(
                structuralMessage(packStamp(2, 1), { kind: 'frame.remove', frame: 'frame-1' }, 0),
            ),
        )
        const layers = replica.receive(
            structuralMessage(
                packStamp(3, 1),
                { kind: 'layer.add', layer: createLayer('Replacement', 'layer-2'), after: null },
                1,
            ),
        )
        const frames = replica.receive(
            structuralMessage(
                packStamp(4, 1),
                { kind: 'frame.add', frame: createFrame(100, 'frame-2'), after: null },
                1,
            ),
        )

        expect(layers.operations.map(({ kind }) => kind)).toEqual(['layer.add', 'layer.remove'])
        acceptAll(doc, layers)
        expect(frames.operations.map(({ kind }) => kind)).toEqual(['frame.add', 'frame.remove'])
        acceptAll(doc, frames)
        expect(doc.layers.map(({ id }) => id)).toEqual(['layer-2'])
        expect(doc.frames.map(({ id }) => id)).toEqual(['frame-2'])
    })

    it('discards a pixel write to dead structure before retaining cel metadata', () => {
        const doc = sprite()
        const replica = new Replica(doc, 2)
        const layer = createLayer('Engine', 'layer-engine')
        acceptAll(
            doc,
            replica.receive(
                structuralMessage(packStamp(1, 1), { kind: 'layer.add', layer, after: null }, 0),
            ),
        )
        acceptAll(
            doc,
            replica.receive(
                structuralMessage(
                    packStamp(2, 1),
                    { kind: 'layer.remove', layer: 'layer-engine' },
                    0,
                ),
            ),
        )
        expect(
            replica.receive({
                type: 'operation',
                stamp: packStamp(3, 1),
                operation: { ...patch([[6, 6, 0xff00ffff]]), layer: 'layer-engine' },
            }),
        ).toMatchObject({ operations: [] })
        acceptAll(
            doc,
            replica.receive(
                structuralMessage(packStamp(4, 1), { kind: 'layer.add', layer, after: null }, 0),
            ),
        )
        expect(getPixel(doc, 'layer-engine', 'frame-1', 6, 6)).toBe(0)
    })

    it('converges concurrent layer and frame moves at equal keys by id under reversed delivery', () => {
        const prepare = (): Sprite => {
            const doc = sprite()
            applyOperation(doc, {
                kind: 'layer.add',
                layer: createLayer('A', 'layer-a'),
                after: 'layer-1',
            })
            applyOperation(doc, {
                kind: 'layer.add',
                layer: createLayer('B', 'layer-b'),
                after: 'layer-a',
            })
            applyOperation(doc, {
                kind: 'frame.add',
                frame: createFrame(100, 'frame-a'),
                after: 'frame-1',
            })
            applyOperation(doc, {
                kind: 'frame.add',
                frame: createFrame(100, 'frame-b'),
                after: 'frame-a',
            })
            return doc
        }
        const layerA = structuralMessage(
            packStamp(1, 1),
            { kind: 'layer.move', layer: 'layer-a', after: 'layer-b' },
            10,
        )
        const layerB = structuralMessage(
            packStamp(1, 2),
            { kind: 'layer.move', layer: 'layer-b', after: null },
            10,
        )
        const frameA = structuralMessage(
            packStamp(2, 1),
            { kind: 'frame.move', frame: 'frame-a', after: 'frame-b' },
            10,
        )
        const frameB = structuralMessage(
            packStamp(2, 2),
            { kind: 'frame.move', frame: 'frame-b', after: null },
            10,
        )
        const left = prepare()
        const right = prepare()
        const leftReplica = new Replica(left, 3)
        const rightReplica = new Replica(right, 4)

        for (const message of [layerA, layerB, frameA, frameB])
            acceptAll(left, leftReplica.receive(message))
        for (const message of [frameB, frameA, layerB, layerA])
            acceptAll(right, rightReplica.receive(message))
        expect(left.layers.map(({ id }) => id)).toEqual(['layer-1', 'layer-a', 'layer-b'])
        expect(left.frames.map(({ id }) => id)).toEqual(['frame-1', 'frame-a', 'frame-b'])
        expect(documentFingerprint(right)).toBe(documentFingerprint(left))
    })

    it('orders remote structure by its transmitted key rather than an inconsistent after pointer', () => {
        const doc = sprite()
        applyOperation(doc, {
            kind: 'layer.add',
            layer: createLayer('A', 'layer-a'),
            after: 'layer-1',
        })
        const replica = new Replica(doc, 2)
        const result = replica.receive(
            structuralMessage(
                packStamp(1, 1),
                { kind: 'layer.move', layer: 'layer-a', after: 'layer-1' },
                -1,
            ),
        )
        acceptAll(doc, result)
        expect(doc.layers.map(({ id }) => id)).toEqual(['layer-a', 'layer-1'])
    })

    it('rebalance publication resolves exhausted midpoint keys and stale tables lose', () => {
        const doc = sprite()
        applyOperation(doc, { kind: 'layer.add', layer: createLayer('A', 'layer-a'), after: null })
        const replica = new Replica(doc, 1)
        const left = structuralMessage(
            packStamp(1, 2),
            { kind: 'layer.move', layer: 'layer-a', after: null },
            0,
        )
        const right = structuralMessage(
            packStamp(2, 2),
            { kind: 'layer.move', layer: 'layer-1', after: 'layer-a' },
            Number.MIN_VALUE,
        )
        acceptAll(doc, replica.receive(left))
        acceptAll(doc, replica.receive(right))
        const rebalance = replica.publish({
            kind: 'layer.add',
            layer: createLayer('B', 'layer-b'),
            after: 'layer-a',
        })

        expect(rebalance.message).toMatchObject({
            type: 'order.rebalance',
            target: 'layer',
            keys: [
                ['layer-a', 0],
                ['layer-1', 1],
            ],
        })
        const remote = sprite()
        applyOperation(remote, {
            kind: 'layer.add',
            layer: createLayer('A', 'layer-a'),
            after: null,
        })
        const receiver = new Replica(remote, 2)
        acceptAll(remote, receiver.receive(left))
        acceptAll(remote, receiver.receive(right))
        acceptAll(remote, receiver.receive(rebalance.message!))
        expect(remote.layers.map(({ id }) => id)).toEqual(['layer-a', 'layer-1'])
        expect(receiver.receive({ ...rebalance.message!, stamp: packStamp(1, 1) })).toMatchObject({
            operations: [],
        })
    })

    it('uses one move when preserving the longest in-order subsequence', () => {
        const doc = sprite()
        doc.layers[0]!.id = 'layer-c'
        applyOperation(doc, {
            kind: 'layer.add',
            layer: createLayer('A', 'layer-a'),
            after: 'layer-c',
        })
        applyOperation(doc, {
            kind: 'layer.add',
            layer: createLayer('B', 'layer-b'),
            after: 'layer-a',
        })
        const replica = new Replica(doc, 2)
        const moved = replica.receive(
            structuralMessage(
                packStamp(1, 1),
                { kind: 'layer.move', layer: 'layer-c', after: 'layer-b' },
                3,
            ),
        )

        expect(moved.operations).toEqual([
            { kind: 'layer.move', layer: 'layer-c', after: 'layer-b' },
        ])
        accept(doc, moved)
        expect(doc.layers.map(({ id }) => id)).toEqual(['layer-a', 'layer-b', 'layer-c'])
    })

    it('emits two applicable moves for a cyclic four-layer rebalance', () => {
        const doc = sprite()
        applyOperation(doc, {
            kind: 'layer.add',
            layer: createLayer('B', 'layer-b'),
            after: 'layer-1',
        })
        applyOperation(doc, {
            kind: 'layer.add',
            layer: createLayer('C', 'layer-c'),
            after: 'layer-b',
        })
        applyOperation(doc, {
            kind: 'layer.add',
            layer: createLayer('D', 'layer-d'),
            after: 'layer-c',
        })
        const replica = new Replica(doc, 2)
        const rebalance: ReplicaMessage = {
            type: 'order.rebalance',
            stamp: packStamp(1, 1),
            target: 'layer',
            keys: [
                ['layer-c', 0],
                ['layer-d', 1],
                ['layer-1', 2],
                ['layer-b', 3],
            ],
        }

        const received = replica.receive(rebalance)
        expect(received.operations).toEqual([
            { kind: 'layer.move', layer: 'layer-1', after: 'layer-d' },
            { kind: 'layer.move', layer: 'layer-b', after: 'layer-1' },
        ])
        accept(doc, received)
        expect(doc.layers.map(({ id }) => id)).toEqual(['layer-c', 'layer-d', 'layer-1', 'layer-b'])
    })

    it('does not record an invalid structural add before a same-stamp correction', () => {
        const doc = sprite()
        const replica = new Replica(doc, 2)
        const stamp = packStamp(1, 1)

        expect(() =>
            replica.receive(
                structuralMessage(
                    stamp,
                    { kind: 'frame.add', frame: createFrame(0, 'frame-2'), after: null },
                    0,
                ),
            ),
        ).toThrow(OperationError)
        const corrected = replica.receive(
            structuralMessage(
                stamp,
                { kind: 'frame.add', frame: createFrame(100, 'frame-2'), after: null },
                0,
            ),
        )
        expect(corrected.operations).toHaveLength(1)
        const [operation] = corrected.operations
        expect(operation?.kind).toBe('frame.add')
        if (operation?.kind !== 'frame.add') throw new Error('expected a frame.add operation')
        expect(operation.frame.id).toBe('frame-2')
        expect(operation.frame.duration).toBe(100)
        expect(operation.after).toBe('frame-1')
    })

    it('defers a move received before its added id and applies it when the add arrives', () => {
        const doc = sprite()
        const replica = new Replica(doc, 2)
        const move = structuralMessage(
            packStamp(2, 1),
            { kind: 'layer.move', layer: 'layer-2', after: null },
            -1,
        )
        const add = structuralMessage(
            packStamp(1, 1),
            { kind: 'layer.add', layer: createLayer('Later', 'layer-2'), after: 'layer-1' },
            1,
        )

        expect(replica.receive(move).operations).toEqual([])
        const admitted = replica.receive(add)
        accept(doc, admitted)
        expect(doc.layers.map(({ id }) => id)).toEqual(['layer-2', 'layer-1'])
    })

    it('converges a rebalance and move under reverse delivery', () => {
        const prepare = (): Sprite => {
            const doc = sprite()
            applyOperation(doc, {
                kind: 'layer.add',
                layer: createLayer('A', 'layer-a'),
                after: 'layer-1',
            })
            return doc
        }
        const move = structuralMessage(
            packStamp(10, 1),
            { kind: 'layer.move', layer: 'layer-a', after: null },
            -1,
        )
        const rebalance: ReplicaMessage = {
            type: 'order.rebalance',
            stamp: packStamp(4, 1),
            target: 'layer',
            keys: [
                ['layer-a', 1],
                ['layer-1', 0],
            ],
        }
        const left = prepare(),
            right = prepare()
        const leftReplica = new Replica(left, 2),
            rightReplica = new Replica(right, 3)

        for (const message of [move, rebalance]) accept(left, leftReplica.receive(message))
        for (const message of [rebalance, move]) accept(right, rightReplica.receive(message))
        expect(documentFingerprint(right)).toBe(documentFingerprint(left))
    })

    it('rejects an invalid rebalance target without blocking a corrected same-stamp table', () => {
        const doc = sprite()
        const replica = new Replica(doc, 2)
        const stamp = packStamp(1, 1)
        const invalid = {
            type: 'order.rebalance',
            stamp,
            target: 'invalid',
            keys: [['frame-1', 0]],
        } as unknown as ReplicaMessage

        expect(() => replica.receive(invalid)).toThrow(RangeError)
        expect(
            replica.receive({
                type: 'order.rebalance',
                stamp,
                target: 'frame',
                keys: [['frame-1', 0]],
            }).operations,
        ).toEqual([])
    })

    it('rejects incomplete rebalance tables without installing a move barrier', () => {
        const doc = sprite()
        applyOperation(doc, {
            kind: 'layer.add',
            layer: createLayer('B', 'layer-b'),
            after: 'layer-1',
        })
        const replica = new Replica(doc, 2)
        const stamp = packStamp(10, 1)

        expect(() =>
            replica.receive({ type: 'order.rebalance', stamp, target: 'layer', keys: [] }),
        ).toThrow(RangeError)
        const move = replica.receive(
            structuralMessage(
                packStamp(5, 1),
                { kind: 'layer.move', layer: 'layer-b', after: null },
                -1,
            ),
        )
        expect(move.operations).toEqual([
            { kind: 'layer.move', layer: 'layer-1', after: 'layer-b' },
        ])
        expect(
            replica.receive({
                type: 'order.rebalance',
                stamp,
                target: 'layer',
                keys: [
                    ['layer-b', 0],
                    ['layer-1', 1],
                ],
            }).operations,
        ).toEqual([{ kind: 'layer.move', layer: 'layer-1', after: 'layer-b' }])
    })

    it('rejects partial and non-consecutive rebalance tables before metadata mutation', () => {
        const doc = sprite()
        applyOperation(doc, {
            kind: 'layer.add',
            layer: createLayer('B', 'layer-b'),
            after: 'layer-1',
        })
        const replica = new Replica(doc, 2)

        expect(() =>
            replica.receive({
                type: 'order.rebalance',
                stamp: packStamp(1, 1),
                target: 'layer',
                keys: [['layer-1', 0]],
            }),
        ).toThrow(RangeError)
        expect(() =>
            replica.receive({
                type: 'order.rebalance',
                stamp: packStamp(2, 1),
                target: 'layer',
                keys: [
                    ['layer-1', 0],
                    ['layer-b', 2],
                ],
            }),
        ).toThrow(RangeError)
        expect(
            replica.receive({
                type: 'order.rebalance',
                stamp: packStamp(2, 1),
                target: 'layer',
                keys: [
                    ['layer-b', 0],
                    ['layer-1', 1],
                ],
            }).operations,
        ).toEqual([{ kind: 'layer.move', layer: 'layer-1', after: 'layer-b' }])
    })

    it('releases frame duration and layer property writes delivered before their retained adds', () => {
        const doc = sprite()
        const replica = new Replica(doc, 2)
        const duration: ReplicaMessage = {
            type: 'operation',
            stamp: packStamp(2, 1),
            operation: { kind: 'frame.setDuration', frame: 'frame-2', duration: 240 },
        }
        const opacity: ReplicaMessage = {
            type: 'operation',
            stamp: packStamp(4, 1),
            operation: { kind: 'layer.set', layer: 'layer-2', prop: 'opacity', value: 90 },
        }
        const frameAdd = structuralMessage(
            packStamp(1, 1),
            { kind: 'frame.add', frame: createFrame(100, 'frame-2'), after: 'frame-1' },
            1,
        )
        const layerAdd = structuralMessage(
            packStamp(3, 1),
            { kind: 'layer.add', layer: createLayer('Later', 'layer-2'), after: 'layer-1' },
            1,
        )

        expect(replica.receive(duration).operations).toEqual([])
        expect(replica.receive(opacity).operations).toEqual([])
        const frameResult = replica.receive(frameAdd)
        expect(frameResult.operations.map(({ kind }) => kind)).toEqual([
            'frame.add',
            'frame.setDuration',
        ])
        accept(doc, frameResult)
        const layerResult = replica.receive(layerAdd)
        expect(layerResult.operations.map(({ kind }) => kind)).toEqual(['layer.add', 'layer.set'])
        accept(doc, layerResult)
        expect(doc.frames.find(({ id }) => id === 'frame-2')?.duration).toBe(240)
        expect(doc.layers.find(({ id }) => id === 'layer-2')?.opacity).toBe(90)
    })

    it('does not let a malformed deferred duration poison its same-stamp correction', () => {
        const doc = sprite()
        const replica = new Replica(doc, 2)
        const stamp = packStamp(2, 1)
        const invalid: ReplicaMessage = {
            type: 'operation',
            stamp,
            operation: { kind: 'frame.setDuration', frame: 'frame-2', duration: 0 },
        }
        const add = structuralMessage(
            packStamp(1, 1),
            { kind: 'frame.add', frame: createFrame(100, 'frame-2'), after: 'frame-1' },
            1,
        )

        expect(replica.receive(invalid).operations).toEqual([])
        expect(() => replica.receive(add)).toThrow(OperationError)
        applyOperation(doc, {
            kind: 'frame.add',
            frame: createFrame(100, 'frame-2'),
            after: 'frame-1',
        })
        expect(
            replica.receive({
                type: 'operation',
                stamp,
                operation: { kind: 'frame.setDuration', frame: 'frame-2', duration: 180 },
            }).operations,
        ).toEqual([{ kind: 'frame.setDuration', frame: 'frame-2', duration: 180 }])
    })
})
