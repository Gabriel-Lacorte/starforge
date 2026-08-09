import type { Sprite } from '@starforge/core'
import { useErrorBoundary, useEffect, useRef, useState } from 'preact/hooks'
import { DocumentSession } from '../document/session'
import { exportFramePng } from '../export/png'
import { startAutosave } from '../storage/autosave'
import { startEditor, type EditorHandle } from './engine'
import { LayersController } from './layers/layersController'
import { ReadoutStore } from './readout'
import { EditorStore } from './store'
import { EditorCrash } from './ui/EditorCrash'
import { LayersPanel } from './ui/LayersPanel'
import { KeysDialog } from './ui/KeysDialog'
import { NewSpriteDialog } from './ui/NewSpriteDialog'
import { PaletteBar } from './ui/PaletteBar'
import { StatusBar } from './ui/StatusBar'
import { Toolbar } from './ui/Toolbar'
import styles from './EditorCanvas.module.css'

const COMPACT = '(max-width: 720px), (max-height: 480px)'
const NOTICE_MS = 4000
const LABEL_MAX = 80
const DEFAULT_NEW = 64

export function EditorCanvas({
    sprite,
    initialLayer,
    onNew,
}: {
    sprite: Sprite
    initialLayer?: string
    onNew: (width: number, height: number, title: string) => void
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const overlayRef = useRef<HTMLCanvasElement>(null)

    const sessionRef = useRef<DocumentSession | null>(null)
    const storeRef = useRef<EditorStore | null>(null)
    const readoutRef = useRef<ReadoutStore | null>(null)
    const layersRef = useRef<LayersController | null>(null)

    sessionRef.current ??= new DocumentSession(sprite)
    storeRef.current ??= new EditorStore(initialLayer ?? sprite.layers.at(-1)?.id ?? '')
    readoutRef.current ??= new ReadoutStore()

    const session = sessionRef.current
    const store = storeRef.current
    const readout = readoutRef.current

    layersRef.current ??= new LayersController(sprite, session, store)
    const layers = layersRef.current

    const [layersOpen, setLayersOpen] = useState(() => !window.matchMedia(COMPACT).matches)
    const [newOpen, setNewOpen] = useState(false)
    const [keysOpen, setKeysOpen] = useState(false)
    const layersChosen = useRef(false)

    const editorRef = useRef<EditorHandle | null>(null)

    const dialogReturn = useRef<HTMLElement | null>(null)
    const panelReturn = useRef<HTMLElement | null>(null)
    const keysReturn = useRef<HTMLElement | null>(null)

    const [crash, resetCrash] = useErrorBoundary() as [unknown, () => void]

    let frame
    let unreadable
    try {
        frame = sprite.frames[0]
        unreadable = !frame || sprite.layers.length === 0
    } catch {
        frame = undefined
        unreadable = true
    }

    const exporting = useRef(false)
    const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        if (crash || unreadable) return

        const canvas = canvasRef.current
        const overlay = overlayRef.current
        if (!canvas || !overlay) return

        const editor = startEditor(canvas, overlay, session, store, readout, layers)
        editorRef.current = editor

        return () => {
            editorRef.current = null
            editor.dispose()
        }
    }, [session, store, readout, layers, crash, unreadable])

    useEffect(
        () => () => {
            if (noticeTimer.current) clearTimeout(noticeTimer.current)
        },
        [],
    )

    useEffect(
        () =>
            startAutosave(sprite, session, store, {
                onState: (save) => {
                    readout.patch({ save })
                },
            }),
        [sprite, session, store, readout],
    )

    useEffect(() => () => layers.dispose(), [layers])

    useEffect(() => {
        if (newOpen) return
        const previous = dialogReturn.current
        dialogReturn.current = null
        previous?.focus()
    }, [newOpen])

    useEffect(() => {
        if (keysOpen) return
        const previous = keysReturn.current
        keysReturn.current = null
        previous?.focus()
    }, [keysOpen])

    useEffect(() => {
        if (layersOpen) return
        const previous = panelReturn.current
        panelReturn.current = null
        previous?.focus()
    }, [layersOpen])

    useEffect(() => {
        const compact = window.matchMedia(COMPACT)
        const follow = () => {
            if (!layersChosen.current) setLayersOpen(!compact.matches)
        }

        compact.addEventListener('change', follow)
        return () => {
            compact.removeEventListener('change', follow)
        }
    }, [])

    const onExport = () => {
        if (exporting.current || !frame) return
        exporting.current = true

        if (noticeTimer.current) clearTimeout(noticeTimer.current)
        readout.patch({ exportState: 'working' })

        void exportFramePng(sprite, frame.id)
            .then(() => {
                readout.patch({ exportState: 'done' })
            })
            .catch((reason: unknown) => {
                console.error('export failed', reason)
                readout.patch({ exportState: 'failed' })
            })
            .finally(() => {
                exporting.current = false
                noticeTimer.current = setTimeout(() => {
                    noticeTimer.current = null
                    readout.patch({ exportState: null })
                }, NOTICE_MS)
            })
    }

    const startFresh = () => {
        try {
            onNew(DEFAULT_NEW, DEFAULT_NEW, 'untitled')
        } catch (reason) {
            console.error('could not create a sprite', reason)
        }
    }

    if (crash || unreadable) {
        return (
            <EditorCrash
                kind={unreadable ? 'document' : 'render'}
                detail={crash instanceof Error ? crash.message : undefined}
                canExport={Boolean(frame)}
                readout={readout}
                onExport={onExport}
                onRetry={crash ? resetCrash : null}
                onNew={startFresh}
            />
        )
    }

    return (
        <div class={styles.editor}>
            <Toolbar
                store={store}
                readout={readout}
                layersOpen={layersOpen}
                onNew={() => {
                    dialogReturn.current = document.activeElement as HTMLElement | null
                    setNewOpen(true)
                }}
                onExport={onExport}
                onToggleLayers={() => {
                    panelReturn.current = document.activeElement as HTMLElement | null
                    layersChosen.current = true
                    setLayersOpen((open) => !open)
                }}
                onKeys={() => {
                    keysReturn.current = document.activeElement as HTMLElement | null
                    setKeysOpen(true)
                }}
                onHistory={(direction) => {
                    editorRef.current?.history(direction)
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
                </div>
                {layersOpen && (
                    <button
                        type="button"
                        class={styles.drawerScrim}
                        tabIndex={-1}
                        aria-label="Close the layers panel"
                        data-testid="drawer-scrim"
                        onClick={() => {
                            layersChosen.current = true
                            setLayersOpen(false)
                        }}
                    />
                )}
                {layersOpen && (
                    <LayersPanel
                        sprite={sprite}
                        store={store}
                        layers={layers}
                        onClose={() => {
                            layersChosen.current = true
                            setLayersOpen(false)
                        }}
                    />
                )}
            </main>
            <PaletteBar palette={sprite.palette} store={store} />
            <StatusBar
                sprite={sprite}
                store={store}
                readout={readout}
                layers={layers}
                onZoom={(direction) => editorRef.current?.zoom(direction)}
                onFit={() => editorRef.current?.fit()}
            />

            {keysOpen && (
                <KeysDialog
                    onClose={() => {
                        setKeysOpen(false)
                    }}
                />
            )}

            {newOpen && (
                <NewSpriteDialog
                    current={{
                        title: sprite.meta.title,
                        width: sprite.width,
                        height: sprite.height,
                    }}
                    onCreate={(width, height, title) => {
                        setNewOpen(false)
                        try {
                            onNew(width, height, title)
                        } catch (reason) {
                            console.error('could not create a sprite', reason)
                        }
                    }}
                    onCancel={() => {
                        setNewOpen(false)
                    }}
                />
            )}
        </div>
    )
}
