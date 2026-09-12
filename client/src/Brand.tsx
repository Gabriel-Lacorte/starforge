import styles from './Brand.module.css'

export function Brand() {
    return (
        <>
            <img class={styles.mark} src="/favicon.svg" alt="" width="16" height="16" />
            <h1 class={styles.brand}>Starforge</h1>
            <span class={styles.tag}>pixel art + animation</span>
        </>
    )
}
