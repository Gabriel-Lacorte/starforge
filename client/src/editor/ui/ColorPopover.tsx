import { hexToRgba, rgbaToHex, type RGBA } from '@starforge/core'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { PaletteController } from '../palette/paletteController'
import type { EditorStore } from '../store'
import { useStore } from './useStore'
import { ColorField } from './ColorField'
import styles from './ColorPopover.module.css'

export type ColorPopoverTarget =
    { readonly kind: 'foreground' } | { readonly kind: 'swatch'; readonly index: number }

export function ColorPopover({
    store,
    palette,
    target,
    anchor,
    onClose,
}: {
    store: EditorStore
    palette: PaletteController
    target: ColorPopoverTarget
    anchor: HTMLElement | null
    onClose: () => void
}) {
    const state = useStore(store)
    const rootRef = useRef<HTMLDivElement>(null)
    const [draft, setDraft] = useState<RGBA | null>(null)

    const colors = palette.palette.colors
    const swatchHex = target.kind === 'swatch' ? colors[target.index] : undefined
    const value =
        target.kind === 'swatch' ? (draft ?? (swatchHex ? hexToRgba(swatchHex) : 0)) : state.color

    useLayoutEffect(() => {
        const pop = rootRef.current
        if (!pop) return
        const host = pop.offsetParent as HTMLElement | null
        if (!host) return

        const width = pop.offsetWidth
        const spot =
            anchor === null
                ? host.clientWidth / 2 - width / 2
                : anchor.getBoundingClientRect().left +
                  anchor.offsetWidth / 2 -
                  host.getBoundingClientRect().left -
                  width / 2
        pop.style.left = `${Math.max(8, Math.min(spot, host.clientWidth - width - 8))}px`
    }, [anchor])

    useEffect(() => {
        const onPointerDown = (e: PointerEvent): void => {
            const node = e.target instanceof Node ? e.target : null
            if (rootRef.current?.contains(node)) return
            if (anchor?.contains(node)) return
            onClose()
        }
        const onKeyDown = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') onClose()
        }
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('pointerdown', onPointerDown)
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [anchor, onClose])

    if (target.kind === 'swatch' && swatchHex === undefined) return null

    const editingSwatch = target.kind === 'swatch'
    const inPalette = colors.includes(rgbaToHex(value))

    return (
        <div
            ref={rootRef}
            class={styles.popover}
            role="dialog"
            aria-label={editingSwatch ? 'Edit palette colour' : 'Pick a colour'}
            data-testid="color-popover"
        >
            <ColorField
                value={value}
                recentColors={state.recentColors}
                onInput={(next) => {
                    if (editingSwatch) setDraft(next)
                    else store.setColor(next)
                }}
            />
            <div class={styles.actions}>
                {editingSwatch ? (
                    <>
                        <button
                            type="button"
                            class={styles.btn}
                            aria-label="Remove this colour from the palette"
                            data-testid="popover-remove"
                            disabled={colors.length <= 1}
                            onClick={() => {
                                palette.remove(target.index)
                                onClose()
                            }}
                        >
                            remove
                        </button>
                        <button
                            type="button"
                            class={`${styles.btn} ${styles.primary}`}
                            data-testid="popover-save"
                            disabled={draft === null || rgbaToHex(draft) === swatchHex}
                            onClick={() => {
                                if (draft !== null) palette.setColor(target.index, draft)
                                onClose()
                            }}
                        >
                            save colour
                        </button>
                    </>
                ) : (
                    <>
                        <span class={`mono dim ${styles.hint}`}>
                            right-click a swatch to edit it
                        </span>
                        <button
                            type="button"
                            class={styles.btn}
                            title="Add the picked colour to the palette"
                            data-testid="popover-add"
                            disabled={inPalette}
                            onClick={() => {
                                palette.add(value)
                            }}
                        >
                            add to palette
                        </button>
                        <button
                            type="button"
                            class={`${styles.btn} ${styles.primary}`}
                            onClick={onClose}
                        >
                            done
                        </button>
                    </>
                )}
            </div>
        </div>
    )
}
