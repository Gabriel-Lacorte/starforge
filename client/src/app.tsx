import { EditorCanvas } from './editor/EditorCanvas'
import { createDemoSprite } from './editor/demoSprite'

const sprite = createDemoSprite()

export function App() {
    return (
        <div class="app">
            <header class="topbar">
                <span class="brand">Starforge</span>
                <span class="tag">multiplayer pixel art</span>
            </header>
            <EditorCanvas sprite={sprite} />
        </div>
    )
}
