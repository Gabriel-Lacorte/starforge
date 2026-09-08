import { describe, expect, it } from 'vitest'
import { acceptKey } from './handshake'

describe('websocket handshake', () => {
    it('answers the RFC 6455 example key', () => {
        expect(acceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=')
    })
})
