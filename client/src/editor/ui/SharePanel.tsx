import { useEffect, useRef } from 'preact/hooks'
import type { RoomPeer } from '../../net/presence'
import type { RoomProfile } from '../../net/profile'
import styles from './SharePanel.module.css'

/** Eight preset identity colors (RGBA), gold second to match the default profile. */
export const SHARE_SWATCHES: readonly number[] = [
    0xff5533ff, 0xffcc33ff, 0x66dd66ff, 0x33ccffff, 0x8866ffff, 0xff66ccff, 0xffffffff, 0x222228ff,
]

export function shareColorCss(color: number): string {
    return `#${(color >>> 0).toString(16).padStart(8, '0')}`
}

function toColorInput(color: number): string {
    return `#${((color >>> 8) & 0xffffff).toString(16).padStart(6, '0')}`
}

function fromColorInput(value: string): number | null {
    const match = /^#([0-9a-f]{6})$/i.exec(value)
    if (!match) return null
    return (Number.parseInt(match[1]!, 16) * 256 + 0xff) >>> 0
}

/**
 * Presentational room-sharing dialog: nickname, color, link, members, leave.
 * All state lives in RoomPage; this panel only reports intent.
 */
export function SharePanel({
    profile,
    peers,
    link,
    onProfile,
    onCopy,
    onLeave,
    onClose,
}: {
    profile: RoomProfile
    peers: readonly RoomPeer[]
    link: string
    onProfile: (next: RoomProfile) => void
    onCopy: () => void
    onLeave: () => void
    onClose: () => void
}) {
    const dialogRef = useRef<HTMLDialogElement>(null)
    const linkRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        dialogRef.current?.showModal()
    }, [])

    const copy = () => {
        const done = () => {
            onCopy()
        }
        const fallback = () => {
            linkRef.current?.select()
            done()
        }
        try {
            const clipboard: Clipboard | undefined =
                'clipboard' in navigator ? navigator.clipboard : undefined
            if (clipboard === undefined) {
                fallback()
                return
            }
            void Promise.resolve(clipboard.writeText(link)).then(done, fallback)
        } catch {
            fallback()
        }
    }

    return (
        <dialog
            ref={dialogRef}
            class={styles.dialog}
            aria-label="Share this room"
            data-testid="share-panel"
            onCancel={(e) => {
                e.preventDefault()
                onClose()
            }}
            onClick={(e) => {
                if (e.target === dialogRef.current) onClose()
            }}
            onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape') {
                    e.preventDefault()
                    onClose()
                }
            }}
        >
            <header class={styles.header}>Share this room</header>

            <div class={styles.body}>
                <section class={styles.group} aria-label="Your identity">
                    <h2 class={styles.groupName}>You paint as</h2>
                    <div class={styles.field}>
                        <input
                            class={styles.input}
                            type="text"
                            value={profile.nickname}
                            maxLength={64}
                            aria-label="Nickname"
                            data-testid="share-nickname"
                            onInput={(e) => {
                                onProfile({
                                    ...profile,
                                    nickname: e.currentTarget.value.slice(0, 64),
                                })
                            }}
                        />
                    </div>
                    <div class={styles.swatches} role="group" aria-label="Color">
                        {SHARE_SWATCHES.map((color) => (
                            <button
                                key={color}
                                type="button"
                                class={styles.swatch}
                                style={{ background: shareColorCss(color) }}
                                title={`Paint as ${shareColorCss(color)}`}
                                aria-label={`Use color ${shareColorCss(color)}`}
                                aria-pressed={profile.color === color}
                                data-testid="share-swatch"
                                onClick={() => {
                                    onProfile({ ...profile, color })
                                }}
                            />
                        ))}
                        <input
                            class={styles.pick}
                            type="color"
                            value={toColorInput(profile.color)}
                            aria-label="Custom color"
                            data-testid="share-color"
                            onInput={(e) => {
                                const next = fromColorInput(e.currentTarget.value)
                                if (next !== null) onProfile({ ...profile, color: next })
                            }}
                        />
                    </div>
                </section>

                <section class={styles.group} aria-label="Room link">
                    <h2 class={styles.groupName}>Room link</h2>
                    <div class={styles.linkRow}>
                        <input
                            ref={linkRef}
                            class={styles.input}
                            type="text"
                            readonly
                            value={link}
                            aria-label="Room link"
                            data-testid="share-link"
                            onFocus={(e) => {
                                e.currentTarget.select()
                            }}
                        />
                        <button
                            type="button"
                            class={styles.action}
                            data-testid="share-copy"
                            onClick={copy}
                        >
                            Copy
                        </button>
                    </div>
                </section>

                <section class={styles.group} aria-label="Members">
                    <h2 class={styles.groupName}>Painting now</h2>
                    <ul class={styles.members}>
                        <li class={styles.member} data-testid="member">
                            <span
                                class={styles.dot}
                                style={{ background: shareColorCss(profile.color) }}
                            />
                            <span class={styles.name}>
                                {profile.nickname} <span class={styles.you}>(you)</span>
                            </span>
                        </li>
                        {peers.map((peer) => (
                            <li key={peer.site} class={styles.member} data-testid="member">
                                <span
                                    class={styles.dot}
                                    style={{ background: shareColorCss(peer.color) }}
                                />
                                <span class={styles.name}>{peer.nickname}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            </div>

            <div class={styles.actions}>
                <button
                    type="button"
                    class={`${styles.action} ${styles.actionDanger}`}
                    data-testid="share-leave"
                    onClick={onLeave}
                >
                    Leave
                </button>
                <button
                    type="button"
                    class={styles.action}
                    data-testid="share-close"
                    autofocus
                    onClick={onClose}
                >
                    Close
                </button>
            </div>
        </dialog>
    )
}
