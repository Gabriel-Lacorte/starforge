import type { ReadoutStore } from '../readout'
import type { EditorStore } from '../store'
import { ZOOM_LEVELS } from '../view'
import {
    FileIcon,
    KeysIcon,
    PanelIcon,
    PlayIcon,
    PlusIcon,
    RedoIcon,
    TOOL_ICON,
    UndoIcon,
} from './icons'
import { blurOnPointer } from './blurOnPointer'
import { useStore } from './useStore'
import styles from './MobileActions.module.css'

const ZOOM_MIN = ZOOM_LEVELS[0]
const ZOOM_MAX = ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!

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
    onZoom,
    onKeys,
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
    onZoom: (direction: 1 | -1) => void
    onKeys: () => void
}) {
    const state = useStore(store)
    const { canUndo, canRedo, zoom } = useStore(readout)
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
                aria-label="Zoom out"
                data-testid="mobile-zoom-out"
                disabled={zoom <= ZOOM_MIN}
                onClick={(e) => {
                    onZoom(-1)
                    blurOnPointer(e)
                }}
            >
                -
            </button>
            <button
                type="button"
                class={styles.btn}
                aria-label="Zoom in"
                data-testid="mobile-zoom-in"
                disabled={zoom >= ZOOM_MAX}
                onClick={(e) => {
                    onZoom(1)
                    blurOnPointer(e)
                }}
            >
                <PlusIcon />
            </button>
            <button
                type="button"
                class={styles.btn}
                aria-label="Keys and gestures"
                data-testid="mobile-keys"
                onClick={(e) => {
                    onKeys()
                    blurOnPointer(e)
                }}
            >
                <KeysIcon />
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
