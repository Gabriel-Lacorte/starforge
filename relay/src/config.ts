export interface RelayConfig {
    readonly port: number
    readonly origins: readonly string[]
    readonly dataDir: string
    readonly maxMessageBytes: number
    readonly maxMembers: number
    readonly roomsPerHour: number
}

export function loadConfig(env: NodeJS.ProcessEnv): RelayConfig {
    const roomsPerHour = Number(env.ROOMS_PER_HOUR ?? 20)
    return {
        port: Number(env.PORT ?? 8131),
        origins: (env.ORIGINS ?? '')
            .split(',')
            .map((origin) => origin.trim())
            .filter((origin) => origin.length > 0),
        dataDir: env.DATA_DIR ?? './data',
        maxMessageBytes: 1024 * 1024,
        maxMembers: 16,
        roomsPerHour:
            Number.isFinite(roomsPerHour) && roomsPerHour > 0 ? Math.floor(roomsPerHour) : 20,
    }
}
