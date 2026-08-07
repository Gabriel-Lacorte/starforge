import { EditorCanvas } from './editor/EditorCanvas'
import { createDemoSprite } from './editor/demoSprite'
import styles from './App.module.css'

const sprite = createDemoSprite()

export function App() {
    return (
        <div class={styles.app}>
            <header class={`bar ${styles.topbar}`}>
                <img class={styles.mark} src="/favicon.svg" alt="" width="15" height="13" />
                <span class={styles.brand}>Starforge</span>
                <span class={styles.tag}>multiplayer pixel art</span>
            </header>
            <EditorCanvas sprite={sprite} />
        </div>
    )
}
