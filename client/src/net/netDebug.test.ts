import { describe, expect, it } from 'vitest'
import { installNetDebugGlobal, netDebugDump, netDebugEntries, netLog } from './netDebug.js'

describe('netDebug', () => {
    it('records events and formats the dump one per line', () => {
        netLog('welcome', { site: 3, seq: 12 })
        netLog('op_rejected', { message: 'invalid operation: layer.remove: no layer abc' })

        const dump = netDebugDump()
        const lines = dump.split('\n')
        const welcome = lines.find((line) => line.includes('welcome '))
        const rejected = lines.find((line) => line.includes('op_rejected'))

        expect(welcome).toMatch(/site=3 seq=12$/)
        expect(rejected).toContain('message="invalid operation: layer.remove: no layer abc"')
    })

    it('keeps only the newest 200 entries', () => {
        for (let i = 0; i < 260; i++) netLog('tick', { i })
        expect(netDebugEntries().length).toBeLessThanOrEqual(200)
        const dump = netDebugDump()
        expect(dump).toContain('i=259')
        expect(dump).not.toContain('i=0')
    })

    it('never throws in a node-like environment and stays disabled there', () => {
        expect(typeof window).toBe('undefined')
        installNetDebugGlobal()
        netLog('still_fine')
        expect(netDebugDump()).toContain('still_fine')
    })
})
