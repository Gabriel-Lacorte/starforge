import { PALETTE_MAX_COLORS, type Palette } from './doc'
import { normalizeName } from './text'

export const PALETTE_NAME_MAX = 64

export const PALETTE_IMPORT_LIMITS = {
    maxBytes: 1024 * 1024,
    maxLines: 100_000,
} as const

export type PaletteImportErrorCode = 'FORMAT' | 'LIMIT' | 'EMPTY'

export class PaletteImportError extends Error {
    readonly code: PaletteImportErrorCode

    constructor(code: PaletteImportErrorCode, detail: string) {
        super(`palette not imported [${code.toLowerCase()}]: ${detail}`)
        this.name = 'PaletteImportError'
        this.code = code
    }
}

export function normalizePaletteName(name: string): string {
    return normalizeName(name, PALETTE_NAME_MAX)
}

const GPL_SIGNATURE = /^GIMP Palette\s*$/
const GPL_HEADER = /^(Name|Columns):\s*(.*)$/
const GPL_ENTRY = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+(.*))?$/
const LOOSE_HEX = /^#?([0-9a-fA-F]{3,8})$/

export function parsePalette(text: string, fallbackName: string): Palette {
    if (text.length > PALETTE_IMPORT_LIMITS.maxBytes) {
        fail('LIMIT', 'palette file is larger than 1 MiB')
    }

    const lines = text.split(/\r\n|\r|\n/)
    if (lines.length > PALETTE_IMPORT_LIMITS.maxLines) {
        fail('LIMIT', 'palette file has too many lines')
    }

    const gimp = lines.length > 0 && GPL_SIGNATURE.test(lines[0]!)
    const colors: string[] = []
    let name = ''

    for (const [index, raw] of lines.entries()) {
        if (gimp && index === 0) continue

        const line = raw.trim()
        if (line.length === 0) continue

        if (gimp) {
            if (line.startsWith('#')) continue

            const header = GPL_HEADER.exec(line)
            if (header) {
                if (header[1] === 'Name') name = header[2] ?? ''
                continue
            }
        }

        const entry = GPL_ENTRY.exec(line)
        if (entry) {
            const channels = [entry[1], entry[2], entry[3]].map(Number)
            if (channels.some((channel) => channel > 255)) {
                fail('FORMAT', `channel out of range on line ${index + 1}`)
            }
            colors.push(toHex(channels as [number, number, number]))
        } else {
            const loose = LOOSE_HEX.exec(line.split(/[\s,;]+/)[0] ?? '')
            if (!loose) fail('FORMAT', `line ${index + 1} is not a colour`)
            colors.push(expandHex(loose[1]!, index + 1))
        }

        if (colors.length > PALETTE_MAX_COLORS) {
            fail('LIMIT', `a palette holds at most ${PALETTE_MAX_COLORS} colours`)
        }
    }

    if (colors.length === 0) fail('EMPTY', 'the file has no colours')

    return { name: normalizePaletteName(name) || normalizePaletteName(fallbackName), colors }
}

function expandHex(digits: string, line: number): string {
    const lower = digits.toLowerCase()
    const full =
        lower.length === 3 || lower.length === 4
            ? lower.replace(/./g, (digit) => digit + digit)
            : lower

    if (full.length !== 6 && full.length !== 8) fail('FORMAT', `line ${line} is not a colour`)
    return `#${full.length === 8 && full.endsWith('ff') ? full.slice(0, 6) : full}`
}

function toHex(channels: readonly [number, number, number]): string {
    return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function fail(code: PaletteImportErrorCode, detail: string): never {
    throw new PaletteImportError(code, detail)
}
