import type { Sprite } from './doc'
import { SnapshotError, detectSnapshotVersion } from './migrations'
import { SNAPSHOT_VERSION, decodeSprite, encodeSprite } from './serial'

export const PROJECT_CONTAINER_VERSION = 1
export const PROJECT_FORMAT = 'starforge-project'

export const PROJECT_FILE_LIMITS = {
    maxBytes: 64 * 1024 * 1024,
    maxAppVersionBytes: 128,
    maxWorkspaceIdBytes: 256,
    maxCanonicalDepth: 32,
    maxCanonicalNodes: 1_000_000,
} as const

export type ProjectFileErrorCode = 'FORMAT' | 'VERSION' | 'LIMIT' | 'CHECKSUM' | 'CORRUPTION'

export class ProjectFileError extends Error {
    readonly code: ProjectFileErrorCode

    constructor(code: ProjectFileErrorCode, detail: string) {
        super(`invalid Starforge project [${code.toLowerCase()}]: ${detail}`)
        this.name = 'ProjectFileError'
        this.code = code
    }
}

export interface ProjectWorkspace {
    activeLayerId: string
    activeFrameId: string
}

export interface ProjectEnvelopeV1 {
    format: typeof PROJECT_FORMAT
    containerVersion: typeof PROJECT_CONTAINER_VERSION
    createdWith: {
        app: 'starforge'
        version: string
    }
    snapshotVersion: number
    snapshot: unknown
    workspace: ProjectWorkspace
    payloadSha256: string
}

export interface ProjectEncodeInput {
    sprite: Sprite
    workspace: ProjectWorkspace
    appVersion: string
}

export interface DecodedProject {
    sprite: Sprite
    workspace: ProjectWorkspace
    logicalHash: string
    createdWithVersion: string
}

export type Sha256Digest = (bytes: Uint8Array<ArrayBuffer>) => Promise<Uint8Array>

export async function encodeProject(
    input: ProjectEncodeInput,
    digest: Sha256Digest,
): Promise<Uint8Array<ArrayBuffer>> {
    const appVersion = limitedString(
        input.appVersion,
        'createdWith.version',
        PROJECT_FILE_LIMITS.maxAppVersionBytes,
        false,
    )
    const snapshot = encodeSprite(input.sprite)
    const workspace = resolveProjectWorkspace(input.sprite, input.workspace)
    const payload = { snapshotVersion: snapshot.v, snapshot, workspace }
    const payloadBytes = encodeUtf8(canonicalJson(payload))
    const payloadSha256 = `sha256-${toHex(await checkedDigest(digest, payloadBytes))}`

    const envelope: ProjectEnvelopeV1 = {
        format: PROJECT_FORMAT,
        containerVersion: PROJECT_CONTAINER_VERSION,
        createdWith: { app: 'starforge', version: appVersion },
        snapshotVersion: snapshot.v,
        snapshot,
        workspace,
        payloadSha256,
    }
    const bytes = encodeUtf8(canonicalJson(envelope))
    if (bytes.length > PROJECT_FILE_LIMITS.maxBytes) {
        projectFailure('LIMIT', 'project exceeds the 64 MiB file limit')
    }

    return bytes
}

