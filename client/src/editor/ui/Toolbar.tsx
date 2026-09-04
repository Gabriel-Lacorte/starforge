import type { TransformKind } from '@starforge/core'
import type { ReadoutStore } from '../readout'
import type { EditorStore } from '../store'
import { DocumentActions } from './DocumentActions'
import { HistoryActions } from './HistoryActions'
import { ToolButtons } from './ToolButtons'
import { ToolOptions } from './ToolOptions'
import { useStore } from './useStore'
import styles from './Toolbar.module.css'

export function Toolbar({
    store,
    readout,
    compact,
    layersOpen,
    hideFileActions = false,
    onNew,
    onOpenProject,
    onSaveProject,
    onExport,
    onToggleLayers,
    onKeys,
    onHistory,
    onTransform,
    onCanvasSize,
    onLibrary,
}: {
    store: EditorStore
    readout: ReadoutStore
    compact: boolean
    layersOpen: boolean
    hideFileActions?: boolean
    onNew: () => void
    onOpenProject: (file: File) => void
    onSaveProject: () => void
    onExport: () => void
    onToggleLayers: () => void
    onKeys: () => void
    onHistory: (direction: 'undo' | 'redo') => void
    onTransform: (kind: TransformKind) => void
    onCanvasSize: () => void
    onLibrary: () => void
}) {
    const tool = useStore(store).tool
    const { canUndo, canRedo, exportState, projectNotice } = useStore(readout)
    const busy = projectNotice?.phase === 'working'

    return (
        <div class={`bar ${styles.toolbar}`}>
            <ToolButtons
                tool={tool}
                onPick={(id) => {
                    store.patch({ tool: id })
                }}
            />
            {!compact && <ToolOptions store={store} />}

            {!compact && (
                <span class={styles.fileGroup} aria-busy={busy}>
                    <HistoryActions
                        canUndo={canUndo}
                        canRedo={canRedo}
                        onHistory={onHistory}
                        onTransform={onTransform}
                    />
                    {!hideFileActions && (
                        <>
                            <span class={styles.sep} />
                            <DocumentActions
                                busy={busy}
                                exporting={exportState === 'working'}
                                layersOpen={layersOpen}
                                onNew={onNew}
                                onLibrary={onLibrary}
                                onCanvasSize={onCanvasSize}
                                onOpenProject={onOpenProject}
                                onSaveProject={onSaveProject}
                                onExport={onExport}
                                onKeys={onKeys}
                                onToggleLayers={onToggleLayers}
                            />
                        </>
                    )}
                </span>
            )}
        </div>
    )
}
