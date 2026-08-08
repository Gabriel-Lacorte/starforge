import { EditorCanvas } from './editor/EditorCanvas'
import { createStarterSprite } from './document/starterSprite'
import styles from './App.module.css'

const { sprite, activeLayer } = createStarterSprite()

export function App() {
    return (
        <div class={styles.app}>
            <header class={`bar ${styles.topbar}`}>
                <img class={styles.mark} src="/favicon.svg" alt="" width="16" height="16" />
                <span class={styles.brand}>Starforge</span>
                <span class={styles.tag}>multiplayer pixel art</span>
            </header>
            <EditorCanvas sprite={sprite} initialLayer={activeLayer} />
        </div>
    )
}
