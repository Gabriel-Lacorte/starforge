import { describe, expect, it } from 'vitest'
import { relayHttpBase, wsBase } from './wsBase'

describe('wsBase', () => {
    it('maps an http origin to a ws wire url', () => {
        expect(wsBase('http://atelier.example', null)).toBe('ws://atelier.example/wire')
    })

    it('maps an https origin to a wss wire url', () => {
        expect(wsBase('https://atelier.example', null)).toBe('wss://atelier.example/wire')
    })

    it('lets a ?relay= override win as-is', () => {
        expect(wsBase('https://atelier.example', 'ws://localhost:8131/wire')).toBe(
            'ws://localhost:8131/wire',
        )
    })
})

describe('relayHttpBase', () => {
    it('maps a ws wire url back to its http base', () => {
        expect(relayHttpBase('ws://localhost:8131/wire')).toBe('http://localhost:8131')
    })

    it('maps a wss wire url back to its https base', () => {
        expect(relayHttpBase('wss://relay.example/wire')).toBe('https://relay.example')
    })

    it('keeps the host and port of a dev wire url', () => {
        expect(relayHttpBase('ws://atelier.example:5199/wire')).toBe('http://atelier.example:5199')
    })
})
