import { useEffect, useState } from 'preact/hooks'
import type { DocumentSession } from '../document/session'
import { EditorCanvas } from '../editor/EditorCanvas'
import { wsBase, relayHttpBase } from '../net/wsBase'
import { connectNet, createNetRoom, type NetLink, type NetStatus } from './netDemo'
import styles from './NetLab.module.css'

function relayWsUrl(): string {
    const params = new URLSearchParams(window.location.search)
    return wsBase(window.location.origin, params.get('relay'))
}

function nickname(): string {
    const params = new URLSearchParams(window.location.search)
    return params.get('nick') ?? `painter-${String(Math.floor(Math.random() * 9000) + 1000)}`
}

function roomParam(): string | null {
    const id = new URLSearchParams(window.location.search).get('room')
    return id === null || id === '' ? null : id
}

export function NetLab() {
    const [link, setLink] = useState<NetLink | null>(null)
    const [status, setStatus] = useState<NetStatus>({ phase: 'connecting', site: 0, error: null })
    const [epoch, setEpoch] = useState(0)

    useEffect(() => {
        const alive = { current: true }
        let active: NetLink | null = null
        setStatus({ phase: 'connecting', site: 0, error: null })
        setLink(null)
        const wsUrl = relayWsUrl()
        void (async () => {
            try {
                const room =
                    roomParam() ??
                    (await createNetRoom(relayHttpBase(wsUrl), {
                        title: 'netlab',
                        width: 64,
                        height: 64,
                    }))

                const net = await connectNet(wsUrl, {
                    room,
                    nickname: nickname(),
                    color: 0xffcc33ff,
                })
                if (!alive.current) {
                    net.close()
                    return
                }
                active = net
                setLink(net)
                setStatus(net.status())
                net.subscribe(() => {
                    setStatus({ ...net.status() })
                })
            } catch (error: unknown) {
                if (!alive.current) return
                setStatus({
                    phase: 'closed',
                    site: 0,
                    error: error instanceof Error ? error.message : 'could not reach the relay',
                })
            }
        })()
        return () => {
            alive.current = false
            active?.close()
        }
    }, [epoch])

    const session: DocumentSession | null = link?.session ?? null

    return (
        <main class={styles.lab}>
            <header class={`bar ${styles.controls}`}>
                <div class={styles.title}>
                    <strong>Net lab</strong>
                    <span>two browsers, one relay</span>
                </div>
                <p class={styles.state} aria-live="polite">
                    <strong data-testid="net-status">{status.phase}</strong>
                    {' * '}
                    <span data-testid="net-site">{String(status.site)}</span>
                </p>
                {status.error ? (
                    <p class={styles.error} data-testid="net-error">
                        {status.error}
                    </p>
                ) : null}
                <div class={styles.actions}>
                    <button type="button" onClick={() => setEpoch((n) => n + 1)}>
                        Reset
                    </button>
                </div>
            </header>
            {session ? (
                <section class={styles.site}>
                    <header class={styles.siteHeader}>
                        <span class={`${styles.siteDot} ${styles.gold}`} />
                        <strong>site {status.site}</strong>
                        <span class={styles.siteHint}>live relay</span>
                    </header>
                    <div class={styles.editorHost}>
                        <EditorCanvas
                            key={`${String(status.site)}-${String(epoch)}`}
                            sprite={session.doc}
                            session={session}
                            active
                            library={null}
                            storageNotice={null}
                            initialFrame={session.doc.frames[0]!.id}
                            initialProjectNotice={null}
                            initialLayersOpen={false}
                            hideFileActions
                            onNew={() => undefined}
                            onOpenStored={() => undefined}
                            onOpenProject={() => undefined}
                        />
                    </div>
                </section>
            ) : (
                <p class={styles.connecting}>connecting to the relay...</p>
            )}
        </main>
    )
}
