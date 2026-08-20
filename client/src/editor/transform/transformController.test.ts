import { describe, expect, it } from 'vitest'
import {
    createSprite,
    getPixel,
    layerSet,
    rectMask,
    rgba,
    writePixel,
    type SelectionMask,
    type Sprite,
} from '@starforge/core'
import { DocumentSession } from '../../document/session'
import { TransformController } from './transformController'

const RED = rgba(255, 0, 0)
const BLUE = rgba(0, 0, 255)

function setup(): {
    sprite: Sprite
    layer: string
    frame: string
    session: DocumentSession
    transforms: TransformController
    select: (mask: SelectionMask | null) => void
    reselected: SelectionMask[]
    settled: () => number
} {
    const sprite = createSprite({ width: 16, height: 16 })
    const session = new DocumentSession(sprite)
    let mask: SelectionMask | null = null
    const reselected: SelectionMask[] = []
    let settles = 0

    return {
        sprite,
        layer: sprite.layers[0]!.id,
        frame: sprite.frames[0]!.id,
        session,
        transforms: new TransformController({
            sprite,
            session,
            selection: () => mask,
            reselect: (next) => reselected.push(next),
            settle: () => settles++,
        }),
        select: (next) => {
            mask = next
        },
        reselected,
        settled: () => settles,
    }
}

describe('TransformController', () => {
    it('flips the whole cel when nothing is selected', () => {
        const { sprite, layer, frame, transforms } = setup()
        writePixel(sprite, layer, frame, 0, 5, RED)

        transforms.apply('flip-h')

        expect(getPixel(sprite, layer, frame, 0, 5)).toBe(0)
        expect(getPixel(sprite, layer, frame, 15, 5)).toBe(RED)
    })

    it('flips only the selection, leaving the rest of the cel alone', () => {
        const { sprite, layer, frame, transforms, select } = setup()
        writePixel(sprite, layer, frame, 2, 2, RED)
        writePixel(sprite, layer, frame, 12, 2, BLUE)
        select(rectMask(16, 16, 2, 2, 5, 2))

        transforms.apply('flip-h')

        expect(getPixel(sprite, layer, frame, 2, 2)).toBe(0)
        expect(getPixel(sprite, layer, frame, 5, 2)).toBe(RED)
        expect(getPixel(sprite, layer, frame, 12, 2)).toBe(BLUE)
    })

    it('is one undo step, however many pixels it moved', () => {
        const { sprite, layer, frame, session, transforms } = setup()
        for (let x = 0; x < 16; x++) writePixel(sprite, layer, frame, x, 0, RED)
        writePixel(sprite, layer, frame, 0, 3, BLUE)

        transforms.apply('rotate-cw')
        expect(getPixel(sprite, layer, frame, 0, 3)).not.toBe(BLUE)

        session.undo()
        expect(getPixel(sprite, layer, frame, 0, 3)).toBe(BLUE)
        for (let x = 0; x < 16; x++) expect(getPixel(sprite, layer, frame, x, 0)).toBe(RED)
        expect(session.canUndo).toBe(false)
    })

    it('preserves alpha exactly, rather than compositing anything', () => {
        const { sprite, layer, frame, transforms } = setup()
        const faint = rgba(10, 20, 30, 7)
        writePixel(sprite, layer, frame, 1, 1, faint)

        transforms.apply('flip-v')

        expect(getPixel(sprite, layer, frame, 1, 14)).toBe(faint)
    })

    it('hands the moved selection back so the marquee follows its pixels', () => {
        const { transforms, select, reselected } = setup()
        select(rectMask(16, 16, 2, 2, 5, 3))

        transforms.apply('rotate-cw')

        expect(reselected).toHaveLength(1)
        expect(reselected[0]!.bounds).toEqual({ x: 3, y: 1, w: 2, h: 4 })
    })

    it('settles work in flight before it moves anything', () => {
        const { transforms, settled } = setup()
        transforms.apply('flip-h')

        expect(settled()).toBe(1)
    })

    it('refuses to transform a locked layer', () => {
        const { sprite, layer, frame, session, transforms } = setup()
        writePixel(sprite, layer, frame, 0, 5, RED)
        session.apply('lock', layerSet(layer, 'locked', true))

        transforms.apply('flip-h')

        expect(getPixel(sprite, layer, frame, 0, 5)).toBe(RED)
    })

    it('records nothing when the transform changes no pixel', () => {
        const { session, transforms } = setup()
        transforms.apply('flip-h')

        expect(session.canUndo).toBe(false)
    })
})
