import { describe, expect, it } from 'vitest'
import { PresenceStore, TOOL_WIRE, toolFromWire, toolToWire } from './presence'

describe('tool wire table', () => {
    it('matches the ToolId order exactly', () => {
        expect(TOOL_WIRE).toEqual([
            'pencil',
            'eraser',
            'line',
            'rect',
            'ellipse',
            'bucket',
            'select',
            'selectEllipse',
            'lasso',
            'wand',
            'eyedropper',
        ])
    })

    it('round-trips all 11 tools', () => {
        expect(TOOL_WIRE).toHaveLength(11)
        for (const tool of TOOL_WIRE) {
            expect(toolFromWire(toolToWire(tool))).toBe(tool)
        }
    })

    it('falls back to pencil for out-of-range codes', () => {
        expect(toolFromWire(99)).toBe('pencil')
        expect(toolFromWire(-1)).toBe('pencil')
    })
})

describe('presence store', () => {
    it('joins two peers and moves a cursor on presence', () => {
        const store = new PresenceStore()
        store.applyJoin(1, 'ada', 0xffcc33ff, 1000)
        store.applyJoin(2, 'grace', 0x6ee7ffff, 1000)
        expect(store.peers().map((peer) => peer.nickname)).toEqual(['ada', 'grace'])

        store.applyPresence(1, 7, 9, 'eraser', 'layer-1', 'frame-1', 1500)
        const ada = store.peers().find((peer) => peer.site === 1)!
        expect(ada.x).toBe(7)
        expect(ada.y).toBe(9)
        expect(ada.tool).toBe('eraser')
        expect(ada.layer).toBe('layer-1')
        expect(ada.frame).toBe('frame-1')
    })

    it('ignores presence from an unknown site', () => {
        const store = new PresenceStore()
        store.applyJoin(1, 'ada', 0xffcc33ff, 1000)
        store.applyPresence(9, 3, 4, 'line', 'layer-1', 'frame-1', 1500)
        expect(store.peers()).toHaveLength(1)
    })

    it('sweeps peers older than 5000 ms but keeps fresh ones', () => {
        const store = new PresenceStore()
        store.applyJoin(1, 'ada', 0xffcc33ff, 1000)
        store.applyJoin(2, 'grace', 0x6ee7ffff, 6000)
        store.sweep(7000)
        expect(store.peers().map((peer) => peer.site)).toEqual([2])
    })

    it('removes a peer on leave', () => {
        const store = new PresenceStore()
        store.applyJoin(1, 'ada', 0xffcc33ff, 1000)
        store.applyJoin(2, 'grace', 0x6ee7ffff, 1000)
        store.applyLeave(1)
        expect(store.peers().map((peer) => peer.site)).toEqual([2])
    })
})
