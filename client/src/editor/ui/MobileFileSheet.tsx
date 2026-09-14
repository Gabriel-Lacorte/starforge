import type { TransformKind } from '@starforge/core'
import type { ReadoutStore } from '../readout'
import { DocumentActions } from './DocumentActions'
import { HistoryActions } from './HistoryActions'
import { MobileSheet } from './MobileSheet'
import styles from './MobileFileSheet.module.css'
import { useStore } from './useStore'

export function MobileFileSheet({
    readout,
    layersOpen,
    onClose,
    onHistory,
    onTransform,
    onNew,
    onLibrary,
    onCanvasSize,
    onOpenProject,
    onSaveProject,
    onExport,
    onKeys,
    shareBusy = false,
    onShare,
    onToggleLayers,
}: {
    readout: ReadoutStore
    layersOpen: boolean
    onClose: () => void
    onHistory: (direction: 'undo' | 'redo') => void
    onTransform: (kind: TransformKind) => void
    onNew: () => void
    onLibrary: () => void
    onCanvasSize: () => void
    onOpenProject: (file: File) => void
    onSaveProject: () => void
    onExport: () => void
    onKeys: () => void
    shareBusy?: boolean
    onShare?: () => void
    onToggleLayers: () => void
}) {
    const { canUndo, canRedo, exportState, projectNotice } = useStore(readout)
    const busy = projectNotice?.phase === 'working'

    return (
        <MobileSheet title="File" onClose={onClose}>
            <div class={styles.iconRow}>
                <HistoryActions
                    canUndo={canUndo}
                    canRedo={canRedo}
                    onHistory={onHistory}
                    onTransform={onTransform}
                />
            </div>
            <DocumentActions
                busy={busy}
                exporting={exportState === 'working'}
                layersOpen={layersOpen}
                shareBusy={shareBusy}
                hideKeys
                onNew={onNew}
                onLibrary={onLibrary}
                onCanvasSize={onCanvasSize}
                onOpenProject={onOpenProject}
                onSaveProject={onSaveProject}
                onExport={onExport}
                onKeys={onKeys}
                onShare={onShare}
                onToggleLayers={onToggleLayers}
            />
        </MobileSheet>
    )
}
