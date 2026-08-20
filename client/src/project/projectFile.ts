import {
    PROJECT_FILE_LIMITS,
    ProjectFileError,
    decodeProject,
    encodeProject,
    type DecodedProject,
    type ProjectEncodeInput,
    type Sha256Digest,
} from '@starforge/core'
import {
    browserDownloadEnvironment,
    downloadFile,
    type DownloadEnvironment,
    type DownloadFile,
} from '../export/download'
import { saveReplacementRecovery, type StoredDocument } from '../storage/localDoc'

export const STARFORGE_APP_VERSION = '0.1.0'
export const STARFORGE_FILE_ACCEPT = '.starforge,.png,application/json,image/png'

export type { DownloadEnvironment } from '../export/download'

export interface ProjectFileSource {
    readonly size: number
    arrayBuffer(): Promise<ArrayBuffer>
}

export type ProjectDownload = DownloadFile

export class ProjectRecoveryError extends Error {
    constructor() {
        super('the current project could not be secured before replacement')
        this.name = 'ProjectRecoveryError'
    }
}

export async function createProjectBlob(
    input: Omit<ProjectEncodeInput, 'appVersion'> & { appVersion?: string },
    digest: Sha256Digest = browserSha256,
): Promise<ProjectDownload> {
    const bytes = await encodeProject(
        { ...input, appVersion: input.appVersion ?? STARFORGE_APP_VERSION },
        digest,
    )
    return {
        blob: new Blob([bytes], { type: 'application/json' }),
        filename: projectFilename(input.sprite.meta.title),
    }
}

export async function readProjectBlob(
    source: ProjectFileSource,
    digest: Sha256Digest = browserSha256,
): Promise<DecodedProject> {
    if (!Number.isSafeInteger(source.size) || source.size < 0) {
        throw new ProjectFileError('FORMAT', 'file size is invalid')
    }
    if (source.size > PROJECT_FILE_LIMITS.maxBytes) {
        throw new ProjectFileError('LIMIT', 'project exceeds the 64 MiB file limit')
    }

    const buffer = await source.arrayBuffer()
    if (buffer.byteLength !== source.size) {
        throw new ProjectFileError('CORRUPTION', 'project changed while it was being read')
    }
    return decodeProject(new Uint8Array(buffer), digest)
}

export async function saveProjectFile(
    input: Omit<ProjectEncodeInput, 'appVersion'> & { appVersion?: string },
    environment: DownloadEnvironment = browserDownloadEnvironment(),
    digest: Sha256Digest = browserSha256,
): Promise<string> {
    const download = await createProjectBlob(input, digest)
    downloadProjectBlob(download, environment)
    return download.filename
}

export async function openProjectTransaction(
    source: ProjectFileSource,
    current: StoredDocument,
    replace: (project: DecodedProject) => void,
    options: {
        digest?: Sha256Digest
        preserveCurrent?: (document: StoredDocument) => boolean
    } = {},
): Promise<DecodedProject> {
    const project = await readProjectBlob(source, options.digest ?? browserSha256)
    const preserveCurrent = options.preserveCurrent ?? saveReplacementRecovery
    if (!preserveCurrent(current)) throw new ProjectRecoveryError()

    replace(project)
    return project
}

export function downloadProjectBlob(
    download: ProjectDownload,
    environment: DownloadEnvironment = browserDownloadEnvironment(),
): void {
    downloadFile(download, environment)
}

export function projectFilename(title: string): string {
    const stem = title
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
        .replace(/-+$/g, '')

    return `${stem || 'starforge'}.starforge`
}

export const browserSha256: Sha256Digest = async (bytes) => {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return new Uint8Array(digest)
}
