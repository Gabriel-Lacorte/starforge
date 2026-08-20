import { createSprite, type DecodedProject, type Sprite } from '@starforge/core'
import { useEffect, useState } from 'preact/hooks'
import { createStarterSprite } from './document/starterSprite'
import { EditorCanvas } from './editor/EditorCanvas'
import styles from './App.module.css'
import { migrateLocalDocument, Library } from './storage/library'
import type { ProjectNotice } from './editor/readout'

interface OpenDocument {
    instance: string
    sprite: Sprite
    activeLayer: string
    activeFrame: string
    projectNotice: ProjectNotice | null
}

function freshDocument(sprite: Sprite, activeLayer: string, activeFrame: string): OpenDocument {
    return {
        instance: crypto.randomUUID(),
        sprite,
        activeLayer,
        activeFrame,
        projectNotice: null,
    }
}

export function App() {
    const [library, setLibrary] = useState<Library | null>(null)
    const [doc, setDoc] = useState<OpenDocument | null>(null)
    const [failure, setFailure] = useState<string | null>(null)

    useEffect(() => {
        let opened: Library | null = null
        const alive = { current: true }

        void (async () => {
            try {
                opened = await Library.open()
                await migrateLocalDocument(opened)
                const stored = await opened.openLatest()

                if (!alive.current) return

                setLibrary(opened)
                if (stored) {
                    setDoc(freshDocument(stored.sprite, stored.activeLayer, stored.activeFrame))
                } else {
                    const starter = createStarterSprite()
                    setDoc(
                        freshDocument(
                            starter.sprite,
                            starter.activeLayer,
                            starter.sprite.frames[0]!.id,
                        ),
                    )
                }
            } catch (error) {
                if (!alive.current) return

                console.error('the local library could not be opened', error)
                setFailure(
                    'This browser is not storing your work. Save the project before leaving.',
                )

                const starter = createStarterSprite()
                setDoc(
                    freshDocument(
                        starter.sprite,
                        starter.activeLayer,
                        starter.sprite.frames[0]!.id,
                    ),
                )
            }
        })()

        return () => {
            alive.current = false
            opened?.close()
        }
    }, [])

    return (
        <div class={styles.app}>
            <header class={`bar ${styles.topbar}`}>
                <img class={styles.mark} src="/favicon.svg" alt="" width="16" height="16" />
                <h1 class={styles.brand}>Starforge</h1>
                <span class={styles.tag}>pixel art + animation</span>
            </header>
            {doc ? (
                <EditorCanvas
                    key={doc.instance}
                    sprite={doc.sprite}
                    library={library}
                    storageNotice={failure}
                    initialLayer={doc.activeLayer}
                    initialFrame={doc.activeFrame}
                    initialProjectNotice={doc.projectNotice}
                    onNew={(width, height, title) => {
                        const sprite = createSprite({ width, height, title })
                        setDoc(freshDocument(sprite, sprite.layers[0]!.id, sprite.frames[0]!.id))
                    }}
                    onOpenStored={(stored) => {
                        setDoc(freshDocument(stored.sprite, stored.activeLayer, stored.activeFrame))
                    }}
                    onOpenProject={(project: DecodedProject, notice) => {
                        setDoc({
                            ...freshDocument(
                                project.sprite,
                                project.workspace.activeLayerId,
                                project.workspace.activeFrameId,
                            ),
                            projectNotice: notice,
                        })
                    }}
                />
            ) : (
                <main class={styles.loading} role="status">
                    opening your drawing
                </main>
            )}
        </div>
    )
}
