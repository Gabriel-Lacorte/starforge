import {
    PORTABLE_PNG_LIMITS,
    PROJECT_FILE_LIMITS,
    PortablePngError,
    ProjectFileError,
    decodeProject,
    extractProjectFromPng,
    type DecodedProject,
    type Sha256Digest,
} from '@starforge/core'
import { saveReplacementRecovery, type StoredDocument } from '../storage/localDoc'
import { ProjectRecoveryError, browserSha256, type ProjectFileSource } from './projectFile'

export class PortableProjectMissingError extends Error {
    constructor() {
        super('valid PNG does not contain editable Starforge project data')
        this.name = 'PortableProjectMissingError'
    }
}

export async function readOpenProjectFile(
    source: ProjectFileSource,
    digest: Sha256Digest = browserSha256,
): Promise<DecodedProject> {
    if (!Number.isSafeInteger(source.size) || source.size < 0) {
        throw new ProjectFileError('FORMAT', 'file size is invalid')
    }
    if (source.size > PORTABLE_PNG_LIMITS.maxPngBytes) {
        throw new PortablePngError('LIMIT', 'portable PNG exceeds the 96 MiB file limit')
    }

    const buffer = await source.arrayBuffer()
    if (buffer.byteLength !== source.size) {
        throw new ProjectFileError('CORRUPTION', 'project changed while it was being read')
    }
    const bytes = new Uint8Array(buffer)

    if (hasPngSignature(bytes)) {
        const projectBytes = await extractProjectFromPng(bytes, digest)
        if (!projectBytes) throw new PortableProjectMissingError()
        return decodeProject(projectBytes, digest)
    }
    if (bytes.length > PROJECT_FILE_LIMITS.maxBytes) {
        throw new ProjectFileError('LIMIT', 'project exceeds the 64 MiB file limit')
    }
    return decodeProject(bytes, digest)
}

export async function openProjectFileTransaction(
    source: ProjectFileSource,
    current: StoredDocument,
    replace: (project: DecodedProject) => void,
    options: {
        digest?: Sha256Digest
        preserveCurrent?: (document: StoredDocument) => boolean
    } = {},
): Promise<DecodedProject> {
    const project = await readOpenProjectFile(source, options.digest ?? browserSha256)
    const preserveCurrent = options.preserveCurrent ?? saveReplacementRecovery
    if (!preserveCurrent(current)) throw new ProjectRecoveryError()

    replace(project)
    return project
}

function hasPngSignature(bytes: Uint8Array): boolean {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10]
    return signature.every((byte, index) => bytes[index] === byte)
}
