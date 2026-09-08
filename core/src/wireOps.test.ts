import { describe, expect, it } from 'vitest'
import { rgba } from './color'
import type { DocumentOperation } from './operation'
import { decodeOperation, encodeOperation, splitPixelPatch } from './wireOps'

describe('operation codec', () => {
    it('round-trips a rename and a layer opacity set', () => {
        const rename = { kind: 'document.rename', title: 'Orbit' } as const
        expect(decodeOperation(encodeOperation(rename))).toEqual(rename)

        const dim = { kind: 'layer.set', layer: 'l1', prop: 'opacity', value: 128 } as const
        expect(decodeOperation(encodeOperation(dim))).toEqual(dim)
    })

    it('packs a one-colour 900-pixel patch near 3 bytes per pixel', () => {
        const cells = 900
        const op = {
            kind: 'pixel.patch',
            layer: 'layer-1',
            frame: 'frame-1',
            xs: Uint16Array.from({ length: cells }, (_, i) => i % 30),
            ys: Uint16Array.from({ length: cells }, (_, i) => Math.floor(i / 30)),
            colors: Uint32Array.from({ length: cells }, () => rgba(255, 204, 51)),
        } as const
        const body = encodeOperation(op)
        expect(body.length).toBeLessThan(3600)
    })

    it('splits a patch with more than 255 colours into sendable chunks', () => {
        const cells = 300
        const op = {
            kind: 'pixel.patch',
            layer: 'layer-1',
            frame: 'frame-1',
            xs: Uint16Array.from({ length: cells }, (_, i) => i),
            ys: Uint16Array.from({ length: cells }, () => 0),
            colors: Uint32Array.from({ length: cells }, (_, i) => (i << 8) | 0xff),
        } as const
        const chunks = splitPixelPatch(op)
        expect(chunks.length).toBe(2)
        for (const chunk of chunks) {
            expect(new Set(chunk.colors).size).toBeLessThanOrEqual(255)
        }
        const total = chunks.reduce((sum, chunk) => sum + chunk.xs.length, 0)
        expect(total).toBe(cells)
    })

    it('round-trips every operation kind byte-for-byte', () => {
        const ops: readonly DocumentOperation[] = [
            {
                kind: 'pixel.patch',
                layer: 'l1',
                frame: 'f1',
                xs: Uint16Array.of(2, 5),
                ys: Uint16Array.of(3, 3),
                colors: Uint32Array.of(rgba(255, 0, 0), rgba(0, 255, 0)),
            },
            {
                kind: 'layer.add',
                layer: {
                    id: 'l2',
                    name: 'Second',
                    opacity: 200,
                    blendMode: 'multiply',
                    visible: true,
                    locked: false,
                    cels: new Map(),
                },
                after: null,
            },
            { kind: 'layer.remove', layer: 'l1' },
            { kind: 'layer.move', layer: 'l2', after: 'l1' },
            { kind: 'layer.move', layer: 'l2', after: null },
            { kind: 'layer.set', layer: 'l1', prop: 'opacity', value: 128 },
            { kind: 'layer.set', layer: 'l1', prop: 'name', value: 'Ink' },
            { kind: 'layer.set', layer: 'l1', prop: 'blendMode', value: 'screen' },
            { kind: 'layer.set', layer: 'l1', prop: 'visible', value: false },
            { kind: 'palette.add', color: '#ff0000', index: 0 },
            { kind: 'palette.remove', index: 1 },
            { kind: 'palette.move', from: 0, to: 2 },
            { kind: 'palette.set', index: 0, color: '#00ff00' },
            { kind: 'palette.rename', name: 'Dusk' },
            { kind: 'palette.replace', name: 'Dusk', colors: ['#000000', '#ffffff'] },
            { kind: 'frame.add', frame: { id: 'f2', duration: 120 }, after: 'f1' },
            { kind: 'frame.add', frame: { id: 'f3', duration: 100 }, after: null },
            { kind: 'frame.remove', frame: 'f1' },
            { kind: 'frame.move', frame: 'f2', after: null },
            { kind: 'frame.move', frame: 'f2', after: 'f1' },
            { kind: 'frame.setDuration', frame: 'f1', duration: 250 },
            { kind: 'document.rename', title: 'Orbit' },
            { kind: 'document.resize', width: 64, height: 64, offsetX: 0, offsetY: -2 },
            { kind: 'document.scale', width: 32, height: 32 },
            {
                kind: 'document.restore',
                width: 16,
                height: 16,
                cels: [],
            },
        ]
        for (const op of ops) expect(decodeOperation(encodeOperation(op))).toEqual(op)
    })
})
