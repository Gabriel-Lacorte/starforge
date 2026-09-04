import type { ReadoutStore } from '../readout'
import type { EditorStore } from '../store'
import { FileIcon, PanelIcon, PlayIcon, RedoIcon, TOOL_ICON, UndoIcon } from './icons'
import { blurOnPointer } from './blurOnPointer'
import { useStore } from './useStore'
import styles from './MobileActions.module.css'

export function MobileActions({
    store,
    readout,
    layersOpen,
    framesOpen,
    onToolOptions,
    onFrames,
    onFile,
    onToggleLayers,
    onHistory,
}: {
    store: EditorStore
    readout: ReadoutStore
    layersOpen: boolean
    framesOpen: boolean
    onToolOptions: () => void
    onFrames: () => void
    onFile: () => void
    onToggleLayers: () => void
    onHistory: (direction: 'undo' | 'redo') => void
}) {
    const state = useStore(store)
    const { canUndo, canRedo } = useStore(readout)
    const ToolIcon = TOOL_ICON[state.tool]

    return (
        <div class={`bar ${styles.actions}`}>
            <button
                type="button"
                class={`${styles.btn} ${styles.tool}`}
                title={`${state.tool} options`}
                aria-label={`${state.tool} options`}
                data-testid="mobile-tool-options"
                onClick={onToolOptions}
            >
                <ToolIcon />
            </button>
            <button
                type="button"
                class={styles.btn}
                aria-label="Undo"
                data-testid="mobile-undo"
                disabled={!canUndo}
                onClick={(e) => {
                    onHistory('undo')
                    blurOnPointer(e)
                }}
            >
                <UndoIcon />
            </button>
            <button
                type="button"
                class={styles.btn}
                aria-label="Redo"
                data-testid="mobile-redo"
                disabled={!canRedo}
                onClick={(e) => {
                    onHistory('redo')
                    blurOnPointer(e)
                }}
            >
                <RedoIcon />
            </button>
            <button
                type="button"
                class={`${styles.btn}${layersOpen ? ` ${styles.on}` : ''}`}
                aria-label={layersOpen ? 'Hide the layers panel' : 'Show the layers panel'}
                aria-expanded={layersOpen}
                data-testid="mobile-layers"
                onClick={(e) => {
                    onToggleLayers()
                    blurOnPointer(e)
                }}
            >
                <PanelIcon />
            </button>
            <button
                type="button"
                class={`${styles.btn}${framesOpen ? ` ${styles.on}` : ''}`}
                aria-label="Frames and playback"
                aria-expanded={framesOpen}
                data-testid="mobile-frames"
                onClick={onFrames}
            >
                <PlayIcon />
            </button>
            <button
                type="button"
                class={styles.btn}
                aria-label="File actions"
                data-testid="mobile-file"
                onClick={onFile}
            >
                <FileIcon />
            </button>
        </div>
    )
}
