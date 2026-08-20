import {
    PaletteImportError,
    PortablePngError,
    ProjectFileError,
    type PaletteImportErrorCode,
} from '@starforge/core'
import type { ProjectNotice } from './readout'
import { ProjectRecoveryError } from '../project/projectFile'
import { PortableProjectMissingError } from '../project/openPortablePng'

export type ProjectAction = 'open' | 'save' | 'portable'

const LABELS: Readonly<Record<ProjectAction, string>> = {
    open: 'project not opened',
    save: 'project not saved',
    portable: 'portable PNG not exported',
}

const FALLBACKS: Readonly<Record<ProjectAction, string>> = {
    open: 'The browser could not open this project. The current document is unchanged.',
    save: 'The browser could not save this project. Try Export PNG before leaving.',
    portable: 'The browser could not export the Portable PNG. Save the .starforge project instead.',
}

export function projectFailureNotice(error: unknown, action: ProjectAction): ProjectNotice {
    const label = LABELS[action]
    const notice = (detail: string): ProjectNotice => ({ phase: 'error', label, detail })

    if (error instanceof ProjectRecoveryError) {
        return notice('Current work could not be secured. Save it before opening another project.')
    }
    if (error instanceof ProjectFileError) {
        if (error.code === 'LIMIT') {
            return notice('This file is larger than Starforge can safely handle.')
        }
        if (error.code === 'VERSION') return notice('This project needs a newer Starforge version.')
        if (action === 'open') return notice('This project is damaged and was not opened.')
    }
    if (error instanceof PortableProjectMissingError) {
        return notice(
            'This is a valid image, but it has no editable Starforge data. The project data may have been removed.',
        )
    }
    if (error instanceof PortablePngError) {
        if (error.code === 'LIMIT') {
            return notice('This file is larger than Starforge can safely handle.')
        }
        if (error.code === 'VERSION') {
            return notice('This Portable PNG needs a newer Starforge version.')
        }
        if (action === 'open') return notice('This Portable PNG is damaged and was not opened.')
    }

    return notice(FALLBACKS[action])
}

export function paletteFailureNotice(error: unknown): ProjectNotice {
    return {
        phase: 'error',
        label: 'palette not imported',
        detail:
            error instanceof PaletteImportError
                ? `${paletteFailure(error.code)} The palette is unchanged.`
                : 'The browser could not read this file. The palette is unchanged.',
    }
}

function paletteFailure(code: PaletteImportErrorCode): string {
    if (code === 'LIMIT') return 'This palette file is larger than Starforge can handle.'
    if (code === 'EMPTY') return 'This file has no colours in it.'
    return 'Starforge could not read this as a palette.'
}

const UNSAFE_FILENAME_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

export function safeFilename(value: string): string {
    const safe = value.replace(UNSAFE_FILENAME_CHARACTERS, ' ').replace(/\s+/g, ' ').trim()
    return safe.slice(0, 120) || 'project.starforge'
}
