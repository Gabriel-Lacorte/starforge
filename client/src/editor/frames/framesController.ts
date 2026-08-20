import {
    copyFrameCels,
    createFrame,
    DEFAULT_FRAME_DURATION,
    FRAME_DURATION_MAX,
    FRAME_DURATION_MIN,
    type Frame,
    type Sprite,
} from '@starforge/core'
import type { DocumentSession } from '../../document/session'

export class FramesController {
    readonly #sprite: Sprite
    readonly #session: DocumentSession

    constructor(sprite: Sprite, session: DocumentSession) {
        this.#sprite = sprite
        this.#session = session
    }

    get frames(): readonly Frame[] {
        return this.#sprite.frames
    }

    add(after: string = this.#session.target.state.frame): void {
        if (!this.#has(after)) return

        const frame = createFrame(DEFAULT_FRAME_DURATION)
        this.#session.apply('add frame', { kind: 'frame.add', frame, after })
        this.#session.setTarget({ frame: frame.id })
    }

    duplicate(id: string = this.#session.target.state.frame): void {
        if (!this.#has(id)) return

        const source = this.#sprite.frames.find((frame) => frame.id === id)!
        const frame = createFrame(source.duration)
        this.#session.apply('duplicate frame', {
            kind: 'frame.add',
            frame,
            after: id,
            cels: copyFrameCels(this.#sprite, id),
        })
        this.#session.setTarget({ frame: frame.id })
    }

    remove(id: string): void {
        if (!this.#has(id) || this.#sprite.frames.length <= 1) return

        this.#session.apply('remove frame', { kind: 'frame.remove', frame: id })
    }

    moveEarlier(id: string): void {
        const index = this.#indexOf(id)
        if (index <= 0) return

        this.#session.apply('move frame', {
            kind: 'frame.move',
            frame: id,
            after: this.#sprite.frames[index - 2]?.id ?? null,
        })
    }

    moveLater(id: string): void {
        const index = this.#indexOf(id)
        const next = this.#sprite.frames[index + 1]
        if (index === -1 || !next) return

        this.#session.apply('move frame', { kind: 'frame.move', frame: id, after: next.id })
    }

    setDuration(id: string, duration: number): void {
        const frame = this.#sprite.frames.find((candidate) => candidate.id === id)
        if (!frame || frame.duration === duration) return
        if (
            !Number.isInteger(duration) ||
            duration < FRAME_DURATION_MIN ||
            duration > FRAME_DURATION_MAX
        ) {
            return
        }

        this.#session.apply('frame duration', { kind: 'frame.setDuration', frame: id, duration })
    }

    select(id: string): void {
        this.#session.setTarget({ frame: id })
    }

    #has(id: string): boolean {
        return this.#sprite.frames.some((frame) => frame.id === id)
    }

    #indexOf(id: string): number {
        return this.#sprite.frames.findIndex((frame) => frame.id === id)
    }
}
