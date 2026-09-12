export interface RelayConfig {
    readonly port: number
    readonly origins: readonly string[]
    readonly dataDir: string
    readonly maxMessageBytes: number
    readonly maxMembers: number
}

export function loadConfig(env: NodeJS.ProcessEnv): RelayConfig {
    return {
        port: Number(env.PORT ?? 8131),
        origins: (env.ORIGINS ?? '')
            .split(',')
            .map((origin) => origin.trim())
            .filter((origin) => origin.length > 0),
        dataDir: env.DATA_DIR ?? './data',
        maxMessageBytes: 1024 * 1024,
        maxMembers: 16,
    }
}
