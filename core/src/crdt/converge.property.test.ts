import { describe, expect, it } from 'vitest'
import {
    applyOperation,
    createFrame,
    createLayer,
    createSprite,
    documentFingerprint,
    Replica,
    type DocumentOperation,
    type ReplicaMessage,
    type ReplicaResult,
    type Sprite,
} from '..'

interface Source {
    readonly doc: Sprite
    readonly replica: Replica
    readonly site: number
}
interface SentMessage {
    readonly source: number
    readonly message: ReplicaMessage
}
type OperationKind =
    | 'pixel'
    | 'layer.set'
    | 'frame.setDuration'
    | 'document.rename'
    | 'palette.replace'
    | 'layer.add'
    | 'layer.remove'
    | 'layer.move'
    | 'frame.add'
    | 'frame.remove'
    | 'frame.move'

const ALL_KINDS: readonly OperationKind[] = [
    'pixel',
    'layer.set',
    'frame.setDuration',
    'document.rename',
    'palette.replace',
    'layer.add',
    'frame.add',
    'layer.remove',
    'frame.remove',
    'layer.move',
    'frame.move',
]

class XorShift32 {
    private state: number

    constructor(seed: number) {
        this.state = seed >>> 0
    }

    next(): number {
        let value = this.state
        value ^= value << 13
        value ^= value >>> 17
        value ^= value << 5
        this.state = value >>> 0
        return this.state
    }

    int(limit: number): number {
        return this.next() % limit
    }

    shuffle<T>(values: readonly T[]): T[] {
        const shuffled = [...values]
        for (let index = shuffled.length - 1; index > 0; index--) {
            const swap = this.int(index + 1)
            ;[shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!]
        }
        return shuffled
    }
}

function sprite(): Sprite {
    const doc = createSprite({
        width: 16,
        height: 16,
        id: 'sprite-convergence',
        title: 'Convergence',
    })
    doc.layers[0]!.id = 'layer-1'
    doc.frames[0]!.id = 'frame-1'
    doc.meta.createdAt = '2026-09-01T00:00:00.000Z'
    doc.meta.updatedAt = '2026-09-01T00:00:00.000Z'
    return doc
}

function fixtureWithOrderingPeers(): Sprite {
    const doc = sprite()
    applyOperation(doc, { kind: 'layer.add', layer: createLayer('A', 'layer-a'), after: 'layer-1' })
    applyOperation(doc, { kind: 'layer.add', layer: createLayer('B', 'layer-b'), after: 'layer-a' })
    return doc
}

function applyResult(doc: Sprite, result: ReplicaResult): void {
    for (const operation of result.operations) applyOperation(doc, operation)
}

function publish(source: Source, operation: DocumentOperation, messages: SentMessage[]): void {
    const result = source.replica.publish(operation)
    applyResult(source.doc, result)
    if (result.message) messages.push({ source: source.site, message: result.message })
}

function color(random: XorShift32): string {
    return `#${(random.next() & 0xffffff).toString(16).padStart(6, '0')}`
}

function nonPredecessor(ids: readonly string[], id: string, random: XorShift32): string | null {
    const index = ids.indexOf(id)
    const predecessor = index === 0 ? null : ids[index - 1]!
    const choices: (string | null)[] = [null, ...ids.filter((candidate) => candidate !== id)]
    const valid = choices.filter((candidate) => candidate !== predecessor)
    return valid[random.int(valid.length)]!
}

