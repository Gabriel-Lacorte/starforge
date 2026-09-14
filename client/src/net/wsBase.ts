function isLoopbackHost(host: string): boolean {
    return (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '[::1]' ||
        host === '::1' ||
        host.endsWith('.localhost')
    )
}

function hostnameOf(value: string): string | null {
    try {
        return new URL(value).hostname.toLowerCase()
    } catch {
        return null
    }
}

export function wsBase(origin: string, relay: string | null): string {
    const fallback = `${origin.replace(/^http/, 'ws')}/wire`
    if (relay !== null && relay.trim() !== '') {
        const trimmed = relay.trim()

        const pageHost = hostnameOf(origin)
        if (pageHost === null) return fallback
        if (!isLoopbackHost(pageHost)) {
            const target = trimmed.includes('://') ? trimmed : `http://${trimmed}`
            const targetHost = hostnameOf(target)
            if (targetHost === null || targetHost !== pageHost) return fallback
        }

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

    return fallback
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
