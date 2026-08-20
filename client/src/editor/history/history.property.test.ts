import { describe, expect, it } from 'vitest'
import {
    Command,
    cloneLayer,
    createLayer,
    createSprite,
    documentFingerprint,
    layerSet,
    rgba,
    writePixel,
    type BlendMode,
    type DocumentOperation,
} from '@starforge/core'
import { DocumentSession } from '../../document/session'

function makeRng(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0
        return s / 0x100000000
    }
}

const BLENDS: BlendMode[] = [
    'normal',
    'multiply',
    'screen',
    'overlay',
    'additive',
    'darken',
    'lighten',
]

describe('mixed history property', () => {
    it('N random actions, undo-all -> initial, redo-all -> final', () => {
        const rng = makeRng(0x53_33_11)
        const sprite = createSprite({ width: 16, height: 16 })
        const frame = sprite.frames[0]!.id
        const session = new DocumentSession(sprite, {
            author: 'prop-author',
            undo: { maxEntries: 1000 },
        })

        const randomLayer = () => sprite.layers[Math.floor(rng() * sprite.layers.length)]!
        const colors = [
            0,
            rgba(255, 0, 0),
            rgba(0, 255, 0),
            rgba(0, 0, 255, 128),
            rgba(255, 255, 0),
        ]

        const initial = documentFingerprint(sprite)
        let performed = 0
        const record = (label: string, operation: DocumentOperation): void => {
            session.apply(label, operation)
            performed++
        }

        for (let i = 0; i < 300; i++) {
            const dice = rng()
            if (dice < 0.4) {
                const layer = randomLayer()
                const command = new Command(`stroke ${i}`)

                const n = 1 + Math.floor(rng() * 8)
                for (let k = 0; k < n; k++) {
                    const write = writePixel(
                        sprite,
                        layer.id,
                        frame,
                        Math.floor(rng() * 16),
                        Math.floor(rng() * 16),
                        colors[Math.floor(rng() * colors.length)]!,
                    )
                    if (write) command.record(write)
                }

                session.commit(command)
                if (command.writes().length > 0) performed++
            } else if (dice < 0.55) {
                record('add layer', {
                    kind: 'layer.add',
                    layer: createLayer(`L${i}`),
                    after: randomLayer().id,
                })
            } else if (dice < 0.65) {
                if (sprite.layers.length > 1) {
                    record('remove layer', { kind: 'layer.remove', layer: randomLayer().id })
                }
            } else if (dice < 0.75) {
                const source = randomLayer().id
                record('duplicate layer', {
                    kind: 'layer.add',
                    layer: cloneLayer(sprite, source),
                    after: source,
                })
            } else if (dice < 0.85) {
                const mover = randomLayer()
                const after = rng() < 0.2 ? null : randomLayer().id
                const from = sprite.layers.findIndex((l) => l.id === mover.id)

                const inPlace =
                    after === mover.id ||
                    (after === null && from === 0) ||
                    (after !== null && sprite.layers.findIndex((l) => l.id === after) === from - 1)
                if (!inPlace) record('move layer', { kind: 'layer.move', layer: mover.id, after })
            } else {
                const layer = randomLayer()
                const prop = Math.floor(rng() * 4)
                if (prop === 0) {
                    const value = Math.floor(rng() * 256)
                    if (value !== layer.opacity) {
                        record('layer opacity', layerSet(layer.id, 'opacity', value))
                    }
                } else if (prop === 1) {
                    record('layer visible', layerSet(layer.id, 'visible', !layer.visible))
                } else if (prop === 2) {
                    record('layer locked', layerSet(layer.id, 'locked', !layer.locked))
                } else {
                    const mode = BLENDS[Math.floor(rng() * BLENDS.length)]!
                    if (mode !== layer.blendMode) {
                        record('layer blendMode', layerSet(layer.id, 'blendMode', mode))
                    }
                }
            }

            if (rng() < 0.12 && session.canUndo) {
                session.undo()
                if (rng() < 0.5) session.redo()
                else performed--
            }
        }

        expect(performed).toBeGreaterThan(150)
        const final = documentFingerprint(sprite)

        let undone = 0
        while (session.canUndo) {
            session.undo()
            undone++
        }
        expect(undone).toBe(performed)
        expect(documentFingerprint(sprite)).toBe(initial)

        while (session.canRedo) session.redo()
        expect(documentFingerprint(sprite)).toBe(final)
    })
})
