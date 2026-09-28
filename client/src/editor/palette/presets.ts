import { DEFAULT_PALETTE } from '@starforge/core'

export interface PalettePreset {
    readonly id: string
    readonly name: string
    readonly colors: readonly string[]
}

export const PALETTE_PRESETS: readonly PalettePreset[] = [
    {
        id: 'starforge',
        name: DEFAULT_PALETTE.name,
        colors: DEFAULT_PALETTE.colors,
    },
    {
        id: 'game-boy',
        name: 'Game Boy',
        colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
    },
    {
        id: 'pico-8',
        name: 'PICO-8',
        colors: [
            '#000000',
            '#1d2b53',
            '#7e2553',
            '#008751',
            '#ab5236',
            '#5f574f',
            '#c2c3c7',
            '#fff1e8',
            '#ff004d',
            '#ffa300',
            '#ffec27',
            '#00e436',
            '#29adff',
            '#83769c',
            '#ff77a8',
            '#ffccaa',
        ],
    },
    {
        id: 'cga',
        name: 'CGA',
        colors: [
            '#000000',
            '#0000aa',
            '#00aa00',
            '#00aaaa',
            '#aa0000',
            '#aa00aa',
            '#aa5500',
            '#aaaaaa',
            '#555555',
            '#5555ff',
            '#55ff55',
            '#55ffff',
            '#ff5555',
            '#ff55ff',
            '#ffff55',
            '#ffffff',
        ],
    },
    {
        id: 'grayscale',
        name: 'Grayscale',
        colors: [
            '#000000',
            '#242424',
            '#484848',
            '#6d6d6d',
            '#919191',
            '#b6b6b6',
            '#dadada',
            '#ffffff',
        ],
    },
    {
        id: 'one-bit',
        name: '1-bit',
        colors: ['#000000', '#ffffff'],
    },
]
