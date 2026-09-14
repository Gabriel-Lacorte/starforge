import { useEffect, useRef, useState } from 'preact/hooks'
import { Brand } from '../Brand'
import type { DocumentSession } from '../document/session'
import { EditorCanvas } from '../editor/EditorCanvas'
import { ReadoutStore } from '../editor/readout'
import { EditorStore } from '../editor/store'
import { SharePanel, shareColorCss } from '../editor/ui/SharePanel'
import type { ConnStatus } from '../net/connection'
import type { RoomPeer } from '../net/presence'
import { loadProfile, saveProfile, type RoomProfile } from '../net/profile'
import { RoomController } from '../net/roomController'
import { wsBase } from '../net/wsBase'
import styles from './RoomPage.module.css'

export interface RoomMeta {
    readonly found: boolean
    readonly title?: string
}

const STUCK_AFTER_MS = 10000

async function defaultFetchMeta(roomId: string): Promise<RoomMeta> {
    const response = await fetch(`${location.origin}/api/rooms/${roomId}`)
    if (!response.ok) return { found: false }
    let title: string | undefined
    try {
        const data = (await response.json()) as { title?: unknown }
        if (typeof data.title === 'string') title = data.title
    } catch {
        title = undefined
    }
    return { found: true, title }
}

export function RoomPage({
    roomId,
    fetchMeta = defaultFetchMeta,
    startSharing = false,
    onExit,
}: {
    roomId: string
    fetchMeta?: (roomId: string) => Promise<RoomMeta>
    startSharing?: boolean
    onExit: () => void
}) {
    const storeRef = useRef<EditorStore | null>(null)
    storeRef.current ??= new EditorStore()
    const readoutRef = useRef<ReadoutStore | null>(null)
    readoutRef.current ??= new ReadoutStore(null)
    const profileRef = useRef<RoomProfile | null>(null)
    profileRef.current ??= loadProfile()
    const controllerRef = useRef<RoomController | null>(null)
    const resyncSeqRef = useRef(0)
    const resyncRoomRef = useRef(roomId)

    const [missing, setMissing] = useState(false)
    const [offline, setOffline] = useState(false)
    const [stuck, setStuck] = useState(false)
    const [title, setTitle] = useState<string | null>(null)
    const [session, setSession] = useState<DocumentSession | null>(null)
    const [status, setStatus] = useState<ConnStatus>('connecting')
    const [error, setError] = useState<string | null>(null)
    const [peers, setPeers] = useState<RoomPeer[]>([])
    const [epoch, setEpoch] = useState(0)
    const [profile, setProfile] = useState<RoomProfile>(profileRef.current)
    const [shareOpen, setShareOpen] = useState(startSharing)

    useEffect(() => {
        const alive = { current: true }
        const isAlive = (): boolean => alive.current
        let controller: RoomController | null = null
        let unsub: (() => void) | null = null

        setMissing(false)
        setOffline(false)
        setStuck(false)
        setSession(null)
        setStatus('connecting')
        setError(null)
        setPeers([])

        void (async () => {
            let meta: RoomMeta
            try {
                meta = await fetchMeta(roomId)
            } catch {
                if (alive.current) {
                    setOffline(true)
                }
                return
            }
            if (!alive.current) return
            if (!meta.found) {
                setMissing(true)
                return
            }
            setTitle(meta.title ?? null)

            const store = storeRef.current!
            const readout = readoutRef.current!

            if (resyncRoomRef.current !== roomId) {
                resyncRoomRef.current = roomId
                resyncSeqRef.current = 0
            }

            const since = resyncSeqRef.current
            resyncSeqRef.current = 0
            const params = new URLSearchParams(location.search)
            const active = new RoomController({
                url: wsBase(location.origin, params.get('relay')),
                room: roomId,
                profile: profileRef.current!,
                store,
                readout,
                ...(since > 0 ? { since } : {}),
            })
            controller = active
            controllerRef.current = active
            active.onResync = (doc, seq): void => {
                void doc
                resyncSeqRef.current = seq
                if (alive.current) setEpoch((n) => n + 1)
            }
            unsub = active.subscribe(() => {
                if (!alive.current) return
                setStatus(active.status())
                setError(active.error())
                setPeers(active.peers.peers())
            })
            setStatus(active.status())
            try {
                const next = await active.connect()
                if (!isAlive()) {
                    active.close()
                    return
                }
                setSession(next)
                setStatus(active.status())
                setPeers(active.peers.peers())
            } catch (failure) {
                if (!isAlive()) return
                setError(failure instanceof Error ? failure.message : 'could not reach the relay')
                setStatus(active.status())
            }
        })()

        return () => {
            alive.current = false
            unsub?.()
            controller?.close()
            if (controllerRef.current === controller) controllerRef.current = null
        }
    }, [roomId, epoch, fetchMeta])

    useEffect(() => {
        if (session !== null || missing || offline) return

        const timer = setTimeout(() => {
            setStuck(true)
        }, STUCK_AFTER_MS)
        return () => {
            clearTimeout(timer)
        }
    }, [session, missing, offline, roomId, epoch])

    const leave = () => {
        controllerRef.current?.close()
        onExit()
    }

    const backHome = () => {
        leave()
    }

    const changeProfile = (next: RoomProfile) => {
        profileRef.current = next
        setProfile(next)
        saveProfile(next)
    }

    const retry = () => {
        setOffline(false)
        setEpoch((n) => n + 1)
    }

    if (offline) {
        return (
            <main class={styles.room}>
                <div class={styles.center}>
                    <section
                        class={styles.card}
                        data-testid="room-offline"
                        aria-label="Relay offline"
                    >
                        <h2>Relay offline</h2>
                        <p>Could not reach the relay. Check the connection and try again.</p>
                        <button type="button" data-testid="room-retry" onClick={retry}>
                            Retry
                        </button>
                    </section>
                </div>
            </main>
        )
    }

    if (missing) {
        return (
            <main class={styles.room}>
                <div class={styles.center}>
                    <section
                        class={styles.card}
                        data-testid="room-missing"
                        aria-label="Room not found"
                    >
                        <h2>Room not found</h2>
                        <p>This room link is unknown or the relay forgot it.</p>
                        <a href="/">Back to your drawings</a>
                    </section>
                </div>
            </main>
        )
    }

    const store = storeRef.current
    const readout = readoutRef.current
    const link = `${location.origin}/r/${roomId}`

    return (
        <main class={styles.room}>
            <header class={`bar ${styles.controls}`}>
                <div class={styles.left}>
                    <Brand />
                    <a class={styles.about} href="/about">
                        About
                    </a>
                    <div class={styles.title}>
                        {session === null ? <span class="pulse" aria-hidden="true" /> : null}
                        <strong>Room</strong>
                        <span>{title ?? roomId}</span>
                        <button
                            type="button"
                            class={styles.tabClose}
                            aria-label="Close room"
                            title="Leave room"
                            data-testid="room-tab-close"
                            onClick={leave}
                        >
                            x
                        </button>
                    </div>
                </div>
                {error ? (
                    <p class={styles.error} data-testid="room-error">
                        {error}
                    </p>
                ) : null}
                <div class={styles.right}>
                    <strong data-testid="room-status">{status}</strong>
                    <div class={styles.peers} aria-label="Painting now">
                        <span class={styles.peer} data-testid="peer-self" title="You">
                            <span
                                class={styles.dot}
                                style={{ background: shareColorCss(profile.color) }}
                            />
                            {profile.nickname}
                        </span>
                        {peers.map((peer) => (
                            <span key={peer.site} class={styles.peer} data-testid="peer">
                                <span
                                    class={styles.dot}
                                    style={{ background: shareColorCss(peer.color) }}
                                />
                                {peer.nickname}
                            </span>
                        ))}
                    </div>
                    <div class={styles.actions}>
                        <button type="button" data-testid="leave" onClick={leave}>
                            Leave
                        </button>
                    </div>
                </div>
            </header>
            {session ? (
                <div class={styles.editorHost}>
                    <EditorCanvas
                        key={`${roomId}:${String(epoch)}`}
                        sprite={session.doc}
                        session={session}
                        store={store}
                        readout={readout}
                        active
                        library={null}
                        storageNotice={null}
                        initialFrame={session.doc.frames[0]!.id}
                        initialProjectNotice={null}
                        roomOpen
                        onShare={() => {
                            setShareOpen(true)
                        }}
                        onNew={backHome}
                        onOpenStored={backHome}
                        onOpenProject={backHome}
                    />
                </div>
            ) : (
                <div class={styles.center}>
                    {stuck ? (
                        <section
                            class={styles.card}
                            data-testid="room-stuck"
                            aria-label="Still connecting"
                        >
                            <h2>Still trying to reach the relay</h2>
                            <p>Joining is taking longer than expected. The relay may be down :C</p>
                            <button type="button" data-testid="room-retry" onClick={retry}>
                                Retry
                            </button>
                        </section>
                    ) : (
                        <p class={styles.joining} role="status">
                            joining the room...
                        </p>
                    )}
                </div>
            )}
            {shareOpen ? (
                <SharePanel
                    profile={profile}
                    peers={peers}
                    link={link}
                    onProfile={changeProfile}
                    onCopy={() => undefined}
                    onLeave={leave}
                    onClose={() => {
                        setShareOpen(false)
                    }}
                />
            ) : null}
        </main>
    )
}
