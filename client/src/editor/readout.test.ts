import { describe, expect, it } from 'vitest'
import { ReadoutStore } from './readout'

describe('selection readout', () => {
    it('starts with no active selection', () => {
        expect(new ReadoutStore().state.selectionActive).toBe(false)
    })

    it('publishes selection activity without copying the mask', () => {
        const readout = new ReadoutStore()
        readout.patch({ selectionActive: true })
        expect(readout.state.selectionActive).toBe(true)
        readout.patch({ selectionActive: false })
        expect(readout.state.selectionActive).toBe(false)
    })
})
