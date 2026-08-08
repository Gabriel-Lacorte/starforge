import { describe, expect, it } from 'vitest'
import {
    Command,
    createLayer,
    createSprite,
    rgba,
    writePixel,
    type BlendMode,
    type Sprite,
} from '@starforge/core'
import { DocumentSession } from '../../document/session'
import {
    AddLayerEntry,
    DuplicateLayerEntry,
    MoveLayerEntry,
    RemoveLayerEntry,
    SetLayerPropEntry,
} from './layerEntries'

function makeRng(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0
        return s / 0x100000000
    }
}

interface LayerSnapshot {
    id: string
    name: string
    opacity: number
    blendMode: BlendMode
    visible: boolean
    locked: boolean
    cels: number[][]
}

function snapshot(sprite: Sprite): LayerSnapshot[] {
    return sprite.layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        visible: layer.visible,
        locked: layer.locked,
        cels: sprite.frames.map((frame) => {
            const cel = layer.cels.get(frame.id)
            return cel
                ? [...cel.pixels]
                : new Array<number>(sprite.width * sprite.height * 4).fill(0)
        }),
    }))
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

describe('mixed history property (spec 14)', () => {
    it('N random actions (strokes + structure), undo-all -> initial, redo-all -> final', () => {
        const rng = makeRng(0x53_33_11)
        const sprite = createSprite({ width: 16, height: 16 })
        const frame = sprite.frames[0]!.id
        const session = new DocumentSession(sprite, 'prop-author', { maxEntries: 1000 })

        const randomLayer = () => sprite.layers[Math.floor(rng() * sprite.layers.length)]!
        const colors = [
            0,
            rgba(255, 0, 0),
            rgba(0, 255, 0),
            rgba(0, 0, 255, 128),
            rgba(255, 255, 0),
        ]

        const initial = snapshot(sprite)
        let performed = 0

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
                session.apply(new AddLayerEntry(createLayer(`L${i}`), randomLayer().id))
                performed++
            } else if (dice < 0.65) {
                if (sprite.layers.length > 1) {
                    session.apply(new RemoveLayerEntry(randomLayer().id))
                    performed++
                }
            } else if (dice < 0.75) {
                session.apply(new DuplicateLayerEntry(sprite, randomLayer().id))
                performed++
            } else if (dice < 0.85) {
                const mover = randomLayer()
                const after = rng() < 0.2 ? null : randomLayer().id
                const from = sprite.layers.findIndex((l) => l.id === mover.id)
                const inPlace =
                    after === mover.id ||
                    (after === null && from === 0) ||
                    (after !== null && sprite.layers.findIndex((l) => l.id === after) === from - 1)
                if (!inPlace) {
                    session.apply(new MoveLayerEntry(mover.id, after))
                    performed++
                }
            } else {
                const layer = randomLayer()
                const prop = Math.floor(rng() * 4)
                if (prop === 0) {
                    const value = Math.floor(rng() * 256)
                    if (value !== layer.opacity) {
                        session.apply(
                            new SetLayerPropEntry(layer.id, 'opacity', layer.opacity, value),
                        )
                        performed++
                    }
                } else if (prop === 1) {
                    session.apply(
                        new SetLayerPropEntry(layer.id, 'visible', layer.visible, !layer.visible),
                    )
                    performed++
                } else if (prop === 2) {
                    session.apply(
                        new SetLayerPropEntry(layer.id, 'locked', layer.locked, !layer.locked),
                    )
                    performed++
                } else {
                    const mode = BLENDS[Math.floor(rng() * BLENDS.length)]!
                    if (mode !== layer.blendMode) {
                        session.apply(
                            new SetLayerPropEntry(layer.id, 'blendMode', layer.blendMode, mode),
                        )
                        performed++
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
        const final = snapshot(sprite)

        let undone = 0
        while (session.canUndo) {
            session.undo()
            undone++
        }
        expect(undone).toBe(performed)
        expect(snapshot(sprite)).toEqual(initial)

        while (session.canRedo) session.redo()
        expect(snapshot(sprite)).toEqual(final)
    })
})
