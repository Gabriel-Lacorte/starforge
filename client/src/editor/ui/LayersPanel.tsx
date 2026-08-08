import { BLEND_MODES, type BlendMode, type Cel, type Layer, type Sprite } from '@starforge/core'
import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { LayersController } from '../layers/layersController'
import type { EditorStore } from '../store'
import {
    DownIcon,
    DuplicateIcon,
    EyeClosedIcon,
    EyeOpenIcon,
    LockedIcon,
    PlusIcon,
    TrashIcon,
    UnlockedIcon,
    UpIcon,
} from './icons'
import { useStore } from './useStore'
import styles from './LayersPanel.module.css'

export function LayersPanel({
    sprite,
    store,
    layers,
}: {
    sprite: Sprite
    store: EditorStore
    layers: LayersController
}) {
    useStore(layers)
    const state = useStore(store)
    const [editing, setEditing] = useState<string | null>(null)

    const dragStart = useRef<number | null>(null)

    const frameId = sprite.frames[0]!.id
    const active = sprite.layers.find((l) => l.id === state.activeLayer)
    const rows = [...sprite.layers].reverse()

    const commitRename = (layer: Layer, value: string | null) => {
        if (value !== null) layers.rename(layer.id, value)
        setEditing(null)
    }

    return (
        <aside class={`bar ${styles.panel}`} data-testid="layers-panel">
            <header class={styles.header}>Layers</header>

            <ul class={styles.list}>
                {rows.map((layer) => {
                    const isActive = layer.id === state.activeLayer
                    return (
                        <li
                            key={layer.id}
                            class={`${styles.row}${isActive ? ` ${styles.active}` : ''}${layer.visible ? '' : ` ${styles.hidden}`}`}
                            data-testid="layer-row"
                            data-layer-id={layer.id}
                            aria-current={isActive}
                            onClick={() => layers.setActive(layer.id)}
                        >
                            <Thumb
                                cel={layer.cels.get(frameId)}
                                width={sprite.width}
                                height={sprite.height}
                            />
                            {editing === layer.id ? (
                                <NameInput
                                    initial={layer.name}
                                    onSettle={(value) => {
                                        commitRename(layer, value)
                                    }}
                                />
                            ) : (
                                <span
                                    class={styles.name}
                                    data-testid="layer-name"
                                    title={`${layer.name} (double-click to rename)`}
                                    onDblClick={() => setEditing(layer.id)}
                                >
                                    {layer.name}
                                </span>
                            )}
                            <button
                                type="button"
                                class={styles.rowBtn}
                                data-testid="layer-eye"
                                title={layer.visible ? 'Hide layer' : 'Show layer'}
                                aria-pressed={!layer.visible}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    layers.toggleVisible(layer.id)
                                    e.currentTarget.blur()
                                }}
                            >
                                {layer.visible ? <EyeOpenIcon /> : <EyeClosedIcon />}
                            </button>
                            <button
                                type="button"
                                class={`${styles.rowBtn}${layer.locked ? ` ${styles.lockedBtn}` : ''}`}
                                data-testid="layer-lock"
                                title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                                aria-pressed={layer.locked}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    layers.toggleLocked(layer.id)
                                    e.currentTarget.blur()
                                }}
                            >
                                {layer.locked ? <LockedIcon /> : <UnlockedIcon />}
                            </button>
                        </li>
                    )
                })}
            </ul>

            {active && (
                <div class={styles.props}>
                    <label class={styles.prop} title="Opacity of the active layer (0-255)">
                        <span class={styles.propName}>opacity</span>
                        <input
                            type="range"
                            min={0}
                            max={255}
                            value={active.opacity}
                            data-testid="layer-opacity"
                            onInput={(e) => {
                                dragStart.current ??= active.opacity
                                layers.previewOpacity(active.id, Number(e.currentTarget.value))
                            }}
                            onChange={(e) => {
                                const value = Number(e.currentTarget.value)
                                layers.commitOpacity(active.id, dragStart.current ?? value, value)
                                dragStart.current = null
                                e.currentTarget.blur()
                            }}
                        />
                        <span class="mono dim" data-testid="layer-opacity-value">
                            {active.opacity}
                        </span>
                    </label>
                    <label class={styles.prop} title="Blend mode of the active layer">
                        <span class={styles.propName}>blend</span>
                        <select
                            class={styles.blend}
                            data-testid="layer-blend"
                            value={active.blendMode}
                            onChange={(e) => {
                                layers.setBlendMode(active.id, e.currentTarget.value as BlendMode)
                                e.currentTarget.blur()
                            }}
                        >
                            {BLEND_MODES.map((mode) => (
                                <option key={mode} value={mode}>
                                    {mode}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            )}

            <div class={styles.actions}>
                <ActionButton
                    testid="layer-add"
                    title="New layer above the active one"
                    onPress={() => layers.add()}
                >
                    <PlusIcon />
                </ActionButton>
                <ActionButton
                    testid="layer-duplicate"
                    title="Duplicate the active layer"
                    onPress={() => active && layers.duplicate(active.id)}
                >
                    <DuplicateIcon />
                </ActionButton>
                <ActionButton
                    testid="layer-up"
                    title="Move the active layer up"
                    onPress={() => active && layers.moveUp(active.id)}
                >
                    <UpIcon />
                </ActionButton>
                <ActionButton
                    testid="layer-down"
                    title="Move the active layer down"
                    onPress={() => active && layers.moveDown(active.id)}
                >
                    <DownIcon />
                </ActionButton>
                <ActionButton
                    testid="layer-delete"
                    title="Delete the active layer"
                    disabled={sprite.layers.length <= 1}
                    onPress={() => active && layers.remove(active.id)}
                >
                    <TrashIcon />
                </ActionButton>
            </div>
        </aside>
    )
}

function NameInput({
    initial,
    onSettle,
}: {
    initial: string
    onSettle: (value: string | null) => void
}) {
    const ref = useRef<HTMLInputElement>(null)
    const abandoned = useRef(false)

    useEffect(() => {
        ref.current?.focus()
        ref.current?.select()
    }, [])

    return (
        <input
            ref={ref}
            class={styles.nameInput}
            data-testid="layer-name-input"
            value={initial}
            onBlur={(e) => {
                onSettle(abandoned.current ? null : e.currentTarget.value)
            }}
            onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                else if (e.key === 'Escape') {
                    abandoned.current = true
                    e.currentTarget.blur()
                }
            }}
        />
    )
}