export async function decodeProject(
    bytes: Uint8Array,
    digest: Sha256Digest,
): Promise<DecodedProject> {
    if (bytes.length === 0) projectFailure('FORMAT', 'project file is empty')
    if (bytes.length > PROJECT_FILE_LIMITS.maxBytes) {
        projectFailure('LIMIT', 'project exceeds the 64 MiB file limit')
    }

    const text = decodeUtf8(bytes)
    const root = asRecord(parseJson(text), 'project envelope')
    exactKeys(root, [
        'format',
        'containerVersion',
        'createdWith',
        'snapshotVersion',
        'snapshot',
        'workspace',
        'payloadSha256',
    ])
    if (canonicalJson(root) !== text) projectFailure('FORMAT', 'project envelope is not canonical')

    if (root.format !== PROJECT_FORMAT) projectFailure('FORMAT', 'unknown project signature')
    const containerVersion = integer(root.containerVersion, 'containerVersion')
    if (containerVersion !== PROJECT_CONTAINER_VERSION) {
        projectFailure('VERSION', `unsupported container version: ${containerVersion}`)
    }

    const createdWith = asRecord(root.createdWith, 'createdWith')
    exactKeys(createdWith, ['app', 'version'])
    if (createdWith.app !== 'starforge') projectFailure('FORMAT', 'unknown creating application')
    const createdWithVersion = limitedString(
        createdWith.version,
        'createdWith.version',
        PROJECT_FILE_LIMITS.maxAppVersionBytes,
        false,
    )

    const snapshotVersion = integer(root.snapshotVersion, 'snapshotVersion')
    if (snapshotVersion > SNAPSHOT_VERSION) {
        projectFailure('VERSION', `unsupported snapshot version: ${snapshotVersion}`)
    }

    const workspaceRecord = asRecord(root.workspace, 'workspace')
    exactKeys(workspaceRecord, ['activeLayerId', 'activeFrameId'])
    const requestedWorkspace = {
        activeLayerId: limitedString(
            workspaceRecord.activeLayerId,
            'workspace.activeLayerId',
            PROJECT_FILE_LIMITS.maxWorkspaceIdBytes,
            false,
        ),
        activeFrameId: limitedString(
            workspaceRecord.activeFrameId,
            'workspace.activeFrameId',
            PROJECT_FILE_LIMITS.maxWorkspaceIdBytes,
            false,
        ),
    }

    const expectedHash = limitedString(root.payloadSha256, 'payloadSha256', 71, false)
    if (!/^sha256-[0-9a-f]{64}$/.test(expectedHash)) {
        projectFailure('FORMAT', 'payloadSha256 is malformed')
    }

    const payloadBytes = encodeUtf8(
        canonicalJson({ snapshotVersion, snapshot: root.snapshot, workspace: requestedWorkspace }),
    )
    const actualHash = `sha256-${toHex(await checkedDigest(digest, payloadBytes))}`
    if (!constantTimeEqual(actualHash, expectedHash)) {
        projectFailure('CHECKSUM', 'payload checksum does not match')
    }

    let sprite: Sprite
    try {
        const detectedVersion = detectSnapshotVersion(root.snapshot)
        if (detectedVersion !== snapshotVersion) {
            projectFailure(
                'FORMAT',
                `declared snapshot version ${snapshotVersion} does not match ${detectedVersion}`,
            )
        }
        sprite = decodeSprite(root.snapshot)
    } catch (error) {
        if (error instanceof ProjectFileError) throw error
        if (error instanceof SnapshotError) projectFailure(error.code, error.message)
        throw error
    }

    if (
        snapshotVersion === SNAPSHOT_VERSION &&
        canonicalJson(root.snapshot) !== canonicalJson(encodeSprite(sprite))
    ) {
        projectFailure('FORMAT', 'snapshot is not canonical for its declared version')
    }

    return {
        sprite,
        workspace: resolveProjectWorkspace(sprite, requestedWorkspace),
        logicalHash: actualHash,
        createdWithVersion,
    }
}

export function resolveProjectWorkspace(
    sprite: Sprite,
    requested: Partial<ProjectWorkspace>,
): ProjectWorkspace {
    const activeLayerId = sprite.layers.some((layer) => layer.id === requested.activeLayerId)
        ? requested.activeLayerId!
        : sprite.layers.at(-1)!.id
    const activeFrameId = sprite.frames.some((frame) => frame.id === requested.activeFrameId)
        ? requested.activeFrameId!
        : sprite.frames[0]!.id

    return { activeLayerId, activeFrameId }
}

async function checkedDigest(
    digest: Sha256Digest,
    bytes: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array> {
    const result = await digest(bytes)
    if (!(result instanceof Uint8Array) || result.length !== 32) {
        projectFailure('CORRUPTION', 'SHA-256 provider returned an invalid digest')
    }
    return result
}

function canonicalJson(value: unknown): string {
    const parts: string[] = []
    const state = { nodes: 0 }

    const visit = (current: unknown, depth: number): void => {
        if (depth > PROJECT_FILE_LIMITS.maxCanonicalDepth) {
            projectFailure('LIMIT', 'project nesting is too deep')
        }
        state.nodes++
        if (state.nodes > PROJECT_FILE_LIMITS.maxCanonicalNodes) {
            projectFailure('LIMIT', 'project structure is too complex')
        }

        if (current === null) {
            parts.push('null')
            return
        }
        if (typeof current === 'string' || typeof current === 'boolean') {
            parts.push(JSON.stringify(current))
            return
        }
        if (typeof current === 'number') {
            if (!Number.isFinite(current))
                projectFailure('FORMAT', 'project contains a non-finite number')
            parts.push(JSON.stringify(current))
            return
        }
        if (typeof current !== 'object') {
            projectFailure('FORMAT', `project contains unsupported ${typeof current}`)
        }

        if (Array.isArray(current)) {
            const keys = Object.keys(current)
            if (keys.length !== current.length)
                projectFailure('FORMAT', 'project contains a sparse array')

            parts.push('[')
            for (let index = 0; index < current.length; index++) {
                if (index > 0) parts.push(',')
                visit(current[index], depth + 1)
            }
            parts.push(']')
            return
        }

        const record = asRecord(current, 'project value')
        const keys = Object.keys(record).sort()
        parts.push('{')
        for (const [index, key] of keys.entries()) {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
                projectFailure('FORMAT', `unsafe project field: ${key}`)
            }
            if (index > 0) parts.push(',')
            parts.push(JSON.stringify(key), ':')
            visit(record[key], depth + 1)
        }
        parts.push('}')
    }

    visit(value, 0)
    return parts.join('')
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text) as unknown
    } catch {
        projectFailure('FORMAT', 'project JSON is truncated or invalid')
    }
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
    const keys = Object.keys(record).sort()
    const wanted = [...expected].sort()
    if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
        projectFailure('FORMAT', 'project contains missing or unknown fields')
    }
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        projectFailure('FORMAT', `${what} is not an object`)
    }
    const prototype: unknown = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
        projectFailure('FORMAT', `${what} has an unsupported prototype`)
    }
    return value as Record<string, unknown>
}

