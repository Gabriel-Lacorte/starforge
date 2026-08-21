import { describe, expect, it } from 'vitest'
import { rgba } from '@starforge/core'
import { DEFAULT_BACKGROUND, DEFAULT_FOREGROUND, EditorStore, RECENT_COLORS_MAX } from './store'
import { ONION_HIDDEN, ONION_SHOWN } from '../render/onion'

const RED = rgba(255, 0, 0)
const BLUE = rgba(0, 0, 255)

describe('EditorStore colors', () => {
    it('files the colour being replaced under recent, most recent first', () => {
        const store = new EditorStore()
        store.pickColor(RED)
        store.pickColor(BLUE)

        expect(store.state.color).toBe(BLUE)
        expect(store.state.recentColors).toEqual([RED, DEFAULT_FOREGROUND])
    })

    it('ignores a repeat of the colour already picked', () => {
        const store = new EditorStore()
        store.pickColor(RED)
        store.pickColor(RED)

        expect(store.state.recentColors).toEqual([DEFAULT_FOREGROUND])
    })

    it('moves a colour picked again back to the front instead of duplicating it', () => {
        const store = new EditorStore()
        store.pickColor(RED)
        store.pickColor(BLUE)
        store.pickColor(RED)
        store.pickColor(BLUE)

        expect(store.state.recentColors).toEqual([RED, BLUE, DEFAULT_FOREGROUND])
    })

    it('caps the recent list so it cannot grow without bound', () => {
        const store = new EditorStore()
        for (let index = 0; index < RECENT_COLORS_MAX * 3; index++) {
            store.pickColor(rgba(index & 0xff, 1, 2))
        }

        expect(store.state.recentColors).toHaveLength(RECENT_COLORS_MAX)
    })

    it('swaps foreground and background without touching recent colours', () => {
        const store = new EditorStore()
        store.pickColor(RED)
        const recent = store.state.recentColors

        store.swapColors()
        expect(store.state.color).toBe(DEFAULT_BACKGROUND)
        expect(store.state.background).toBe(RED)
        expect(store.state.recentColors).toBe(recent)

        store.swapColors()
        expect(store.state.color).toBe(RED)
        expect(store.state.background).toBe(DEFAULT_BACKGROUND)
    })

    it('resets both colours to the defaults', () => {
        const store = new EditorStore()
        store.pickColor(RED)
        store.swapColors()
        store.resetColors()

        expect(store.state.color).toBe(DEFAULT_FOREGROUND)
        expect(store.state.background).toBe(DEFAULT_BACKGROUND)
    })
})

describe('EditorStore onion skin', () => {
    it('starts with one neighbour ghosted on each side', () => {
        expect(new EditorStore().state.onion).toEqual(ONION_SHOWN)
    })

    it('hides and shows the ghosts without disturbing the document', () => {
        const store = new EditorStore()
        store.setOnion(false)
        expect(store.state.onion).toEqual(ONION_HIDDEN)
        expect(store.onionShown).toBe(false)

        store.setOnion(true)
        expect(store.state.onion).toEqual(ONION_SHOWN)
        expect(store.onionShown).toBe(true)
    })

    it('keeps the opacity across a trip through hidden', () => {
        const store = new EditorStore()
        store.setOnion(false)

        expect(store.state.onion.opacity).toBe(ONION_SHOWN.opacity)
    })

    it('says nothing when the toggle is set to what it already is', () => {
        const store = new EditorStore()
        let told = 0
        store.subscribe(() => told++)

        store.setOnion(true)
        expect(told).toBe(0)

        store.setOnion(false)
        store.setOnion(false)
        expect(told).toBe(1)
    })
})
