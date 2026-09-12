export interface RoomProfile {
    nickname: string
    color: number
}

export const PROFILE_STORAGE_KEY = 'starforge.profile.v1'

export const DEFAULT_PROFILE_COLOR = 0xffcc33ff

type ProfileStorage = Pick<Storage, 'getItem' | 'setItem'>

function defaultNickname(): string {
    return `painter-${String(Math.floor(Math.random() * 9000) + 1000)}`
}

export function defaultProfile(): RoomProfile {
    return { nickname: defaultNickname(), color: DEFAULT_PROFILE_COLOR }
}

function resolveStorage(explicit?: ProfileStorage): ProfileStorage | undefined {
    if (explicit !== undefined) return explicit
    if (typeof localStorage === 'undefined') return undefined
    return localStorage
}

/** Reads the saved profile; empty, corrupt, or storage-less always yields defaults. */
export function loadProfile(storage: ProfileStorage | undefined = resolveStorage()): RoomProfile {
    const fallback = defaultProfile()
    const store = resolveStorage(storage)
    if (store === undefined) return fallback
    let raw: string | null
    try {
        raw = store.getItem(PROFILE_STORAGE_KEY)
    } catch {
        return fallback
    }
    if (raw === null) return fallback
    let parsed: unknown
    try {
        parsed = JSON.parse(raw) as unknown
    } catch {
        return fallback
    }
    if (typeof parsed !== 'object' || parsed === null) return fallback
    const record = parsed as Record<string, unknown>
    const nickname = record.nickname
    const color = record.color
    return {
        nickname:
            typeof nickname === 'string' && nickname.length > 0 ? nickname : fallback.nickname,
        color: typeof color === 'number' && Number.isFinite(color) ? color >>> 0 : fallback.color,
    }
}

export function saveProfile(
    profile: RoomProfile,
    storage: ProfileStorage | undefined = resolveStorage(),
): void {
    const store = resolveStorage(storage)
    if (store === undefined) return
    try {
        store.setItem(
            PROFILE_STORAGE_KEY,
            JSON.stringify({ nickname: profile.nickname, color: profile.color }),
        )
    } catch {
        /* not a crash */
    }
}