function integer(value: unknown, what: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 1) {
        projectFailure('FORMAT', `${what} is not a positive integer`)
    }
    return value as number
}

function limitedString(
    value: unknown,
    what: string,
    maxBytes: number,
    allowEmpty: boolean,
): string {
    if (typeof value !== 'string') projectFailure('FORMAT', `${what} is not a string`)
    if (!allowEmpty && value.length === 0) projectFailure('FORMAT', `${what} is empty`)
    if (utf8Length(value, maxBytes) > maxBytes) {
        projectFailure('LIMIT', `${what} exceeds the byte limit of ${maxBytes}`)
    }
    return value
}

function encodeUtf8(value: string): Uint8Array<ArrayBuffer> {
    const length = utf8Length(value)
    const bytes = new Uint8Array(length)
    let out = 0

    for (let index = 0; index < value.length; index++) {
        let point = value.charCodeAt(index)
        if (point >= 0xd800 && point <= 0xdbff) {
            const next = value.charCodeAt(index + 1)
            if (next >= 0xdc00 && next <= 0xdfff) {
                point = 0x10000 + ((point - 0xd800) << 10) + (next - 0xdc00)
                index++
            }
        }

        if (point <= 0x7f) bytes[out++] = point
        else if (point <= 0x7ff) {
            bytes[out++] = 0xc0 | (point >>> 6)
            bytes[out++] = 0x80 | (point & 0x3f)
        } else if (point <= 0xffff) {
            bytes[out++] = 0xe0 | (point >>> 12)
            bytes[out++] = 0x80 | ((point >>> 6) & 0x3f)
            bytes[out++] = 0x80 | (point & 0x3f)
        } else {
            bytes[out++] = 0xf0 | (point >>> 18)
            bytes[out++] = 0x80 | ((point >>> 12) & 0x3f)
            bytes[out++] = 0x80 | ((point >>> 6) & 0x3f)
            bytes[out++] = 0x80 | (point & 0x3f)
        }
    }

    return bytes
}

function decodeUtf8(bytes: Uint8Array): string {
    const chunks: string[] = []
    let units: number[] = []
    let at = 0

    const push = (unit: number): void => {
        units.push(unit)
        if (units.length === 8_192) {
            chunks.push(String.fromCharCode(...units))
            units = []
        }
    }

    while (at < bytes.length) {
        const first = bytes[at++]!
        if (first <= 0x7f) {
            push(first)
            continue
        }

        let point: number
        let minimum: number
        let remaining: number
        if (first >= 0xc2 && first <= 0xdf) {
            point = first & 0x1f
            minimum = 0x80
            remaining = 1
        } else if (first >= 0xe0 && first <= 0xef) {
            point = first & 0x0f
            minimum = 0x800
            remaining = 2
        } else if (first >= 0xf0 && first <= 0xf4) {
            point = first & 0x07
            minimum = 0x10000
            remaining = 3
        } else projectFailure('CORRUPTION', 'project is not valid UTF-8')

        if (at + remaining > bytes.length)
            projectFailure('CORRUPTION', 'project UTF-8 is truncated')
        for (let index = 0; index < remaining; index++) {
            const continuation = bytes[at++]!
            if ((continuation & 0xc0) !== 0x80) {
                projectFailure('CORRUPTION', 'project is not valid UTF-8')
            }
            point = (point << 6) | (continuation & 0x3f)
        }

        if (point < minimum || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) {
            projectFailure('CORRUPTION', 'project is not canonical UTF-8')
        }
        if (point <= 0xffff) push(point)
        else {
            const adjusted = point - 0x10000
            push(0xd800 | (adjusted >>> 10))
            push(0xdc00 | (adjusted & 0x3ff))
        }
    }

    if (units.length > 0) chunks.push(String.fromCharCode(...units))
    return chunks.join('')
}

function utf8Length(value: string, stopAfter: number = Number.MAX_SAFE_INTEGER): number {
    let bytes = 0
    for (let index = 0; index < value.length; index++) {
        const unit = value.charCodeAt(index)
        if (unit <= 0x7f) bytes++
        else if (unit <= 0x7ff) bytes += 2
        else if (unit >= 0xd800 && unit <= 0xdbff) {
            const next = value.charCodeAt(index + 1)
            if (next >= 0xdc00 && next <= 0xdfff) {
                bytes += 4
                index++
            } else bytes += 3
        } else bytes += 3
        if (bytes > stopAfter) return bytes
    }
    return bytes
}

function toHex(bytes: Uint8Array): string {
    let hex = ''
    for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
    return hex
}

function constantTimeEqual(left: string, right: string): boolean {
    let difference = left.length ^ right.length
    const length = Math.max(left.length, right.length)
    for (let index = 0; index < length; index++) {
        difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
    }
    return difference === 0
}

function projectFailure(code: ProjectFileErrorCode, detail: string): never {
    throw new ProjectFileError(code, detail)
}
