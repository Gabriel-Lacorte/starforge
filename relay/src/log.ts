export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'off'

export type LogValue = string | number | boolean
export type LogFields = Readonly<Record<string, LogValue | undefined>>

const LEVEL_WEIGHT: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    off: Number.MAX_SAFE_INTEGER,
}

const SUPPRESS_AFTER = 5
const SUPPRESS_WINDOW_MS = 60_000
const SUPPRESS_KEYS_MAX = 512

export function parseLogLevel(raw: string | undefined): LogLevel {
    const value = (raw ?? '').trim().toLowerCase()
    if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') return value
    if (value === 'off') return 'off'
    return 'info'
}

export function hexHead(bytes: Uint8Array, max = 16): string {
    let out = ''
    const end = Math.min(bytes.length, max)
    for (let i = 0; i < end; i++) {
        if (i > 0) out += ' '
        out += bytes[i]!.toString(16).padStart(2, '0')
    }
    if (bytes.length > end) out += ` …(+${String(bytes.length - end)})`
    return out
}

function formatValue(value: LogValue): string {
    const text = String(value)
    if (/[\s"]/.test(text)) return `"${text.replaceAll('"', "'")}"`
    return text
}

interface SuppressionState {
    event: string
    windowStart: number
    emitted: number
    suppressed: number
    lastFields: LogFields
}

export interface LogOptions {
    readonly level?: LogLevel
    readonly write?: (line: string) => void
    readonly now?: () => number
}

export class RelayLog {
    private readonly weight: number
    private readonly write: (line: string) => void
    private readonly clock: () => number
    private readonly keys = new Map<string, SuppressionState>()

    constructor(opts: LogOptions = {}) {
        this.weight = LEVEL_WEIGHT[opts.level ?? parseLogLevel(process.env.LOG_LEVEL)]
        this.write = opts.write ?? ((line): void => console.log(line))
        this.clock = opts.now ?? ((): number => Date.now())
    }

    debug(event: string, fields?: LogFields, suppress?: string): void {
        this.emit('debug', event, fields, suppress)
    }

    info(event: string, fields?: LogFields, suppress?: string): void {
        this.emit('info', event, fields, suppress)
    }

    warn(event: string, fields?: LogFields, suppress?: string): void {
        this.emit('warn', event, fields, suppress)
    }

    error(event: string, fields?: LogFields, suppress?: string): void {
        this.emit('error', event, fields, suppress)
    }

    /** emit summaries for windows still holding suppressed repeats (shutdown) */
    flush(): void {
        for (const key of [...this.keys.keys()]) {
            this.summarize(key)
            this.keys.delete(key)
        }
    }

    private emit(
        level: LogLevel,
        event: string,
        fields: LogFields | undefined,
        suppress: string | undefined,
    ): void {
        if (LEVEL_WEIGHT[level] < this.weight) return
        const payload = fields ?? {}

        if (suppress === undefined) {
            this.line(level, event, payload)
            return
        }

        const now = this.clock()
        let state = this.keys.get(suppress)
        if (state === undefined) {
            if (this.keys.size >= SUPPRESS_KEYS_MAX) {
                const oldest = this.keys.keys().next().value
                if (oldest !== undefined) {
                    this.summarize(oldest)
                    this.keys.delete(oldest)
                }
            }
            state = { event, windowStart: now, emitted: 0, suppressed: 0, lastFields: payload }
            this.keys.set(suppress, state)
        }

        if (now - state.windowStart >= SUPPRESS_WINDOW_MS) {
            this.summarize(suppress)
            state = { event, windowStart: now, emitted: 0, suppressed: 0, lastFields: payload }
            this.keys.set(suppress, state)
        }

        state.lastFields = payload
        if (state.emitted < SUPPRESS_AFTER) {
            state.emitted += 1
            this.line(level, event, payload)
            return
        }
        state.suppressed += 1
    }

    private summarize(key: string): void {
        const state = this.keys.get(key)
        if (state === undefined || state.suppressed <= 0) return
        this.line('warn', `${state.event} repeated`, {
            ...state.lastFields,
            repeats: state.suppressed,
        })
        state.suppressed = 0
    }

    private line(level: LogLevel, event: string, fields: LogFields): void {
        let out = `relay ${level} ${event}`
        for (const [key, value] of Object.entries(fields)) {
            if (value === undefined) continue
            out += ` ${key}=${formatValue(value)}`
        }
        this.write(out)
    }
}

export const SILENT_LOG: RelayLog = new RelayLog({ level: 'off' })
