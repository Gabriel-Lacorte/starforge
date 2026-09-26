import { describe, expect, it } from 'vitest'
import { RelayLog, hexHead, parseLogLevel } from './log.js'

function collector(): { lines: string[]; log: RelayLog } {
    const lines: string[] = []
    const log = new RelayLog({ level: 'debug', write: (line) => lines.push(line) })
    return { lines, log }
}

describe('parseLogLevel', () => {
    it('accepts the four levels, off, and falls back to info', () => {
        expect(parseLogLevel('debug')).toBe('debug')
        expect(parseLogLevel('INFO')).toBe('info')
        expect(parseLogLevel('warn')).toBe('warn')
        expect(parseLogLevel('error')).toBe('error')
        expect(parseLogLevel('off')).toBe('off')
        expect(parseLogLevel(undefined)).toBe('info')
        expect(parseLogLevel('loud')).toBe('info')
    })
})

describe('hexHead', () => {
    it('renders the first bytes in hex and marks the rest', () => {
        expect(hexHead(Uint8Array.of(0x00, 0x0f, 0xff))).toBe('00 0f ff')
        expect(hexHead(Uint8Array.of(1, 2, 3, 4), 2)).toBe('01 02 …(+2)')
    })
})

describe('RelayLog', () => {
    it('writes structured single lines and skips undefined fields', () => {
        const { lines, log } = collector()
        log.info('join', { room: 'ab12', site: 3, nickname: undefined })
        expect(lines).toEqual(['relay info join room=ab12 site=3'])
    })

    it('quotes values with spaces or quotes', () => {
        const { lines, log } = collector()
        log.warn('op_rejected', { reason: 'no layer 37d3' })
        expect(lines).toEqual(['relay warn op_rejected reason="no layer 37d3"'])
    })

    it('filters events below the configured level', () => {
        const lines: string[] = []
        const log = new RelayLog({ level: 'info', write: (line) => lines.push(line) })
        log.debug('op_applied', { seq: 1 })
        log.info('join', { site: 1 })
        log.warn('frame_dropped', {})
        expect(lines).toEqual(['relay info join site=1', 'relay warn frame_dropped'])
    })

    it('stays silent at level off', () => {
        const lines: string[] = []
        const log = new RelayLog({ level: 'off', write: (line) => lines.push(line) })
        log.error('uncaught', { message: 'boom' })
        expect(lines).toEqual([])
    })

    it('suppresses hot keys and reports a count when the window closes', () => {
        let now = 10_000
        const lines: string[] = []
        const log = new RelayLog({
            level: 'info',
            write: (line) => lines.push(line),
            now: () => now,
        })

        for (let i = 0; i < 8; i++) log.warn('op_rejected', { room: 'ab12', i }, 'op_rejected')
        expect(lines.filter((line) => line.includes('op_rejected room'))).toHaveLength(5)
        expect(lines.some((line) => line.includes('repeated'))).toBe(false)

        now += 61_000
        log.warn('op_rejected', { room: 'ab12' }, 'op_rejected')
        const summary = lines.find((line) => line.includes('op_rejected repeated'))
        expect(summary).toContain('repeats=3')
        expect(lines.filter((line) => line.includes('op_rejected room'))).toHaveLength(6)
    })

    it('emits pending summaries on flush', () => {
        const lines: string[] = []
        const log = new RelayLog({ level: 'info', write: (line) => lines.push(line) })
        for (let i = 0; i < 9; i++) log.info('rate_limited', { site: 2 }, 'rate_limited')
        log.flush()
        const summary = lines.find((line) => line.includes('rate_limited repeated'))
        expect(summary).toContain('repeats=4')
    })

    it('logs unsuppressed events every time', () => {
        const { lines, log } = collector()
        for (let i = 0; i < 8; i++) log.info('join', { site: i })
        expect(lines).toHaveLength(8)
    })
})
