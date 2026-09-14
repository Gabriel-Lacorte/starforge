import { Brand } from './Brand'
import styles from './About.module.css'

const GITHUB = 'https://github.com/Gabriel-Lacorte/starforge'
const DISCORD = 'https://discord.gg/vMshxxF4ke'

export function About() {
    return (
        <div class={styles.page}>
            <header class={styles.topbar}>
                <Brand />
                <nav class={styles.nav}>
                    <a href="/">Open the studio</a>
                </nav>
            </header>
            <main class={styles.main} data-testid="about">
                <section class={styles.hero}>
                    <p class={styles.kicker}>Pixel art and animation, together</p>
                    <h1 class={styles.title}>Starforge</h1>
                    <p class={styles.tagline}>
                        A studio that runs entirely in your browser, paint sprites, animate
                        flipbooks, and share a room link so friends paint the same pixels with you,
                        live.
                    </p>
                    <p class={styles.ctaRow}>
                        <a class={styles.cta} href="/">
                            Open the studio
                        </a>
                        <a class={styles.cta} href={GITHUB}>
                            GitHub
                        </a>
                    </p>
                </section>

                <section aria-label="Features">
                    <h2>What you get</h2>
                    <ul class={styles.features}>
                        <li class={styles.feature}>
                            <strong>Paint.</strong> Brushes, layers, palettes, onion skin, and
                            frames for sprites that stay crisp at any size.
                        </li>
                        <li class={styles.feature}>
                            <strong>Together.</strong> One link, one room, up to 16 painters.
                            Crossing strokes merge the same way on every screen, and live cursors
                            show who is where.
                        </li>
                        <li class={styles.feature}>
                            <strong>Resilient.</strong> Strokes save on your device as you paint and
                            sync through the relay, paint offline and catch up on reconnect.
                        </li>
                        <li class={styles.feature}>
                            <strong>Yours.</strong> Export portable PNGs and project files any time.
                            No account, no lock-in.
                        </li>
                    </ul>
                </section>

                <section aria-label="Project">
                    <h2>Project</h2>
                    <ul>
                        <li>
                            <a href={GITHUB}>GitHub: Gabriel-Lacorte/starforge</a>
                        </li>
                        <li>
                            <a href={DISCORD}>Discord: Starforge community</a>
                        </li>
                    </ul>
                </section>
            </main>
        </div>
    )
}
