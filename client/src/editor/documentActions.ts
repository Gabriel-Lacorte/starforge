import { parsePalette, type DecodedProject, type Sprite } from '@starforge/core'
import type { DocumentSession } from '../document/session'
import { downloadFile } from '../export/download'
import { exportGif, exportSpritesheet, type GifScale } from '../export/gif'
import { exportFramePng } from '../export/png'
import { exportPortablePng } from '../export/portablePng'
import { openProjectFileTransaction } from '../project/openPortablePng'
import { saveProjectFile } from '../project/projectFile'
import type { Library } from '../storage/library'
import type { PaletteController } from './palette/paletteController'
import { paletteFailureNotice, projectFailureNotice, safeFilename } from './projectNotices'
import type { ProjectNotice, ReadoutStore } from './readout'
import type { Notice } from './ui/useNotice'

export interface DocumentActionDeps {
    readonly sprite: Sprite
    readonly session: DocumentSession
    readonly palette: PaletteController
    readonly readout: ReadoutStore
    readonly exportNotice: Notice
    readonly projectNotice: Notice
    readonly onOpenProject: (project: DecodedProject, notice: ProjectNotice) => void
}

export interface DocumentActions {
    exportPng(): void
    exportPortable(): void
    exportGif(scale: GifScale, loop: boolean): void
    exportSpritesheet(scale: GifScale): void
    saveProject(): void
    openProjectFile(file: File): void
    importPalette(file: File): void
    downloadRecovery(library: Library, id: string): void
}

export function createDocumentActions(deps: DocumentActionDeps): DocumentActions {
    const { sprite, session, palette, readout, exportNotice, projectNotice } = deps

    let exporting = false
    let working = false

    const readable = () => sprite.layers.length > 0 && sprite.frames.length > 0
    const frame = () => session.target.state.frame
    const workspace = () => ({
        sprite,
        workspace: {
            activeLayerId: session.target.state.layer,
            activeFrameId: frame(),
        },
    })

    const show = (notice: ProjectNotice): void => {
        readout.patch({ projectNotice: notice })

        if (notice.phase === 'working') projectNotice.hold()
        else projectNotice.fade(() => readout.patch({ projectNotice: null }))
    }

    const settle = (): void => {
        working = false
    }

    return {
        exportPng() {
            if (exporting || working || !readable()) return
            exporting = true

            exportNotice.hold()
            readout.patch({ exportState: 'working' })

            void exportFramePng(sprite, frame())
                .then(() => {
                    readout.patch({ exportState: 'done' })
                })
                .catch((reason: unknown) => {
                    console.error('export failed', reason)
                    readout.patch({ exportState: 'failed' })
                })
                .finally(() => {
                    exporting = false
                    exportNotice.fade(() => readout.patch({ exportState: null }))
                })
        },

        exportPortable() {
            if (working || exporting || !readable()) return
            working = true
            show({
                phase: 'working',
                label: 'exporting portable PNG',
                detail: 'Building the poster and its editable Starforge project',
            })

            void exportPortablePng(workspace(), frame())
                .then((filename) => {
                    show({
                        phase: 'success',
                        label: 'portable PNG exported',
                        detail: `Portable PNG exported: ${filename}. Keep the .starforge file as your master copy.`,
                    })
                })
                .catch((error: unknown) => {
                    show(projectFailureNotice(error, 'portable'))
                })
                .finally(settle)
        },

        exportGif(scale, loop) {
            if (exporting || working || !readable()) return
            exporting = true

            exportNotice.hold()
            readout.patch({ exportState: 'working' })

            void exportGif(sprite, scale, loop)
                .then(() => {
                    readout.patch({ exportState: 'done' })
                })
                .catch((error: unknown) => {
                    console.error('GIF export failed', error)
                    readout.patch({ exportState: 'failed' })
                })
                .finally(() => {
                    exporting = false
                    exportNotice.fade(() => readout.patch({ exportState: null }))
                })
        },

        exportSpritesheet(scale) {
            if (exporting || working || !readable()) return
            exporting = true

            exportNotice.hold()
            readout.patch({ exportState: 'working' })

            void exportSpritesheet(sprite, scale)
                .then(() => {
                    readout.patch({ exportState: 'done' })
                })
                .catch((reason: unknown) => {
                    console.error('spritesheet export failed', reason)
                    readout.patch({ exportState: 'failed' })
                })
                .finally(() => {
                    exporting = false
                    exportNotice.fade(() => readout.patch({ exportState: null }))
                })
        },

        saveProject() {
            if (working) return
            working = true
            show({
                phase: 'working',
                label: 'saving project',
                detail: 'Building the editable Starforge project',
            })

            void saveProjectFile(workspace())
                .then((filename) => {
                    show({
                        phase: 'success',
                        label: 'project saved',
                        detail: `Project saved: ${filename}`,
                    })
                })
                .catch((error: unknown) => {
                    show(projectFailureNotice(error, 'save'))
                })
                .finally(settle)
        },

        openProjectFile(file) {
            if (working) return
            working = true
            show({
                phase: 'working',
                label: 'opening project',
                detail: 'Validating the project before replacing the current document',
            })

            void openProjectFileTransaction(
                file,
                { sprite, activeLayer: session.target.state.layer },
                (project) => {
                    deps.onOpenProject(project, {
                        phase: 'success',
                        label: 'project opened',
                        detail: `Project opened: ${safeFilename(file.name)}`,
                    })
                },
            )
                .catch((error: unknown) => {
                    show(projectFailureNotice(error, 'open'))
                })
                .finally(settle)
        },

        importPalette(file) {
            show({
                phase: 'working',
                label: 'importing palette',
                detail: 'Reading the palette before replacing the current one',
            })

            file.text()
                .then((text) => {
                    palette.replace(parsePalette(text, file.name.replace(/\.[^.]+$/, '')))
                    show({
                        phase: 'success',
                        label: 'palette imported',
                        detail: `Palette imported from ${safeFilename(file.name)}. Undo puts the old one back.`,
                    })
                })
                .catch((error: unknown) => {
                    show(paletteFailureNotice(error))
                })
        },

        downloadRecovery(library, id) {
            void library.recoveryFile(id).then((blob) => {
                if (blob) downloadFile({ blob, filename: `${safeFilename(id)}.recovery.json` })
            })
        },
    }
}