function operationFor(
    kind: OperationKind,
    source: Source,
    random: XorShift32,
    round: number,
    ordinal: number,
): DocumentOperation {
    const layerIds = source.doc.layers.map(({ id }) => id)
    const frameIds = source.doc.frames.map(({ id }) => id)
    const id = `round-${round}-site-${source.site}-${ordinal}`

    switch (kind) {
        case 'pixel':
            return {
                kind: 'pixel.patch',
                layer: layerIds[random.int(layerIds.length)]!,
                frame: frameIds[random.int(frameIds.length)]!,
                xs: Uint16Array.of(random.int(16), random.int(16)),
                ys: Uint16Array.of(random.int(16), random.int(16)),
                colors: Uint32Array.of(random.next(), random.next()),
            }

        case 'layer.set':
            return {
                kind: 'layer.set',
                layer: layerIds[random.int(layerIds.length)]!,
                prop: 'opacity',
                value: random.int(256),
            }

        case 'frame.setDuration': {
            const frame = source.doc.frames[random.int(frameIds.length)]!
            const duration = frame.duration === 80 ? 81 : 80
            return { kind: 'frame.setDuration', frame: frame.id, duration }
        }

        case 'document.rename':
            return { kind: 'document.rename', title: `Round ${round} title ${ordinal}` }

        case 'palette.replace':
            return {
                kind: 'palette.replace',
                name: `Palette ${round} ${ordinal}`,
                colors: [color(random), color(random)],
            }

        case 'layer.add':
            return {
                kind: 'layer.add',
                layer: createLayer(`Layer ${id}`, `layer-${id}`),
                after: layerIds[random.int(layerIds.length + 1)] ?? null,
            }

        case 'layer.remove':
            return { kind: 'layer.remove', layer: layerIds[random.int(layerIds.length)]! }

        case 'layer.move': {
            const layer = layerIds[random.int(layerIds.length)]!
            return { kind: 'layer.move', layer, after: nonPredecessor(layerIds, layer, random) }
        }

        case 'frame.add':
            return {
                kind: 'frame.add',
                frame: createFrame(80 + random.int(240), `frame-${id}`),
                after: frameIds[random.int(frameIds.length + 1)] ?? null,
            }

        case 'frame.remove':
            return { kind: 'frame.remove', frame: frameIds[random.int(frameIds.length)]! }

        case 'frame.move': {
            const frame = frameIds[random.int(frameIds.length)]!
            return { kind: 'frame.move', frame, after: nonPredecessor(frameIds, frame, random) }
        }
    }
}

function sourceFor(kind: OperationKind, sources: readonly Source[], random: XorShift32): Source {
    const eligible = sources.filter((source) =>
        kind === 'layer.remove' || kind === 'layer.move'
            ? source.doc.layers.length > 1
            : kind === 'frame.remove' || kind === 'frame.move'
              ? source.doc.frames.length > 1
              : true,
    )
    return eligible[random.int(eligible.length)]!
}

function isAvailable(kind: OperationKind, sources: readonly Source[]): boolean {
    return kind !== 'layer.remove' && kind !== 'layer.move'
        ? kind !== 'frame.remove' && kind !== 'frame.move'
            ? true
            : sources.some((source) => source.doc.frames.length > 1)
        : sources.some((source) => source.doc.layers.length > 1)
}

function deliver(doc: Sprite, replica: Replica, messages: readonly ReplicaMessage[]): void {
    for (const message of messages) applyResult(doc, replica.receive(message))
}

