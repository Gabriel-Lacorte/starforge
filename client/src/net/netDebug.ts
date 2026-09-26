export type NetDebugValue = string | number | boolean
export interface NetDebugEntry {
    readonly at: number
    readonly event: string
    readonly fields?: Record<string, NetDebugValue>
}

const MAX_ENTRIES = 200
const entries: NetDebugEntry[] = []

let consoleEcho: boolean | null = null

export function netDebugEnabled(): boolean {
    try {
        if (typeof location !== 'undefined' && location.search.includes('debug')) return true
    } catch {
        /* SSR or test env */
    }
    try {
        if (typeof localStorage !== 'undefined')
            return localStorage.getItem('starforge:debug') === '1'
    } catch {
        /* private mode */
    }
    return false
}

export function netLog(event: string, fields?: Record<string, NetDebugValue>): void {
    entries.push({ at: Date.now(), event, ...(fields === undefined ? {} : { fields }) })
    if (entries.length > MAX_ENTRIES) entries.shift()

    consoleEcho ??= netDebugEnabled()
    if (consoleEcho) console.debug(`[net] ${event}`, fields ?? {})
}

function formatValue(value: NetDebugValue): string {
    const text = String(value)
    if (/[\s"]/.test(text)) return `"${text.replaceAll('"', "'")}"`
    return text
}

function stamp(at: number): string {
    const date = new Date(at)
    const ms = String(date.getMilliseconds()).padStart(3, '0')
    const hh = String(date.getHours()).padStart(2, '0')
    const mm = String(date.getMinutes()).padStart(2, '0')
    const ss = String(date.getSeconds()).padStart(2, '0')
    return `${hh}:${mm}:${ss}.${ms}`
}

export function netDebugEntries(): readonly NetDebugEntry[] {
    return entries
}

export function netDebugDump(): string {
    if (entries.length === 0) return 'starforge net: no events recorded'
    return entries
        .map((entry): string => {
            let out = `${stamp(entry.at)} ${entry.event}`
            for (const [key, value] of Object.entries(entry.fields ?? {})) {
                out += ` ${key}=${formatValue(value)}`
            }
            return out
        })
        .join('\n')
}

export function installNetDebugGlobal(): void {
    try {
        if (typeof window === 'undefined') return
        const host = window as { __starforgeNetDump?: () => string }
        if (host.__starforgeNetDump !== undefined) return
        host.__starforgeNetDump = netDebugDump
        if (netDebugEnabled()) {
            console.info(
                'starforge net debug is on: run copy(__starforgeNetDump()) and paste the result',
            )
        }
    } catch {
        /* never let diagnostics break the room */
    }
}
