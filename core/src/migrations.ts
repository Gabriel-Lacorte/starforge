export const CURRENT_SNAPSHOT_VERSION = 1

export type SnapshotErrorCode = 'FORMAT' | 'VERSION' | 'LIMIT' | 'CORRUPTION'

export class SnapshotError extends Error {
    readonly code: SnapshotErrorCode

    constructor(code: SnapshotErrorCode, detail: string) {
        super(`invalid sprite snapshot [${code.toLowerCase()}]: ${detail}`)
        this.name = 'SnapshotError'
        this.code = code
    }
}

export function detectSnapshotVersion(value: unknown): number {
    const root = snapshotObject(value, 'snapshot')
    const descriptor = Object.getOwnPropertyDescriptor(root, 'v')
    if (!descriptor) snapshotFailure('VERSION', 'missing version')
    if (!Object.hasOwn(descriptor, 'value')) {
        snapshotFailure('FORMAT', 'snapshot version is not plain data')
    }

    const version: unknown = descriptor.value
    if (!Number.isSafeInteger(version) || (version as number) < 1) {
        snapshotFailure('VERSION', `unsupported version: ${JSON.stringify(version)}`)
    }

    return version as number
}

type Migration = (value: unknown) => unknown

const MIGRATIONS: ReadonlyMap<number, Migration> = new Map()

export function migrateSnapshot(
    value: unknown,
    targetVersion: number = CURRENT_SNAPSHOT_VERSION,
): unknown {
    if (!Number.isSafeInteger(targetVersion) || targetVersion < 1) {
        snapshotFailure('VERSION', `invalid target version: ${JSON.stringify(targetVersion)}`)
    }

    let version = detectSnapshotVersion(value)
    if (version > targetVersion) {
        snapshotFailure('VERSION', `unsupported version: ${version} (future)`)
    }

    let migrated = cloneSnapshotValue(value)
    while (version < targetVersion) {
        const migration = MIGRATIONS.get(version)
        if (!migration) snapshotFailure('VERSION', `no migration from version ${version}`)

        migrated = migration(migrated)
        const nextVersion = detectSnapshotVersion(migrated)
        if (nextVersion !== version + 1) {
            snapshotFailure(
                'CORRUPTION',
                `migration ${version} produced version ${nextVersion} instead of ${version + 1}`,
            )
        }
        version = nextVersion
    }

    return migrated
}

interface CloneState {
    readonly seen: WeakSet<object>
    nodes: number
    stringUnits: number
}

const MAX_CLONE_DEPTH = 32
const MAX_CLONE_NODES = 100_000
const MAX_CLONE_ARRAY_LENGTH = 65_536
const MAX_CLONE_OBJECT_KEYS = 64
const MAX_CLONE_STRING_UNITS = 256 * 1024 * 1024

function cloneSnapshotValue(value: unknown): unknown {
    return cloneJsonValue(value, { seen: new WeakSet(), nodes: 0, stringUnits: 0 }, 0)
}

function cloneJsonValue(value: unknown, state: CloneState, depth: number): unknown {
    if (value === null || typeof value === 'boolean') return value

    if (typeof value === 'string') {
        state.stringUnits += value.length
        if (state.stringUnits > MAX_CLONE_STRING_UNITS) {
            snapshotFailure('LIMIT', 'snapshot strings exceed the migration limit')
        }
        return value
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            snapshotFailure('FORMAT', 'snapshot contains a non-finite number')
        return value
    }

    if (typeof value !== 'object') {
        snapshotFailure('FORMAT', `snapshot contains unsupported ${typeof value}`)
    }
    if (depth > MAX_CLONE_DEPTH) snapshotFailure('LIMIT', 'snapshot nesting is too deep')
    if (state.seen.has(value)) snapshotFailure('FORMAT', 'snapshot contains a cycle')

    state.seen.add(value)
    state.nodes++
    if (state.nodes > MAX_CLONE_NODES) snapshotFailure('LIMIT', 'snapshot is too complex')

    if (Array.isArray(value)) {
        if (value.length > MAX_CLONE_ARRAY_LENGTH) {
            snapshotFailure('LIMIT', 'snapshot array is too large')
        }
        return value.map((entry) => cloneJsonValue(entry, state, depth + 1))
    }

    const source = snapshotObject(value, 'snapshot value')
    if (Object.getOwnPropertySymbols(source).length !== 0) {
        snapshotFailure('FORMAT', 'snapshot contains symbol keys')
    }

    const keys = Object.keys(source)
    if (keys.length > MAX_CLONE_OBJECT_KEYS) {
        snapshotFailure('LIMIT', 'snapshot object has too many fields')
    }

    const copy: Record<string, unknown> = {}
    for (const key of keys) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            snapshotFailure('FORMAT', `unsafe field: ${key}`)
        }

        const descriptor = Object.getOwnPropertyDescriptor(source, key)
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            snapshotFailure('FORMAT', `snapshot field is not plain data: ${key}`)
        }
        copy[key] = cloneJsonValue(descriptor.value, state, depth + 1)
    }

    return copy
}

export function snapshotFailure(code: SnapshotErrorCode, detail: string): never {
    throw new SnapshotError(code, detail)
}

function snapshotObject(value: unknown, detail: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        snapshotFailure('FORMAT', `${detail} is not an object`)
    }

    const prototype: unknown = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
        snapshotFailure('FORMAT', `${detail} has an unsupported prototype`)
    }

    return value as Record<string, unknown>
}