function ActionButton({
    testid,
    title,
    disabled,
    onPress,
    children,
}: {
    testid: string
    title: string
    disabled?: boolean
    onPress: () => void
    children: ComponentChildren
}) {
    return (
        <button
            type="button"
            class={styles.actionBtn}
            data-testid={testid}
            title={title}
            aria-label={title}
            disabled={disabled}
            onClick={(e) => {
                onPress()
                e.currentTarget.blur()
            }}
        >
            {children}
        </button>
    )
}

const THUMB_SIZE = 24

let scratch: HTMLCanvasElement | null = null

function scratchFor(width: number, height: number): CanvasRenderingContext2D | null {
    scratch ??= document.createElement('canvas')
    if (scratch.width !== width || scratch.height !== height) {
        scratch.width = width
        scratch.height = height
    }
    return scratch.getContext('2d')
}

function Thumb({ cel, width, height }: { cel: Cel | undefined; width: number; height: number }) {
    const ref = useRef<HTMLCanvasElement>(null)
    const version = cel?.version ?? -1

    useEffect(() => {
        const ctx = ref.current?.getContext('2d')
        if (!ctx) return
        ctx.clearRect(0, 0, THUMB_SIZE, THUMB_SIZE)
        if (!cel) return

        const src = scratchFor(width, height)
        if (!src) return
        src.putImageData(
            new ImageData(
                new Uint8ClampedArray(
                    cel.pixels.buffer,
                    cel.pixels.byteOffset,
                    cel.pixels.byteLength,
                ),
                width,
                height,
            ),
            0,
            0,
        )
        ctx.drawImage(src.canvas, 0, 0, width, height, 0, 0, THUMB_SIZE, THUMB_SIZE)
    }, [cel, version, width, height])

    return (
        <canvas
            ref={ref}
            width={THUMB_SIZE}
            height={THUMB_SIZE}
            class={styles.thumb}
            data-testid="layer-thumb"
        />
    )
}
