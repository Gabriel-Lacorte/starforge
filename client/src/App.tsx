import { createSprite, type Sprite } from '@starforge/core'
import { useState } from 'preact/hooks'
import { createStarterSprite } from './document/starterSprite'
import { EditorCanvas } from './editor/EditorCanvas'
import { loadDocument } from './storage/localDoc'
import styles from './App.module.css'

interface OpenDocument {
    sprite: Sprite
    activeLayer: string
}

function openLastDocument(): OpenDocument {
    return loadDocument() ?? createStarterSprite()
}

export function App() {
    const [doc, setDoc] = useState<OpenDocument>(openLastDocument)

    return (
        <div class={styles.app}>
            <header class={`bar ${styles.topbar}`}>
                <img class={styles.mark} src="/favicon.svg" alt="" width="16" height="16" />
                <h1 class={styles.brand}>Starforge</h1>
                <span class={styles.tag}>multiplayer pixel art</span>
            </header>
            <EditorCanvas
                key={doc.sprite.id}
                sprite={doc.sprite}
                initialLayer={doc.activeLayer}
                onNew={(width, height, title) => {
                    const sprite = createSprite({ width, height, title })
                    setDoc({ sprite, activeLayer: sprite.layers[0]!.id })
                }}
            />
        </div>
    )
}
