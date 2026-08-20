import type { Sprite } from '@starforge/core'
import type { PaletteController } from '../palette/paletteController'
import type { EditorStore } from '../store'
import type { LayersController } from '../layers/layersController'
import type { Library, LibraryEntry } from '../../storage/library'
import { CanvasSizeDialog, type CanvasSizeChoice } from './CanvasSizeDialog'
import { ColorStudio } from './ColorStudio'
import { ExportDialog, type ExportChoice } from './ExportDialog'
import { KeysDialog } from './KeysDialog'
import { LibraryDialog, type RecoveredDocument } from './LibraryDialog'
import { NewSpriteDialog } from './NewSpriteDialog'
import { PaletteDialog } from './PaletteDialog'

export type DialogId = 'new' | 'export' | 'studio' | 'palette' | 'size' | 'keys' | 'library'

export interface Shelf {
    readonly entries: readonly LibraryEntry[]
    readonly recoveries: readonly RecoveredDocument[]
}

export interface DialogHostProps {
    open: DialogId | null
    close: () => void

    sprite: Sprite
    store: EditorStore
    palette: PaletteController
    revision: LayersController

    library: Library | null
    shelf: Shelf | null

    canCrop: boolean
    onNew: (width: number, height: number, title: string) => void
    onExport: (choice: ExportChoice) => void
    onCanvasSize: (choice: CanvasSizeChoice) => void
    onCrop: () => void
    onImportPalette: (file: File) => void
    onOpenStored: (id: string) => void
    onDownloadRecovery: (id: string) => void
    onForgetRecovery: (id: string) => void
    onRemoveStored: (id: string) => void
}

export function DialogHost(props: DialogHostProps) {
    const { open, close, sprite, library, shelf } = props

    if (open === 'library') {
        if (!shelf || !library) return null

        return (
            <LibraryDialog
                entries={shelf.entries}
                recoveries={shelf.recoveries}
                openId={sprite.id}
                thumbnail={(id) => library.thumbnail(id)}
                onOpen={props.onOpenStored}
                onRemove={props.onRemoveStored}
                onDownloadRecovery={props.onDownloadRecovery}
                onForgetRecovery={props.onForgetRecovery}
                onClose={close}
            />
        )
    }

    if (open === 'size') {
        return (
            <CanvasSizeDialog
                current={{ width: sprite.width, height: sprite.height }}
                canCrop={props.canCrop}
                onApply={props.onCanvasSize}
                onCrop={props.onCrop}
                onCancel={close}
            />
        )
    }

    if (open === 'palette') {
        return (
            <PaletteDialog
                palette={props.palette}
                store={props.store}
                revision={props.revision}
                onImport={props.onImportPalette}
                onClose={close}
            />
        )
    }

    if (open === 'studio') {
        return (
            <ColorStudio
                store={props.store}
                palette={sprite.palette}
                layers={props.revision}
                onAddToPalette={(color) => props.palette.add(color)}
                onClose={close}
            />
        )
    }

    if (open === 'export') {
        return <ExportDialog title={sprite.meta.title} onExport={props.onExport} onCancel={close} />
    }

    if (open === 'keys') return <KeysDialog onClose={close} />

    if (open === 'new') {
        return (
            <NewSpriteDialog
                current={{
                    title: sprite.meta.title,
                    width: sprite.width,
                    height: sprite.height,
                }}
                onCreate={props.onNew}
                onCancel={close}
            />
        )
    }

    return null
}
