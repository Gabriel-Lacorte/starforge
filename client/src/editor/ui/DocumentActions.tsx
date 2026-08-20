import { useRef } from 'preact/hooks'
import { STARFORGE_FILE_ACCEPT } from '../../project/projectFile'
import {
    ExportIcon,
    FileIcon,
    KeysIcon,
    LibraryIcon,
    OpenIcon,
    PanelIcon,
    SaveIcon,
    SizeIcon,
} from './icons'
import styles from './Toolbar.module.css'
import { blurOnPointer } from './blurOnPointer'

export function DocumentActions({
    busy,
    exporting,
    layersOpen,
    onNew,
    onLibrary,
    onCanvasSize,
    onOpenProject,
    onSaveProject,
    onExport,
    onKeys,
    onToggleLayers,
}: {
    busy: boolean
    exporting: boolean
    layersOpen: boolean
    onNew: () => void
    onLibrary: () => void
    onCanvasSize: () => void
    onOpenProject: (file: File) => void
    onSaveProject: () => void
    onExport: () => void
    onKeys: () => void
    onToggleLayers: () => void
}) {
    const projectInput = useRef<HTMLInputElement>(null)
    const openButton = useRef<HTMLButtonElement>(null)

    return (
        <>
            <button
                type="button"
                class={styles.textBtn}
                title="Start a new sprite at any size"
                data-testid="new-sprite"
                disabled={busy}
                onClick={(e) => {
                    onNew()
                    blurOnPointer(e)
                }}
            >
                <FileIcon />
                New
            </button>
            <button
                type="button"
                class={styles.textBtn}
                title="Your drawings, kept in this browser"
                data-testid="library"
                disabled={busy}
                onClick={(e) => {
                    onLibrary()
                    blurOnPointer(e)
                }}
            >
                <LibraryIcon />
                Drawings<span aria-hidden="true">…</span>
            </button>
            <button
                type="button"
                class={styles.textBtn}
                title="Resize, scale or crop the canvas"
                data-testid="canvas-size"
                disabled={busy}
                onClick={(e) => {
                    onCanvasSize()
                    blurOnPointer(e)
                }}
            >
                <SizeIcon />
                Size<span aria-hidden="true">…</span>
            </button>
            <button
                ref={openButton}
                type="button"
                class={styles.textBtn}
                title="Open a Starforge project or Portable PNG"
                data-testid="open-project"
                disabled={busy}
                onClick={() => projectInput.current?.click()}
            >
                <OpenIcon />
                Open
            </button>
            <input
                ref={projectInput}
                class={styles.fileInput}
                type="file"
                accept={STARFORGE_FILE_ACCEPT}
                disabled={busy}
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    event.currentTarget.value = ''
                    if (file) onOpenProject(file)
                    openButton.current?.focus()
                }}
            />
            <button
                type="button"
                class={styles.textBtn}
                title="Save the editable project"
                data-testid="save-project"
                disabled={busy}
                onClick={onSaveProject}
            >
                <SaveIcon />
                Save
            </button>
            <button
                type="button"
                class={styles.textBtn}
                title="Choose a format and export"
                data-testid="export"
                disabled={exporting || busy}
                onClick={onExport}
            >
                <ExportIcon />
                Export<span aria-hidden="true">…</span>
            </button>
            <button
                type="button"
                class={styles.textBtn}
                title="Keys and gestures"
                data-testid="keys"
                onClick={(e) => {
                    onKeys()
                    blurOnPointer(e)
                }}
            >
                <KeysIcon />
                <span class={styles.wide}>Keys</span>
            </button>
            <button
                type="button"
                class={`${styles.textBtn}${layersOpen ? ` ${styles.on}` : ''}`}
                title={layersOpen ? 'Hide the layers panel' : 'Show the layers panel'}
                aria-expanded={layersOpen}
                aria-controls="layers-panel"
                data-testid="toggle-layers"
                onClick={(e) => {
                    onToggleLayers()
                    blurOnPointer(e)
                }}
            >
                <PanelIcon />
                <span class={styles.wide}>Layers</span>
            </button>
        </>
    )
}
