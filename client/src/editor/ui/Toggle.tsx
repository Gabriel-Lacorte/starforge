import styles from './Toolbar.module.css'

export function Toggle({
    text,
    title,
    checked,
    onToggle,
    testId,
    ariaLabel,
}: {
    text: string
    title: string
    checked: boolean
    onToggle: (next: boolean) => void
    testId?: string
    ariaLabel?: string
}) {
    return (
        <label class={styles.opt} title={title}>
            <input
                type="checkbox"
                checked={checked}
                aria-label={ariaLabel}
                data-testid={testId}
                onChange={(e) => {
                    onToggle(e.currentTarget.checked)
                }}
            />
            {text}
        </label>
    )
}
