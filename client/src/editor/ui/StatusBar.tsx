import { rgbaToHex, type Sprite } from '@starforge/core'
import type { ReadoutStore } from '../readout'
import type { EditorStore } from '../store'
import { useStore } from './useStore'
import styles from './StatusBar.module.css'

type HoverView =
    | { readonly pos: string; readonly empty: true }
    | { readonly pos: string; readonly empty: false; readonly hex: string }

export function StatusBar({
    sprite,
    store,
    readout,
}: {
    sprite: Sprite
    store: EditorStore
    readout: ReadoutStore
}) {
    const state = useStore(store)
    const { zoom, hover } = useStore(readout)

    const hoverView: HoverView | null = hover
        ? (hover.color & 0xff) !== 0
            ? { pos: `${hover.x}, ${hover.y}`, empty: false, hex: rgbaToHex(hover.color) }
            : { pos: `${hover.x}, ${hover.y}`, empty: true }
        : null

    return (
        <footer class={`bar ${styles.statusbar}`}>
            <span class={styles.docTitle}>{sprite.meta.title}</span>
            <span class="mono">
                {sprite.width}*{sprite.height}
            </span>

            <span class={styles.cursor} title="Pixel under the cursor">
                <span class={`mono ${styles.pos}`} data-testid="hover-pos">
                    {hoverView ? hoverView.pos : '-'}
                </span>
                {hoverView &&
                    (hoverView.empty ? (
                        <>
                            <span class="chip chip-empty" />
                            <span class="mono dim" data-testid="hover-label">
                                empty
                            </span>
                        </>
                    ) : (
                        <>
                            <span class="chip" style={{ background: hoverView.hex }} />
                            <span class="mono dim" data-testid="hover-label">
                                {hoverView.hex}
                            </span>
                        </>
                    ))}
            </span>

            <span class={styles.toolStatus}>
                <span class="chip" style={{ background: rgbaToHex(state.color) }} />
                <span class="mono" data-testid="status-tool">
                    {state.tool}
                </span>
                {state.tool !== 'bucket' && (
                    <span class="mono dim" data-testid="status-brush">
                        brush {state.brushSize}
                    </span>
                )}
            </span>

            <span class={`mono ${styles.zoom}`} data-testid="zoom">
                {zoom * 100}%
            </span>
        </footer>
    )
}
