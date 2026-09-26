import { useEffect, useState } from 'preact/hooks'
import { Brand } from './Brand'
import styles from './About.module.css'

const GITHUB = 'https://github.com/Gabriel-Lacorte/starforge'
const DISCORD = 'https://discord.gg/vMshxxF4ke'

interface RelayStats {
    rooms: { live: number; created: number }
    painters: { now: number }
    ops: { applied: number; rejected: number }
}

function useRelayStats(): RelayStats | null {
    const [stats, setStats] = useState<RelayStats | null>(null)

    useEffect(() => {
        let alive = true
        const load = async (): Promise<void> => {
            try {
                const response = await fetch('/api/stats')
                if (!response.ok) return
                const next = (await response.json()) as RelayStats
                if (alive) setStats(next)
            } catch {
                /* the studio works without the relay */
            }
        }
        void load()
        const timer = setInterval(() => {
            void load()
        }, 30_000)
        return () => {
            alive = false
            clearInterval(timer)
        }
    }, [])

    return stats
}

export function About() {
    const stats = useRelayStats()

    return (
        <div class={styles.page}>
            <header class={`bar ${styles.topbar}`}>
                <Brand />
                <nav class={styles.nav}>
                    <a href="/">Open the studio</a>
                    <a href="/about" aria-current="page" class={styles.navHere}>
                        About
                    </a>
                </nav>
            </header>
            <main class={styles.main} data-testid="about">
                <section class={styles.hero}>
                    <p class={styles.kicker}>Free and open source</p>
                    <h1 class={styles.title}>Draw pixels with your friends.</h1>
                    <p class={styles.tagline}>
                        A pixel art studio in your browser. Open a room, share the link, and paint
                        together live.
                    </p>
                    <p class={styles.ctaRow}>
                        <a class={styles.ctaPrimary} href="/">
                            Open the studio
                        </a>
                    </p>
                </section>

                <section aria-label="Project" class={styles.cards}>
                    <a class={styles.card} href={GITHUB}>
                        <strong>GitHub</strong>
                        <span>Source code, issues and roadmap.</span>
                    </a>
                    <a class={styles.card} href={DISCORD}>
                        <strong>Discord Community</strong>
                        <span>Find people to draw with.</span>
                    </a>
                </section>

                {stats !== null && (
                    <p class={styles.stats} data-testid="about-stats">
                        {stats.painters.now > 0 ? (
                            <>
                                <strong>{String(stats.painters.now)}</strong> painting now ·{' '}
                            </>
                        ) : null}
                        <strong>{String(stats.rooms.live)}</strong> live rooms ·{' '}
                        <strong>{String(stats.rooms.created)}</strong> rooms ever ·{' '}
                        <strong>{stats.ops.applied.toLocaleString('en-US')}</strong> strokes synced
                    </p>
                )}

                <footer class={styles.footer}>
                    <p>
                        Set in <a href="https://github.com/googlefonts/silkscreen">Silkscreen</a> by
                        Jason Kottke. UI icons from{' '}
                        <a href="https://pixelarticons.com">pixelarticons</a> by Gerrit Halfmann.
                        MIT licensed.
                    </p>
                </footer>
            </main>
        </div>
    )
}
