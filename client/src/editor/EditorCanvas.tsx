import type { DecodedProject, Sprite } from '@starforge/core'
import { useErrorBoundary, useEffect, useRef, useState } from 'preact/hooks'
import { DocumentSession } from '../document/session'
import { startAutosave } from '../storage/autosave'
import type { Library, OpenedDocument } from '../storage/library'
import { createDocumentActions, type DocumentActions } from './documentActions'
import { startEditor, type EditorHandle } from './engine'
import { FramesController } from './frames/framesController'
import { PlaybackController } from './frames/playbackController'
import { LayersController } from './layers/layersController'
import { PaletteController } from './palette/paletteController'
import { ReadoutStore, type ProjectNotice } from './readout'
import { EditorStore } from './store'
import { DialogHost, type DialogId, type Shelf } from './ui/DialogHost'
import { EditorCrash } from './ui/EditorCrash'
import { LayersPanel } from './ui/LayersPanel'
import { MobileActions } from './ui/MobileActions'
import { MobileFileSheet } from './ui/MobileFileSheet'
import { MobileSheet } from './ui/MobileSheet'
import { PaintControls } from './ui/PaintControls'
import { StatusBar } from './ui/StatusBar'
import { Timeline } from './ui/Timeline'
import { ToolOptions } from './ui/ToolOptions'
import { Toolbar } from './ui/Toolbar'
import { COMPACT_QUERY, useMobile } from './ui/useMobile'
import { useFocusReturn } from './ui/useFocusReturn'
import { useNotice } from './ui/useNotice'
import { FirstVisitHint } from './ui/FirstVisitHint'
import styles from './EditorCanvas.module.css'

const NOTICE_MS = 4000
const LABEL_MAX = 80
const DEFAULT_NEW = 64

