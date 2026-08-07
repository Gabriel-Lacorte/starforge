import type { Sprite } from '@starforge/core'
import { useEffect, useRef } from 'preact/hooks'
import { startEditor } from './engine'
import { ReadoutStore } from './readout'
import { EditorStore } from './store'
import { PaletteBar } from './ui/PaletteBar'
import { StatusBar } from './ui/StatusBar'
import { Toolbar } from './ui/Toolbar'
import styles from './EditorCanvas.module.css'
import { DocumentSession } from '../document/session'

export function EditorCanvas({ sprite }: { sprite: Sprite }) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const overlayRef = useRef<HTMLCanvasElement>(null)

    const sessionRef = useRef<DocumentSession | null>(null)
    const storeRef = useRef<EditorStore | null>(null)
    const readoutRef = useRef<ReadoutStore | null>(null)

    sessionRef.current ??= new DocumentSession(sprite)
    storeRef.current ??= new EditorStore()
    readoutRef.current ??= new ReadoutStore()

    const session = sessionRef.current
    const store = storeRef.current
    const readout = readoutRef.current

    useEffect(() => {
        const canvas = canvasRef.current
        const overlay = overlayRef.current
        if (!canvas || !overlay) return

        return startEditor(canvas, overlay, session, store, readout)
    }, [session, store, readout])

    return (
        <div class={styles.editor}>
            <Toolbar store={store} />
            <div class={styles.canvasStack}>
                <canvas ref={canvasRef} class={styles.canvas} data-testid="canvas" />
                <canvas ref={overlayRef} class={styles.overlay} data-testid="overlay" />
            </div>
            <PaletteBar palette={sprite.palette} store={store} />
            <StatusBar sprite={sprite} store={store} readout={readout} />
        </div>
    )
}
