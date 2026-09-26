import { Fragment } from 'preact'
import { useEffect } from 'preact/hooks'
import { FRAME_DURATION_MAX, FRAME_DURATION_MIN } from '@starforge/core'
import type { FramesController } from '../frames/framesController'
import type { FrameThumbnails } from '../frames/frameThumbnails'
import type { PlaybackController } from '../frames/playbackController'
import type { EditTarget, Store } from '../../store'
import {
    DuplicateIcon,
    LeftIcon,
    OnionIcon,
    PauseIcon,
    PlayIcon,
    PlusIcon,
    RightIcon,
    TrashIcon,
} from './icons'
import { useStore, type Subscribable } from './useStore'
import styles from './Timeline.module.css'
import { blurOnPointer } from './blurOnPointer'
import type { EditorStore } from '../store'

export function Timeline({
    frames,
    playback,
    target,
    store,
    revision,
    thumbs,
}: {
    frames: FramesController
    playback: PlaybackController
    target: Store<EditTarget>
    store: EditorStore
    revision: Subscribable<unknown>
    thumbs: FrameThumbnails
}) {
    useStore(revision)
    const reel = useStore(playback)
    const edited = useStore(target).frame
    const active = reel.playing ? reel.frame : edited
    const list = frames.frames
    const index = list.findIndex((frame) => frame.id === active)
    const current = list[index]

    // thumbnails repaint only the frames whose content stamp moved
    useEffect(() => {
        thumbs.sync(list)
    })

    useStore(store)
    const onion = store.onionShown
    const onionClass = [styles.tool, onion && styles.on, reel.playing && styles.muted]
        .filter(Boolean)
        .join(' ')
    const onionTitle = reel.playing
        ? 'The ghosts stay hidden while the reel plays'
        : onion
          ? 'Hide the neighbour frames'
          : 'Show the neighbour frames behind this one'

    const insertGap = (key: string, after: string | null, at: number) => (
        <li key={key} class={styles.gap}>
            <button
                type="button"
                class={styles.insert}
                title={
                    after === null
                        ? 'Insert a frame before frame 1'
                        : `Insert a frame after frame ${at}`
                }
                aria-label={
                    after === null
                        ? 'Insert a frame before frame 1'
                        : `Insert a frame after frame ${at}`
                }
                data-testid="frame-insert"
                onClick={(e) => {
                    frames.add(after)
                    blurOnPointer(e)
                }}
            >
                <PlusIcon />
            </button>
        </li>
    )

    return (
        <div class={`bar ${styles.timeline}`}>
            <span class={styles.label}>frames</span>

            <span class={styles.transport}>
                <button
                    type="button"
                    class={styles.tool}
                    title={
                        reel.playing ? 'Stop the animation (Enter)' : 'Play the animation (Enter)'
                    }
                    aria-label={reel.playing ? 'Stop the animation' : 'Play the animation'}
                    data-testid="playback-toggle"
                    disabled={!playback.canPlay}
                    onClick={(e) => {
                        playback.toggle()
                        blurOnPointer(e)
                    }}
                >
                    {reel.playing ? <PauseIcon /> : <PlayIcon />}
                </button>
                <button
                    type="button"
                    class={`${styles.chip}${reel.loop ? ` ${styles.on}` : ''}`}
                    title="Start again at the end of the reel"
                    aria-pressed={reel.loop}
                    data-testid="playback-loop"
                    onClick={(e) => {
                        playback.setLoop(!reel.loop)
                        blurOnPointer(e)
                    }}
                >
                    loop
                </button>
                <button
                    type="button"
                    class={onionClass}
                    title={onionTitle}
                    aria-label="Onion skin"
                    aria-pressed={onion}
                    data-testid="onion"
                    onClick={(e) => {
                        store.setOnion(!onion)
                        blurOnPointer(e)
                    }}
                >
                    <OnionIcon />
                </button>
            </span>

            <ol class={styles.reel} data-testid="timeline">
                {list.map((frame, at) => (
                    <Fragment key={frame.id}>
                        {insertGap(`${frame.id}-gap`, at === 0 ? null : list[at - 1]!.id, at)}
                        <li>
                            <button
                                type="button"
                                class={`${styles.cell}${frame.id === active ? ` ${styles.on}` : ''}`}
                                title={`Frame ${at + 1}, ${frame.duration} ms`}
                                aria-label={`Frame ${at + 1}`}
                                aria-current={frame.id === active}
                                data-testid="frame-cell"
                                onClick={(e) => {
                                    frames.select(frame.id)
                                    blurOnPointer(e)
                                }}
                            >
                                <span class={styles.index}>{at + 1}</span>
                                <canvas
                                    class={styles.thumb}
                                    ref={(el) => {
                                        thumbs.track(frame.id, el)
                                    }}
                                />
                            </button>
                        </li>
                    </Fragment>
                ))}
                {insertGap('reel-tail', list[list.length - 1]?.id ?? null, list.length)}
            </ol>

            <label class={styles.duration} title="How long this frame is shown">
                ms
                <input
                    type="number"
                    class="mono"
                    min={FRAME_DURATION_MIN}
                    max={FRAME_DURATION_MAX}
                    value={current?.duration ?? 0}
                    aria-label="Frame duration in milliseconds"
                    data-testid="frame-duration"
                    onChange={(e) => {
                        const raw = e.currentTarget.value.trim()
                        const typed = Math.round(Number(raw))
                        const next =
                            raw !== '' && Number.isFinite(typed)
                                ? Math.min(FRAME_DURATION_MAX, Math.max(FRAME_DURATION_MIN, typed))
                                : (current?.duration ?? 0)
                        if (current) frames.setDuration(current.id, next)
                        e.currentTarget.value = String(next)
                    }}
                />
            </label>

            <span class={styles.tools}>
                <button
                    type="button"
                    class={styles.tool}
                    title="Move this frame earlier"
                    aria-label="Move frame earlier"
                    data-testid="frame-earlier"
                    disabled={index <= 0}
                    onClick={() => frames.moveEarlier(active)}
                >
                    <LeftIcon />
                </button>
                <button
                    type="button"
                    class={styles.tool}
                    title="Move this frame later"
                    aria-label="Move frame later"
                    data-testid="frame-later"
                    disabled={index === -1 || index >= list.length - 1}
                    onClick={() => frames.moveLater(active)}
                >
                    <RightIcon />
                </button>
                <button
                    type="button"
                    class={styles.tool}
                    title="Add an empty frame after this one"
                    aria-label="Add frame"
                    data-testid="frame-add"
                    onClick={() => frames.add()}
                >
                    <PlusIcon />
                </button>
                <button
                    type="button"
                    class={styles.tool}
                    title="Duplicate this frame, pixels and all"
                    aria-label="Duplicate frame"
                    data-testid="frame-duplicate"
                    onClick={() => frames.duplicate()}
                >
                    <DuplicateIcon />
                </button>
                <button
                    type="button"
                    class={styles.tool}
                    title="Remove this frame"
                    aria-label="Remove frame"
                    data-testid="frame-remove"
                    disabled={list.length <= 1}
                    onClick={() => frames.remove(active)}
                >
                    <TrashIcon />
                </button>
            </span>
        </div>
    )
}
