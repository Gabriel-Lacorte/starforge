import { TOOL_CATALOG, toolBadge } from '../tools/catalog'
import type { ToolId } from '../store'
import { TOOL_ICON } from './icons'
import styles from './Toolbar.module.css'
import { blurOnPointer } from './blurOnPointer'

export function ToolButtons({ tool, onPick }: { tool: ToolId; onPick: (id: ToolId) => void }) {
    return (
        <div class={styles.toolStrip}>
            {TOOL_CATALOG.map((entry) => {
                const Icon = TOOL_ICON[entry.id]
                const badge = toolBadge(entry)

                return (
                    <button
                        key={entry.id}
                        type="button"
                        class={`${styles.toolBtn}${tool === entry.id ? ` ${styles.active}` : ''}`}
                        title={badge ? `${entry.label} (${badge})` : entry.label}
                        aria-label={entry.label}
                        aria-pressed={tool === entry.id}
                        onClick={(e) => {
                            onPick(entry.id)
                            blurOnPointer(e)
                        }}
                    >
                        <Icon />
                        {badge && (
                            <span class={styles.toolKey} data-testid="tool-key" aria-hidden="true">
                                {badge}
                            </span>
                        )}
                    </button>
                )
            })}
        </div>
    )
}
