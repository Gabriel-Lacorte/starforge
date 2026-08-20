import { describe, expect, it } from 'vitest'
import { createFrame, createSprite, insertFrame, type Sprite } from '@starforge/core'
import { DocumentSession } from '../../document/session'
import { PlaybackController } from './playbackController'

function setup(): {
    sprite: Sprite
    session: DocumentSession
    playback: PlaybackController
    ids: [string, string, string]
} {
    const sprite = createSprite({ width: 16, height: 16 })
    const first = sprite.frames[0]!.id
    sprite.frames[0]!.duration = 100
    insertFrame(sprite, createFrame(30, 'second'), first)
    insertFrame(sprite, createFrame(70, 'third'), 'second')

    const session = new DocumentSession(sprite)
    return {
        sprite,
        session,
        playback: new PlaybackController(sprite, session),
        ids: [first, 'second', 'third'],
    }
}

function play(playback: PlaybackController, times: readonly number[]): void {
    playback.play()
    playback.tick(0)
    for (const now of times) playback.tick(now)
}

describe('playback leaves the document alone', () => {
    it('never moves the edit target while it runs', () => {
        const { session, playback, ids } = setup()

        play(playback, [100, 130, 190])

        expect(playback.state.playing).toBe(true)
        expect(playback.state.frame).toBe(ids[2])
        expect(session.target.state.frame).toBe(ids[0])
    })

    it('does not touch the document, so nothing asks to be saved', () => {
        const { sprite, playback } = setup()
        const revision = sprite.revision

        play(playback, [100, 200, 300])

        expect(sprite.revision).toBe(revision)
    })
})

describe('stopping the reel', () => {
    it('leaves the artist on the frame that was showing', () => {
        const { session, playback, ids } = setup()

        play(playback, [100])
        expect(playback.state.frame).toBe(ids[1])

        playback.pause()
        expect(session.target.state.frame).toBe(ids[1])
        expect(playback.frame).toBe(ids[1])
    })

    it('stops itself at the end of a reel that does not loop', () => {
        const { session, playback, ids } = setup()
        playback.setLoop(false)

        play(playback, [1000])

        expect(playback.state.playing).toBe(false)
        expect(session.target.state.frame).toBe(ids[2])
    })

    it('pausing twice is not an error, and does not move the target again', () => {
        const { session, playback, ids } = setup()

        play(playback, [100])
        playback.pause()
        session.setTarget({ frame: ids[0] })
        playback.pause()

        expect(session.target.state.frame).toBe(ids[0])
    })

    it('survives a listener that pauses it while it is settling', () => {
        const { session, playback, ids } = setup()
        session.setBeforeChange(() => {
            playback.pause()
        })

        play(playback, [100])
        playback.pause()

        expect(session.target.state.frame).toBe(ids[1])
        expect(playback.state.playing).toBe(false)
    })
})

describe('what the reel shows', () => {
    it('follows the target when it is not playing', () => {
        const { session, playback, ids } = setup()

        session.setTarget({ frame: ids[2] })
        expect(playback.frame).toBe(ids[2])
    })

    it('tells its listeners once per frame, not once per tick', () => {
        const { playback } = setup()
        let told = 0
        playback.subscribe(() => told++)

        playback.play()
        told = 0
        for (let now = 0; now <= 100; now += 10) playback.tick(now)

        expect(told).toBe(1)
    })

    it('refuses to play a single frame', () => {
        const sprite = createSprite({ width: 16, height: 16 })
        const playback = new PlaybackController(sprite, new DocumentSession(sprite))

        playback.play()

        expect(playback.canPlay).toBe(false)
        expect(playback.state.playing).toBe(false)
    })

    it('starts from the frame being edited, not from the top of the reel', () => {
        const { session, playback, ids } = setup()
        session.setTarget({ frame: ids[1] })

        playback.play()

        expect(playback.state.frame).toBe(ids[1])
    })

    it('ignores a tick when nothing is playing', () => {
        const { playback, ids } = setup()

        playback.tick(1000)

        expect(playback.frame).toBe(ids[0])
    })
})
