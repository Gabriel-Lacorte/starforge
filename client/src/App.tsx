import { createSprite, encodeSprite, type DecodedProject, type Sprite } from '@starforge/core'
import { useEffect, useState } from 'preact/hooks'
import { Brand } from './Brand'
import { About } from './About'
import { createStarterSprite } from './document/starterSprite'
import { EditorCanvas } from './editor/EditorCanvas'
import { RoomPage } from './room/RoomPage'
import { createRoom } from './net/roomController'
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

const ROOM_RE = /^\/r\/([A-Za-z0-9_-]{12})\/?$/

export function App() {
    const [path, setPath] = useState(window.location.pathname)
    const isAbout = path === '/about'
    const isRoomPath = path === '/r' || path.startsWith('/r/')

    const roomMatch = ROOM_RE.exec(path)
    const inSolo = roomMatch === null && !isRoomPath && !isAbout

    const [library, setLibrary] = useState<Library | null>(null)
    const [doc, setDoc] = useState<OpenDocument | null>(null)
    const [failure, setFailure] = useState<string | null>(null)

    const [sharing, setSharing] = useState(false)
    const [shareError, setShareError] = useState<string | null>(null)
    const [freshShare, setFreshShare] = useState(false)
    const [foreignTab, setForeignTab] = useState(false)

    useEffect(() => {
        const onPopState = (): void => {
            setPath(window.location.pathname)
        }
        window.addEventListener('popstate', onPopState)
        return () => {
            window.removeEventListener('popstate', onPopState)
        }
    }, [])

    const navigate = (to: string): void => {
        const url = new URL(to, window.location.origin)
        if (url.pathname !== window.location.pathname) {
            window.history.pushState(null, '', url.pathname + url.search)
        }
        setSharing(false)
        setShareError(null)
        setPath(url.pathname)
    }

    useEffect(() => {
        if (!inSolo) return

        setForeignTab(false)
        let opened: Library | null = null
        let releaseLock: (() => void) | null = null
        const alive = { current: true }

        const begin = (own: boolean): void => {
            if (!alive.current) return
            if (!own) {
                setForeignTab(true)
                const starter = createStarterSprite()
                setDoc(
                    freshDocument(
                        starter.sprite,
                        starter.activeLayer,
                        starter.sprite.frames[0]!.id,
                    ),
                )
                return
            }
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
        }

        const locks = (navigator as unknown as { locks?: LockManager }).locks
        if (locks === undefined) {
            begin(true)
        } else {
            void locks
                .request(
                    'starforge:solo',
                    { ifAvailable: true },
                    async (acquired): Promise<void> => {
                        if (acquired === null) {
                            begin(false)
                            return
                        }
                        await new Promise<void>((resolve) => {
                            releaseLock = resolve
                            begin(true)
                        })
                    },
                )
                .catch(() => {
                    if (releaseLock === null) begin(true)
                })
        }

        return () => {
            alive.current = false
            opened?.close()
            releaseLock?.()
        }
    }, [inSolo])

    const shareDrawing = () => {
        if (!doc || sharing) return

        setSharing(true)
        setShareError(null)

        const current = doc
        void createRoom(location.origin, {
            title: current.sprite.meta.title,
            width: current.sprite.width,
            height: current.sprite.height,
            snapshot: JSON.stringify(encodeSprite(current.sprite)),
        }).then(
            ({ id }) => {
                setFreshShare(true)
                navigate(`/r/${id}`)
            },
            (error: unknown) => {
                setSharing(false)
                setShareError(
                    error instanceof Error ? error.message : 'could not share this drawing',
                )
            },
        )
    }

    return (
        <div class={styles.app}>
            {isAbout ? (
                <About />
            ) : roomMatch ? (
                <RoomPage
                    key={roomMatch[1]!}
                    roomId={roomMatch[1]!}
                    startSharing={freshShare}
                    onOpenProject={(project) => {
                        setDoc({
                            ...freshDocument(
                                project.sprite,
                                project.workspace.activeLayerId,
                                project.workspace.activeFrameId,
                            ),
                            projectNotice: null,
                        })
                        navigate('/')
                    }}
                    onExit={() => {
                        setFreshShare(false)
                        navigate('/')
                    }}
                />
            ) : (
                <>
                    <header class={`bar ${styles.topbar}`}>
                        <Brand />
                        <a href="/about">About</a>
                    </header>
                    {shareError ? (
                        <p role="alert" data-testid="share-error" class={styles.shareError}>
                            {shareError}
                        </p>
                    ) : null}
                    {foreignTab ? (
                        <p role="alert" data-testid="foreign-tab" class={styles.shareError}>
                            This studio is already open in another tab, so this copy does not save.
                            Close this tab and paint in the other one.
                        </p>
                    ) : null}
                    {isRoomPath ? (
                        <main class={styles.loading} role="alert">
                            <section data-testid="room-missing">
                                <p>That room link does not name a room.</p>
                                <p>
                                    <a href="/">Back to your drawings</a>
                                </p>
                            </section>
                        </main>
                    ) : doc ? (
                        <EditorCanvas
                            key={doc.instance}
                            sprite={doc.sprite}
                            library={library}
                            storageNotice={failure}
                            initialLayer={doc.activeLayer}
                            initialFrame={doc.activeFrame}
                            initialProjectNotice={doc.projectNotice}
                            shareBusy={sharing}
                            onShare={shareDrawing}
                            onNew={(width, height, title) => {
                                const sprite = createSprite({ width, height, title })
                                setDoc(
                                    freshDocument(
                                        sprite,
                                        sprite.layers[0]!.id,
                                        sprite.frames[0]!.id,
                                    ),
                                )
                            }}
                            onOpenStored={(stored) => {
                                setDoc(
                                    freshDocument(
                                        stored.sprite,
                                        stored.activeLayer,
                                        stored.activeFrame,
                                    ),
                                )
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
                            <span class={styles.loadingRow}>
                                <span class="pulse" aria-hidden="true" />
                                opening your drawing
                            </span>
                        </main>
                    )}
                </>
            )}
        </div>
    )
}