describe('Replica deterministic convergence', () => {
    it('converges 100 generated operations for pinned seeds despite shuffled duplicate delivery', () => {
        for (const [round, seed] of [0x1, 0x5eed, 0xc0ffee, 0xdecafbad].entries()) {
            const random = new XorShift32(seed)
            const sources: Source[] = [1, 2, 3].map((site) => {
                const doc = sprite()
                return { doc, replica: new Replica(doc, site), site }
            })
            const messages: SentMessage[] = []
            const required: readonly OperationKind[] = [
                'pixel',
                'layer.set',
                'frame.setDuration',
                'document.rename',
                'palette.replace',
                'layer.add',
                'frame.add',
                'layer.remove',
                'frame.remove',
                'layer.add',
                'layer.move',
                'frame.add',
                'frame.move',
            ]

            for (let ordinal = 0; ordinal < 100; ordinal++) {
                const proposed =
                    ordinal < required.length
                        ? required[ordinal]!
                        : ALL_KINDS[random.int(ALL_KINDS.length)]!
                const kind = isAvailable(proposed, sources)
                    ? proposed
                    : proposed.startsWith('layer.')
                      ? 'layer.add'
                      : 'frame.add'
                const source = sourceFor(kind, sources, random)
                publish(source, operationFor(kind, source, random, round, ordinal), messages)
            }

            for (const recipient of sources) {
                const incoming = messages
                    .filter(({ source }) => source !== recipient.site)
                    .map(({ message }) => message)
                const duplicates = [incoming[0]!, incoming[incoming.length - 1]!]
                deliver(
                    recipient.doc,
                    recipient.replica,
                    random.shuffle([...incoming, ...duplicates]),
                )
            }

            const fingerprints = sources.map(({ doc }) => documentFingerprint(doc))
            expect(
                new Set(fingerprints).size,
                `convergence failed: ${JSON.stringify({ seed, round, fingerprints })}`,
            ).toBe(1)
        }
    })

    it('is invariant to forward, reverse, and shuffled delivery of crossing writes and structural conflicts', () => {
        const first = { doc: fixtureWithOrderingPeers(), site: 1 }
        const second = { doc: fixtureWithOrderingPeers(), site: 2 }
        const third = { doc: fixtureWithOrderingPeers(), site: 3 }
        const sources: Source[] = [first, second, third].map(({ doc, site }) => ({
            doc,
            site,
            replica: new Replica(doc, site),
        }))
        const messages: SentMessage[] = []
        const [one, two, three] = sources

        publish(
            one!,
            {
                kind: 'pixel.patch',
                layer: 'layer-1',
                frame: 'frame-1',
                xs: Uint16Array.of(4, 5),
                ys: Uint16Array.of(4, 4),
                colors: Uint32Array.of(0xff0000ff, 0xff0000ff),
            },
            messages,
        )
        publish(
            two!,
            {
                kind: 'pixel.patch',
                layer: 'layer-1',
                frame: 'frame-1',
                xs: Uint16Array.of(4, 4),
                ys: Uint16Array.of(4, 5),
                colors: Uint32Array.of(0x0000ffff, 0x0000ffff),
            },
            messages,
        )
        publish(
            three!,
            { kind: 'palette.replace', name: 'Nebula', colors: ['#111111', '#222222'] },
            messages,
        )
        publish(one!, { kind: 'layer.set', layer: 'layer-1', prop: 'opacity', value: 64 }, messages)
        publish(two!, { kind: 'frame.setDuration', frame: 'frame-1', duration: 120 }, messages)
        publish(three!, { kind: 'document.rename', title: 'Invariance' }, messages)
        publish(one!, { kind: 'layer.move', layer: 'layer-a', after: null }, messages)
        publish(two!, { kind: 'layer.move', layer: 'layer-b', after: null }, messages)
        publish(
            one!,
            { kind: 'layer.add', layer: createLayer('Engine', 'layer-engine'), after: 'layer-1' },
            messages,
        )
        publish(one!, { kind: 'layer.remove', layer: 'layer-engine' }, messages)
        publish(
            one!,
            { kind: 'layer.add', layer: createLayer('Engine', 'layer-engine'), after: null },
            messages,
        )
        publish(
            two!,
            { kind: 'frame.add', frame: createFrame(90, 'frame-engine'), after: 'frame-1' },
            messages,
        )
        publish(two!, { kind: 'frame.remove', frame: 'frame-engine' }, messages)
        publish(
            two!,
            { kind: 'frame.add', frame: createFrame(90, 'frame-engine'), after: null },
            messages,
        )

        const all = messages.map(({ message }) => message)
        const forward = fixtureWithOrderingPeers()
        const reverse = fixtureWithOrderingPeers()
        const shuffled = fixtureWithOrderingPeers()
        deliver(forward, new Replica(forward, 10), all)
        deliver(reverse, new Replica(reverse, 11), [...all].reverse())
        deliver(shuffled, new Replica(shuffled, 12), new XorShift32(0x6d2b79f5).shuffle(all))

        expect(
            new Set([
                documentFingerprint(forward),
                documentFingerprint(reverse),
                documentFingerprint(shuffled),
            ]).size,
        ).toBe(1)
    })
})
