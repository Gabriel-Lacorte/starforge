import { describe, expect, it } from 'vitest'
import { loadConfig } from './config'

describe('relay config', () => {
    it('applies port, origins and data dir defaults', () => {
        const config = loadConfig({})
        expect(config.port).toBe(8131)
        expect(config.origins).toEqual([])
        expect(config.dataDir).toBe('./data')
    })
})
