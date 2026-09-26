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

        store.applyPresence(
            1,
            7,
            9,
            'eraser',
            'layer-1',
            'frame-1',
            'ada',
            0xffcc33ff,
            undefined,
            1500,
        )
        const ada = store.peers().find((peer) => peer.site === 1)!
        expect(ada.x).toBe(7)
        expect(ada.y).toBe(9)
        expect(ada.tool).toBe('eraser')
        expect(ada.layer).toBe('layer-1')
        expect(ada.frame).toBe('frame-1')
    })

    it('seeds an unknown site from the identity riding its presence', () => {
        const store = new PresenceStore()
        store.applyJoin(1, 'ada', 0xffcc33ff, 1000)
        store.applyPresence(
            9,
            3,
            4,
            'line',
            'layer-1',
            'frame-1',
            'kay',
            0x33ccffff,
            undefined,
            1500,
        )
        const kay = store.peers().find((peer) => peer.site === 9)!
        expect(kay.nickname).toBe('kay')
        expect(kay.color).toBe(0x33ccffff)
        expect(kay.x).toBe(3)
        expect(kay.y).toBe(4)
    })

    it('updates nickname and color from later presence frames', () => {
        const store = new PresenceStore()
        store.applyJoin(1, 'ada', 0xffcc33ff, 1000)
        store.applyPresence(
            1,
            2,
            2,
            'pencil',
            'layer-1',
            'frame-1',
            'ada-blue',
            0x33ccffff,
            undefined,
            1500,
        )
        const ada = store.peers().find((peer) => peer.site === 1)!
        expect(ada.nickname).toBe('ada-blue')
        expect(ada.color).toBe(0x33ccffff)
    })

    it('keeps an away cursor (-1, -1) without dropping the peer', () => {
        const store = new PresenceStore()
        store.applyJoin(1, 'ada', 0xffcc33ff, 1000)
        store.applyPresence(
            1,
            -1,
            -1,
            'pencil',
            'layer-1',
            'frame-1',
            'ada',
            0xffcc33ff,
            undefined,
            1500,
        )
        const ada = store.peers().find((peer) => peer.site === 1)!
        expect(ada.x).toBe(-1)
        expect(ada.y).toBe(-1)
        expect(ada.nickname).toBe('ada')
    })

    it('accumulates stroke preview deltas and clears them when the frame has none', () => {
        const store = new PresenceStore()
        store.applyJoin(1, 'ada', 0xffcc33ff, 1000)
        store.applyPresence(
            1,
            1,
            1,
            'pencil',
            'layer-1',
            'frame-1',
            'ada',
            0xffcc33ff,
            { color: 0xff0000ff, cells: [3, 4], full: false },
            1500,
        )
        store.applyPresence(
            1,
            2,
            2,
            'pencil',
            'layer-1',
            'frame-1',
            'ada',
            0xffcc33ff,
            { color: 0xff0000ff, cells: [5], full: false },
            1600,
        )
        let ada = store.peers().find((peer) => peer.site === 1)!
        expect([...ada.previewCells]).toEqual([3, 4, 5])
        expect(ada.previewColor).toBe(0xff0000ff)

        store.applyPresence(
            1,
            2,
            2,
            'pencil',
            'layer-1',
            'frame-1',
            'ada',
            0xffcc33ff,
            undefined,
            1700,
        )
        ada = store.peers().find((peer) => peer.site === 1)!
        expect(ada.previewCells.size).toBe(0)
    })

    it('replaces the preview set when a shape preview arrives', () => {
        const store = new PresenceStore()
        store.applyJoin(1, 'ada', 0xffcc33ff, 1000)
        store.applyPresence(
            1,
            1,
            1,
            'rect',
            'layer-1',
            'frame-1',
            'ada',
            0xffcc33ff,
            { color: 0xff0000ff, cells: [3, 4, 5], full: true },
            1500,
        )
        store.applyPresence(
            1,
            1,
            1,
            'rect',
            'layer-1',
            'frame-1',
            'ada',
            0xffcc33ff,
            { color: 0xff0000ff, cells: [7, 8], full: true },
            1600,
        )
        const ada = store.peers().find((peer) => peer.site === 1)!
        expect([...ada.previewCells]).toEqual([7, 8])
    })

    it('keeps a throttled background tab and sweeps only the long gone', () => {
        const store = new PresenceStore()
        store.applyJoin(1, 'ada', 0xffcc33ff, 1000)
        store.applyJoin(2, 'grace', 0x6ee7ffff, 25000)
        store.applyJoin(3, 'linus', 0x33ff66ff, 88000)

        store.sweep(32000)
        expect(store.peers().map((peer) => peer.site)).toEqual([1, 2, 3])

        store.sweep(95000)
        expect(store.peers().map((peer) => peer.site)).toEqual([2, 3])

        store.sweep(116000)
        expect(store.peers().map((peer) => peer.site)).toEqual([3])
    })

    it('removes a peer on leave', () => {
        const store = new PresenceStore()
        store.applyJoin(1, 'ada', 0xffcc33ff, 1000)
        store.applyJoin(2, 'grace', 0x6ee7ffff, 1000)
        store.applyLeave(1)
        expect(store.peers().map((peer) => peer.site)).toEqual([2])
    })
})
