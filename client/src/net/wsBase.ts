export function wsBase(origin: string, relay: string | null): string {
    if (relay !== null && relay.trim() !== '') {
        const trimmed = relay.trim()
        if (/^wss?:\/\//i.test(trimmed)) {
            try {
                const parsed = new URL(trimmed)
                if (parsed.pathname === '/' || parsed.pathname === '') {
                    return `${parsed.origin}/wire`
                }
            } catch {
                /* not parseable */
            }
            return trimmed
        }
        try {
            const parsed = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`)
            return `${parsed.protocol === 'https:' ? 'wss:' : 'ws:'}//${parsed.host}/wire`
        } catch {
            return trimmed
        }
    }
    return `${origin.replace(/^http/, 'ws')}/wire`
}

export function relayHttpBase(wsUrl: string): string {
    try {
        const parsed = new URL(wsUrl.trim())
        if (parsed.protocol === 'wss:') parsed.protocol = 'https:'
        else if (parsed.protocol === 'ws:') parsed.protocol = 'http:'
        return parsed.origin
    } catch {
        return wsUrl.trim()
    }
}
