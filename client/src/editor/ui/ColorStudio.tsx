import {
    hsvaToRgba,
    rgbaToHex,
    rgbaToHsva,
    withAlpha,
    type Hsva,
    type Palette,
    type RGBA,
} from '@starforge/core'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { LayersController } from '../layers/layersController'
import { type EditorStore } from '../store'
import { useStore } from './useStore'
import styles from './ColorStudio.module.css'

const CHANNELS = [
    { key: 'r', label: 'R', shift: 24 },
    { key: 'g', label: 'G', shift: 16 },
    { key: 'b', label: 'B', shift: 8 },
    { key: 'a', label: 'A', shift: 0 },
] as const

export function ColorStudio({
    store,
    palette,
    layers,
    onAddToPalette,
    onClose,
}: {
    store: EditorStore
    palette: Palette
    layers: LayersController
    onAddToPalette: (color: RGBA) => void
    onClose: () => void
}) {
    const ref = useRef<HTMLDialogElement>(null)
    const areaRef = useRef<HTMLDivElement>(null)
    useStore(layers)
    const state = useStore(store)

    const [hsva, setHsva] = useState<Hsva>(() => rgbaToHsva(state.color))
    const applied = useRef(state.color)
    const openedWith = useRef(state.color)

    useEffect(() => {
        ref.current?.showModal()
    }, [])

    const close = (): void => {
        store.rememberColor(openedWith.current)
        onClose()
    }

    if (state.color !== applied.current) {
        applied.current = state.color
        setHsva(rgbaToHsva(state.color, hsva))
    }

    const set = (next: Hsva): void => {
        setHsva(next)
        const color = hsvaToRgba(next)
        applied.current = color
        store.setColor(color)
    }

    const setColor = (color: RGBA): void => {
        applied.current = color
        setHsva(rgbaToHsva(color, hsva))
        store.setColor(color)
    }

    const hex = rgbaToHex(state.color)
    const inPalette = palette.colors.includes(hex)
    const pure = rgbaToHex(hsvaToRgba({ h: hsva.h, s: 1, v: 1, a: 255 }))
    const opaque = rgbaToHex(withAlpha(state.color, 255))

    const nudge = (event: KeyboardEvent): void => {
        const step = event.shiftKey ? 0.1 : 0.01
        const move: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, step],
            ArrowDown: [0, -step],
        }
        const delta = move[event.key]
        if (!delta) return

        event.preventDefault()
        set({ ...hsva, s: clamp01(hsva.s + delta[0]), v: clamp01(hsva.v + delta[1]) })
    }

    const track = (event: PointerEvent): void => {
        const area = areaRef.current
        if (!area) return

        const box = area.getBoundingClientRect()
        set({
            ...hsva,
            s: clamp01((event.clientX - box.left) / box.width),
            v: clamp01(1 - (event.clientY - box.top) / box.height),
        })
    }

    return (
        <dialog
            ref={ref}
            class={styles.dialog}
            aria-label="Color"
            data-testid="color-studio"
            onCancel={(e) => {
                e.preventDefault()
                close()
            }}
            onClick={(e) => {
                if (e.target === ref.current) close()
            }}
            onKeyDown={(e) => {
                e.stopPropagation()
            }}
        >
            <header class={styles.header}>Color</header>

            <div class={styles.body}>
                <div class={styles.field}>
                    <div
                        ref={areaRef}
                        class={styles.area}
                        style={{ '--pure': pure }}
                        role="slider"
                        tabIndex={0}
                        aria-label="Saturation and brightness"
                        aria-valuetext={`saturation ${percent(hsva.s)}%, brightness ${percent(hsva.v)}%`}
                        aria-valuenow={percent(hsva.s)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        data-testid="sv-area"
                        onPointerDown={(e) => {
                            e.currentTarget.setPointerCapture(e.pointerId)
                            track(e)
                        }}
                        onPointerMove={(e) => {
                            if (e.currentTarget.hasPointerCapture(e.pointerId)) track(e)
                        }}
                        onKeyDown={nudge}
                    >
                        <span
                            class={styles.marker}
                            style={{
                                left: `${percent(hsva.s)}%`,
                                top: `${100 - percent(hsva.v)}%`,
                            }}
                        />
                    </div>

                    <label class={`${styles.track} ${styles.hue}`}>
                        <span class="sr-only">Hue</span>
                        <input
                            type="range"
                            min={0}
                            max={359}
                            step={1}
                            value={Math.round(hsva.h) % 360}
                            data-testid="hue"
                            onInput={(e) => {
                                set({ ...hsva, h: Number(e.currentTarget.value) })
                            }}
                        />
                    </label>
                </div>

                <label class={`${styles.track} ${styles.alpha}`} style={{ '--opaque': opaque }}>
                    <span class="sr-only">Alpha</span>
                    <input
                        type="range"
                        min={0}
                        max={255}
                        step={1}
                        value={hsva.a}
                        data-testid="alpha"
                        onInput={(e) => {
                            set({ ...hsva, a: Number(e.currentTarget.value) })
                        }}
                    />
                </label>

                <div class={styles.numbers}>
                    <label class={styles.hexField}>
                        hex
                        <input
                            type="text"
                            class="mono"
                            value={hex}
                            spellcheck={false}
                            autocomplete="off"
                            maxLength={9}
                            aria-label="Hex color"
                            data-testid="hex"
                            onChange={(e) => {
                                const parsed = parseHex(e.currentTarget.value)
                                if (parsed === null) e.currentTarget.value = hex
                                else setColor(parsed)
                            }}
                        />
                    </label>

                    {CHANNELS.map((channel) => (
                        <label key={channel.key} class={styles.channel}>
                            {channel.label}
                            <input
                                type="number"
                                class="mono"
                                min={0}
                                max={255}
                                value={(state.color >>> channel.shift) & 0xff}
                                aria-label={`${channel.label} channel`}
                                data-testid={`channel-${channel.key}`}
                                onInput={(e) => {
                                    const value = Number(e.currentTarget.value)
                                    if (!Number.isInteger(value) || value < 0 || value > 255) return
                                    const mask = ~(0xff << channel.shift) >>> 0
                                    setColor(
                                        ((state.color & mask) | (value << channel.shift)) >>> 0,
                                    )
                                }}
                            />
                        </label>
                    ))}
                </div>

                <div class={styles.recent}>
                    <span class="dim">recent</span>
                    <div class={styles.recentRow} data-testid="recent-colors">
                        {state.recentColors.map((color) => (
                            <button
                                key={color}
                                type="button"
                                class={`chip chip-empty ${styles.recentChip}`}
                                style={{
                                    backgroundImage: `linear-gradient(${rgbaToHex(color)}, ${rgbaToHex(color)})`,
                                }}
                                title={rgbaToHex(color)}
                                aria-label={`Recent color ${rgbaToHex(color)}`}
                                onClick={() => {
                                    setColor(color)
                                }}
                            />
                        ))}
                    </div>
                </div>
            </div>

            <div class={styles.actions}>
                <button
                    type="button"
                    class={styles.action}
                    disabled={inPalette}
                    title={inPalette ? 'Already in the palette' : 'Add this color to the palette'}
                    data-testid="add-to-palette"
                    onClick={() => {
                        onAddToPalette(state.color)
                    }}
                >
                    Add to palette
                </button>
                <button
                    type="button"
                    class={`${styles.action} ${styles.primary}`}
                    data-testid="color-done"
                    onClick={close}
                >
                    Done
                </button>
            </div>
        </dialog>
    )
}

function percent(value: number): number {
    return Math.round(value * 100)
}

function clamp01(value: number): number {
    return value < 0 ? 0 : value > 1 ? 1 : value
}

/** Accepts what the field shows plus the shorthands a person actually types. */
function parseHex(value: string): RGBA | null {
    const digits = value.trim().replace(/^#/, '').toLowerCase()
    const expanded =
        digits.length === 3 || digits.length === 4
            ? digits.replace(/./g, (digit) => digit + digit)
            : digits

    if (!/^(?:[0-9a-f]{6}|[0-9a-f]{8})$/.test(expanded)) return null
    return Number.parseInt(expanded.padEnd(8, 'f'), 16) >>> 0
}
