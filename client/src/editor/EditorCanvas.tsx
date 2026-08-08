import type { Sprite } from '@starforge/core'
import { useEffect, useRef } from 'preact/hooks'
import { DocumentSession } from '../document/session'
import { exportFramePng } from '../export/png'
import { startEditor } from './engine'
import { LayersController } from './layers/layersController'
import { ReadoutStore } from './readout'
import { EditorStore } from './store'
import { LayersPanel } from './ui/LayersPanel'
import { PaletteBar } from './ui/PaletteBar'
import { StatusBar } from './ui/StatusBar'
import { Toolbar } from './ui/Toolbar'
import styles from './EditorCanvas.module.css'

export function EditorCanvas({ sprite, initialLayer }: { sprite: Sprite; initialLayer?: string }) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const overlayRef = useRef<HTMLCanvasElement>(null)

    const sessionRef = useRef<DocumentSession | null>(null)
    const storeRef = useRef<EditorStore | null>(null)
    const readoutRef = useRef<ReadoutStore | null>(null)
    const layersRef = useRef<LayersController | null>(null)

    sessionRef.current ??= new DocumentSession(sprite)
    storeRef.current ??= new EditorStore(
        initialLayer ?? sprite.layers[sprite.layers.length - 1]!.id,
    )
    readoutRef.current ??= new ReadoutStore()

    const session = sessionRef.current
    const store = storeRef.current
    const readout = readoutRef.current

    layersRef.current ??= new LayersController(sprite, session, store)
    const layers = layersRef.current

    useEffect(() => {
        const canvas = canvasRef.current
        const overlay = overlayRef.current
        if (!canvas || !overlay) return

        return startEditor(canvas, overlay, session, store, readout, layers)
    }, [session, store, readout, layers])

    useEffect(() => () => layers.dispose(), [layers])

    const frameId = sprite.frames[0]?.id
    const onExport = () => {
        if (frameId) void exportFramePng(sprite, frameId)
    }

    return (
        <div class={styles.editor}>
            <Toolbar store={store} onExport={onExport} />
            <div class={styles.workspace}>
                <div class={styles.canvasStack}>
                    <canvas ref={canvasRef} class={styles.canvas} data-testid="canvas" />
                    <canvas ref={overlayRef} class={styles.overlay} data-testid="overlay" />
                </div>
                <LayersPanel sprite={sprite} store={store} layers={layers} />
            </div>
            <PaletteBar palette={sprite.palette} store={store} />
            <StatusBar sprite={sprite} store={store} readout={readout} layers={layers} />
        </div>
    )
}
