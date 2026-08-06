import { useEffect, useRef, useState } from 'preact/hooks'

import type { Sprite } from '@starforge/core'
import { startEditor } from './engine'

export function EditorCanvas({ sprite }: { sprite: Sprite }) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [zoom, setZoom] = useState(1)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        return startEditor(canvas, sprite, { onZoom: setZoom })
    }, [sprite])

    return (
        <div class="editor">
            <canvas ref={canvasRef} class="editor-canvas" />
            <footer className="statusbar">
                <span class="doc-title">{sprite.meta.title}</span>
                <span class="mono">
                    {sprite.width}*{sprite.height}
                </span>
                <span class="hint">space+drag pan</span>
                <span class="mono zoom">{zoom * 100}%</span>
            </footer>
        </div>
    )
}