export function EditorCanvas({
    sprite,
    session: providedSession,
    active = true,
    library,
    storageNotice,
    initialLayer,
    initialFrame,
    initialProjectNotice,
    initialLayersOpen,
    hideFileActions = false,
    onNew,
    onOpenStored,
    onOpenProject,
}: {
    sprite: Sprite
    session?: DocumentSession
    active?: boolean
    library: Library | null
    storageNotice: string | null
    initialLayer?: string
    initialFrame: string
    initialProjectNotice: ProjectNotice | null
    initialLayersOpen?: boolean
    hideFileActions?: boolean
    onNew: (width: number, height: number, title: string) => void
    onOpenStored: (document: OpenedDocument) => void
    onOpenProject: (project: DecodedProject, notice: ProjectNotice) => void
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const overlayRef = useRef<HTMLCanvasElement>(null)
    const activeRef = useRef(active)
    activeRef.current = active

    const sessionRef = useRef<DocumentSession | null>(null)
    const storeRef = useRef<EditorStore | null>(null)
    const readoutRef = useRef<ReadoutStore | null>(null)
    const layersRef = useRef<LayersController | null>(null)
    const paletteRef = useRef<PaletteController | null>(null)
    const framesRef = useRef<FramesController | null>(null)
    const playbackRef = useRef<PlaybackController | null>(null)
    const actionsRef = useRef<DocumentActions | null>(null)

    sessionRef.current ??=
        providedSession ??
        new DocumentSession(sprite, {
            target: { layer: initialLayer, frame: initialFrame },
        })
    storeRef.current ??= new EditorStore()
    readoutRef.current ??= new ReadoutStore(initialProjectNotice ?? null)

    const session = sessionRef.current
    const store = storeRef.current
    const readout = readoutRef.current

    layersRef.current ??= new LayersController(sprite, session)
    paletteRef.current ??= new PaletteController(sprite, session)
    framesRef.current ??= new FramesController(sprite, session)
    playbackRef.current ??= new PlaybackController(sprite, session)

    const layers = layersRef.current
    const palette = paletteRef.current
    const frames = framesRef.current
    const playback = playbackRef.current

    const [layersOpen, setLayersOpen] = useState(
        () => initialLayersOpen ?? !window.matchMedia(COMPACT_QUERY).matches,
    )
    const [dialog, setDialog] = useState<DialogId | null>(null)
    const [sheet, setSheet] = useState<'options' | 'frames' | 'file' | null>(null)
    const mobile = useMobile()
    const [shelf, setShelf] = useState<Shelf | null>(null)

    const [geometry, setGeometry] = useState(`${sprite.width}x${sprite.height}`)
    const layersChosen = useRef(false)

    const editorRef = useRef<EditorHandle | null>(null)
    const [crash, resetCrash] = useErrorBoundary() as [unknown, () => void]
    const readable = sprite.layers.length > 0 && sprite.frames.length > 0

    const rememberDialogFocus = useFocusReturn(dialog)
    const rememberPanelFocus = useFocusReturn(layersOpen)

    const exportNotice = useNotice(NOTICE_MS)
    const projectNotice = useNotice(NOTICE_MS)

    const openProjectRef = useRef(onOpenProject)
    openProjectRef.current = onOpenProject

    actionsRef.current ??= createDocumentActions({
        sprite,
        session,
        palette,
        readout,
        exportNotice,
        projectNotice,
        onOpenProject: (project, notice) => openProjectRef.current(project, notice),
    })
    const actions = actionsRef.current

    const show = (next: DialogId) => {
        rememberDialogFocus()
        setDialog(next)
    }
    const closeDialog = () => {
        setDialog(null)
    }

    useEffect(() => {
        if (crash || !readable) return

        const canvas = canvasRef.current
        const overlay = overlayRef.current
        if (!canvas || !overlay) return

        const editor = startEditor(
            canvas,
            overlay,
            session,
            store,
            readout,
            layers,
            playback,
            () => activeRef.current,
        )
        editorRef.current = editor

        return () => {
            editorRef.current = null
            editor.dispose()
        }
    }, [session, store, readout, layers, playback, crash, readable, geometry])

    useEffect(() => {
        if (!initialProjectNotice || initialProjectNotice.phase === 'working') return

        projectNotice.fade(() => readout.patch({ projectNotice: null }))
    }, [initialProjectNotice, readout])

    useEffect(() => {
        if (!library) return

        return startAutosave(sprite, session, library, {
            onState: (save, reason) => {
                readout.patch({ save })
                if (save === 'failed') console.error('autosave failed', reason)
            },
        })
    }, [sprite, session, readout, library])

    useEffect(() => {
        if (!storageNotice) return

        readout.patch({
            projectNotice: { phase: 'error', label: 'not stored locally', detail: storageNotice },
        })
    }, [storageNotice, readout])

    useEffect(() => () => layers.dispose(), [layers])

    useEffect(
        () =>
            session.subscribe(() => {
                setGeometry(`${sprite.width}x${sprite.height}`)
            }),
        [session, sprite],
    )

    useEffect(() => {
        const compact = window.matchMedia(COMPACT_QUERY)
        const follow = () => {
            if (!layersChosen.current) setLayersOpen(!compact.matches)
        }

        compact.addEventListener('change', follow)
        return () => {
            compact.removeEventListener('change', follow)
        }
    }, [])

    const toggleLayers = (open: boolean) => {
        layersChosen.current = true
        setLayersOpen(open)
    }

    const openLibrary = () => {
        if (!library) return

        rememberDialogFocus()
        void Promise.all([library.list(), library.recoveries()])
            .then(([entries, kept]) => {
                setShelf({
                    entries,
                    recoveries: kept.map(({ id, title, updatedAt }) => ({ id, title, updatedAt })),
                })
                setDialog('library')
            })
            .catch((error: unknown) => {
                console.error('the library could not be listed', error)
            })
    }

    const refreshShelf = (next: Partial<Shelf>) => {
        setShelf((current) => (current ? { ...current, ...next } : current))
    }

    const startFresh = (width = DEFAULT_NEW, height = DEFAULT_NEW, title = 'untitled') => {
        try {
            onNew(width, height, title)
        } catch (reason) {
            console.error('could not create a sprite', reason)
        }
    }

    if (crash || !readable) {
        return (
            <EditorCrash
                kind={readable ? 'render' : 'document'}
                detail={crash instanceof Error ? crash.message : undefined}
                canExport={readable}
                readout={readout}
                onExport={() => {
                    actions.exportPng()
                }}
                onRetry={crash ? resetCrash : null}
                onNew={() => {
                    startFresh()
                }}
            />
        )
    }

    const toolbar = (
        <Toolbar
            store={store}
            readout={readout}
            compact={mobile}
            layersOpen={layersOpen}
            hideFileActions={hideFileActions}
            onNew={() => {
                show('new')
            }}
            onOpenProject={(file) => {
                actions.openProjectFile(file)
            }}
            onSaveProject={() => {
                actions.saveProject()
            }}
            onExport={() => {
                show('export')
            }}
            onToggleLayers={() => {
                rememberPanelFocus()
                toggleLayers(!layersOpen)
            }}
            onKeys={() => {
                show('keys')
            }}
            onHistory={(direction) => editorRef.current?.history(direction)}
            onTransform={(kind) => editorRef.current?.transform(kind)}
            onCanvasSize={() => {
                show('size')
            }}
            onLibrary={openLibrary}
        />
    )

    return (
        <div class={styles.editor} data-compact={mobile ? 'true' : 'false'}>
            {!mobile && toolbar}
            <PaintControls
                store={store}
                readout={readout}
                palette={sprite.palette}
                onOpenStudio={() => {
                    show('studio')
                }}
                onOpenPalette={() => {
                    show('palette')
                }}
                onClearSelection={() => {
                    editorRef.current?.clearSelection()
                }}
            />
            <main class={styles.workspace}>
                <div class={styles.canvasStack}>
                    <canvas
                        ref={canvasRef}
                        class={styles.canvas}
                        data-testid="canvas"
                        role="img"
                        aria-label={`${sprite.meta.title.slice(0, LABEL_MAX)} drawing canvas, ${sprite.width} by ${sprite.height} pixels`}
                    />
                    <canvas
                        ref={overlayRef}
                        class={styles.overlay}
                        data-testid="overlay"
                        aria-hidden="true"
                    />
                    <FirstVisitHint readout={readout} />
                </div>
                {layersOpen && (
                    <button
                        type="button"
                        class={styles.drawerScrim}
                        tabIndex={-1}
                        aria-label="Close the layers panel"
                        data-testid="drawer-scrim"
                        onClick={() => {
                            toggleLayers(false)
                        }}
                    />
                )}
                {layersOpen && (
                    <LayersPanel
                        sprite={sprite}
                        target={session.target}
                        layers={layers}
                        onClose={() => {
                            toggleLayers(false)
                        }}
                    />
                )}
            </main>
            {mobile && toolbar}
            {!mobile && (
                <Timeline
                    frames={frames}
                    playback={playback}
                    target={session.target}
                    store={store}
                    revision={layers}
                />
            )}
            <StatusBar
                sprite={sprite}
                target={session.target}
                playback={playback}
                store={store}
                readout={readout}
                layers={layers}
                onZoom={(direction) => editorRef.current?.zoom(direction)}
                onFit={() => editorRef.current?.fit()}
                onRename={(title) => {
                    session.rename(title)
                }}
            />

            {mobile && sheet === 'frames' && (
                <section
                    class={styles.dockSection}
                    aria-label="Frames and playback"
                    data-testid="mobile-frames-section"
                >
                    <Timeline
                        frames={frames}
                        playback={playback}
                        target={session.target}
                        store={store}
                        revision={layers}
                    />
                </section>
            )}

            {mobile && (
                <MobileActions
                    store={store}
                    readout={readout}
                    layersOpen={layersOpen}
                    framesOpen={sheet === 'frames'}
                    onToolOptions={() => {
                        setSheet('options')
                    }}
                    onFrames={() => {
                        setSheet((current) => (current === 'frames' ? null : 'frames'))
                    }}
                    onFile={() => {
                        setSheet('file')
                    }}
                    onToggleLayers={() => {
                        rememberPanelFocus()
                        toggleLayers(!layersOpen)
                    }}
                    onHistory={(direction) => editorRef.current?.history(direction)}
                />
            )}

            {mobile && sheet === 'options' && (
                <MobileSheet
                    title="Tool options"
                    onClose={() => {
                        setSheet(null)
                    }}
                >
                    <ToolOptions store={store} />
                </MobileSheet>
            )}

            {mobile && sheet === 'file' && (
                <MobileFileSheet
                    readout={readout}
                    layersOpen={layersOpen}
                    onClose={() => {
                        setSheet(null)
                    }}
                    onHistory={(direction) => editorRef.current?.history(direction)}
                    onTransform={(kind) => editorRef.current?.transform(kind)}
                    onNew={() => {
                        setSheet(null)
                        show('new')
                    }}
                    onLibrary={() => {
                        setSheet(null)
                        openLibrary()
                    }}
                    onCanvasSize={() => {
                        setSheet(null)
                        show('size')
                    }}
                    onOpenProject={(file) => {
                        setSheet(null)
                        actions.openProjectFile(file)
                    }}
                    onSaveProject={() => {
                        setSheet(null)
                        actions.saveProject()
                    }}
                    onExport={() => {
                        setSheet(null)
                        show('export')
                    }}
                    onKeys={() => {
                        setSheet(null)
                        show('keys')
                    }}
                    onToggleLayers={() => {
                        setSheet(null)
                        rememberPanelFocus()
                        toggleLayers(!layersOpen)
                    }}
                />
            )}

            <DialogHost
                open={dialog}
                close={closeDialog}
                sprite={sprite}
                store={store}
                palette={palette}
                revision={layers}
                library={library}
                shelf={shelf}
                canCrop={editorRef.current?.hasSelection() ?? false}
                onNew={(width, height, title) => {
                    closeDialog()
                    startFresh(width, height, title)
                }}
                onExport={(choice) => {
                    closeDialog()
                    if (choice.format === 'gif') actions.exportGif(choice.scale, choice.loop)
                    else if (choice.format === 'spritesheet')
                        actions.exportSpritesheet(choice.scale)
                    else if (choice.portable) actions.exportPortable()
                    else actions.exportPng()
                }}
                onCanvasSize={(choice) => {
                    closeDialog()
                    const canvas = editorRef.current?.canvas
                    if (choice.scale) canvas?.scale(choice.width, choice.height)
                    else canvas?.resize(choice.width, choice.height, choice.anchor)
                }}
                onCrop={() => {
                    closeDialog()
                    editorRef.current?.canvas.cropToSelection()
                }}
                onImportPalette={(file) => {
                    actions.importPalette(file)
                }}
                onOpenStored={(id) => {
                    closeDialog()
                    void library
                        ?.open(id)
                        .then((opened) => {
                            if (opened) onOpenStored(opened)
                        })
                        .catch((error: unknown) => {
                            console.error('that drawing could not be opened', error)
                        })
                }}
                onRemoveStored={(id) => {
                    void library
                        ?.remove(id)
                        .then(() => library.list())
                        .then((entries) => {
                            refreshShelf({ entries })
                        })
                        .catch((error: unknown) => {
                            console.error('that drawing could not be removed', error)
                        })
                }}
                onDownloadRecovery={(id) => {
                    if (library) actions.downloadRecovery(library, id)
                }}
                onForgetRecovery={(id) => {
                    void library
                        ?.forgetRecovery(id)
                        .then(() => library.recoveries())
                        .then((kept) => {
                            refreshShelf({
                                recoveries: kept.map(({ id: at, title, updatedAt }) => ({
                                    id: at,
                                    title,
                                    updatedAt,
                                })),
                            })
                        })
                        .catch((error: unknown) => {
                            console.error('that recovery could not be dropped', error)
                        })
                }}
            />
        </div>
    )
}
