import {
    PORTABLE_PNG_LIMITS,
    PortablePngError,
    embedProjectInPng,
    encodeProject,
    type ProjectEncodeInput,
    type Sha256Digest,
} from '@starforge/core'
import { downloadFile, type DownloadEnvironment, type DownloadFile } from './download'
import { composeFrameCanvas } from './frame'
import { canvasPngBlob, portablePngFilename } from './png'
import { browserSha256, STARFORGE_APP_VERSION } from '../project/projectFile'

export async function createPortablePng(
    visualPng: Blob,
    input: Omit<ProjectEncodeInput, 'appVersion'> & { appVersion?: string },
    digest: Sha256Digest = browserSha256,
): Promise<DownloadFile> {
    if (visualPng.size > PORTABLE_PNG_LIMITS.maxPngBytes) {
        throw new PortablePngError('LIMIT', 'visual PNG exceeds the 96 MiB file limit')
    }

    const projectPromise = encodeProject(
        { ...input, appVersion: input.appVersion ?? STARFORGE_APP_VERSION },
        digest,
    )
    const [visualBuffer, project] = await Promise.all([visualPng.arrayBuffer(), projectPromise])
    if (visualBuffer.byteLength !== visualPng.size) {
        throw new PortablePngError('CORRUPTION', 'visual PNG changed while it was being read')
    }
    const bytes = await embedProjectInPng(new Uint8Array(visualBuffer), project, digest)

    return {
        blob: new Blob([bytes], { type: 'image/png' }),
        filename: portablePngFilename(input.sprite.meta.title),
    }
}

export async function exportPortablePng(
    input: Omit<ProjectEncodeInput, 'appVersion'> & { appVersion?: string },
    frameId: string,
    environment?: DownloadEnvironment,
    digest: Sha256Digest = browserSha256,
): Promise<string> {
    const visualPng = await canvasPngBlob(composeFrameCanvas(input.sprite, frameId))
    const file = await createPortablePng(visualPng, input, digest)
    downloadFile(file, environment)
    return file.filename
}
