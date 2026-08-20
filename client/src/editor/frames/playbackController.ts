import { advancePlayback, startPlayback, type PlaybackState, type Sprite } from '@starforge/core'
import type { DocumentSession } from '../../document/session'
import { Store } from '../../store'

export interface PlaybackView {
    readonly playing: boolean
    readonly loop: boolean
    readonly frame: string
}

export class PlaybackController extends Store<PlaybackView> {
    readonly #sprite: Sprite
    readonly #session: DocumentSession

    #clock: PlaybackState | null = null
    #last = -1

    constructor(sprite: Sprite, session: DocumentSession) {
        super({ playing: false, loop: true, frame: '' })
        this.#sprite = sprite
        this.#session = session
    }

    get frame(): string {
        return this.state.playing ? this.state.frame : this.#session.target.state.frame
    }

    get canPlay(): boolean {
        return this.#sprite.frames.length > 1
    }

    play(): void {
        if (this.state.playing || !this.canPlay) return

        this.#clock = startPlayback(this.#sprite.frames, this.#session.target.state.frame)
        this.#last = -1
        this.patch({ playing: true, frame: this.#clock.frame })
    }

    pause(): void {
        if (!this.state.playing) return

        this.#settle(this.state.frame)
    }

    toggle(): void {
        if (this.state.playing) this.pause()
        else this.play()
    }

    setLoop(loop: boolean): void {
        if (loop !== this.state.loop) this.patch({ loop })
    }

    tick(now: number): void {
        const clock = this.#clock
        if (!clock) return

        if (this.#last < 0) {
            this.#last = now
            return
        }

        const delta = now - this.#last
        this.#last = now

        const next = advancePlayback(this.#sprite.frames, clock, delta, this.state.loop)
        if (next === clock) return

        this.#clock = next
        if (!next.playing) this.#settle(next.frame)
        else if (next.frame !== this.state.frame) this.patch({ frame: next.frame })
    }

    #settle(frame: string): void {
        this.#clock = null
        this.#last = -1

        this.patch({ playing: false, frame: '' })
        this.#session.setTarget({ frame })
    }
}
