import {
    PORTABLE_PNG_LIMITS,
    decodeProject,
    extractProjectFromPng,
    type Sha256Digest,
} from '@starforge/core'
import { describe, expect, it } from 'vitest'
import { createStarterSprite } from '../document/starterSprite'
import { VALID_PNG } from '../testing/validPng'
import { createPortablePng } from './portablePng'

describe('portable PNG browser adapter', () => {
    it('creates an image/png download with a canonical embedded project', async () => {
        const sprite = createStarterSprite().sprite
        sprite.meta.title = 'Moon Café'
        const workspace = {
            activeLayerId: sprite.layers[0]!.id,
            activeFrameId: sprite.frames[0]!.id,
        }

        const file = await createPortablePng(new Blob([VALID_PNG], { type: 'image/png' }), {
            sprite,
            workspace,
        })

        expect(file.filename).toBe('moon-cafe.starforge.png')
        expect(file.blob.type).toBe('image/png')
        const project = await extractProjectFromPng(
            new Uint8Array(await file.blob.arrayBuffer()),
            sha256,
        )
        expect(project).not.toBeNull()
        expect((await decodeProject(project!, sha256)).workspace).toEqual(workspace)
    })

    it('checks the visual PNG size before reading it', async () => {
        let read = false
        const visual = {
            size: PORTABLE_PNG_LIMITS.maxPngBytes + 1,
            arrayBuffer: () => {
                read = true
                return Promise.resolve(new ArrayBuffer(0))
            },
        } as Blob
        const sprite = createStarterSprite().sprite

        await expect(
            createPortablePng(visual, {
                sprite,
                workspace: {
                    activeLayerId: sprite.layers[0]!.id,
                    activeFrameId: sprite.frames[0]!.id,
                },
            }),
        ).rejects.toMatchObject({ code: 'LIMIT' })
        expect(read).toBe(false)
    })

    it('rejects a visual Blob that changes while being read', async () => {
        const visual = {
            size: VALID_PNG.length + 1,
            arrayBuffer: () => Promise.resolve(VALID_PNG.buffer.slice(0)),
        } as Blob
        const sprite = createStarterSprite().sprite

        await expect(
            createPortablePng(visual, {
                sprite,
                workspace: {
                    activeLayerId: sprite.layers[0]!.id,
                    activeFrameId: sprite.frames[0]!.id,
                },
            }),
        ).rejects.toMatchObject({ code: 'CORRUPTION' })
    })

    it('captures project state before asynchronous PNG encoding can interleave edits', async () => {
        const sprite = createStarterSprite().sprite
        sprite.meta.title = 'Before'
        const pending = createPortablePng(new Blob([VALID_PNG]), {
            sprite,
            workspace: {
                activeLayerId: sprite.layers[0]!.id,
                activeFrameId: sprite.frames[0]!.id,
            },
        })

        sprite.meta.title = 'After'
        const file = await pending
        const project = await extractProjectFromPng(
            new Uint8Array(await file.blob.arrayBuffer()),
            sha256,
        )

        expect((await decodeProject(project!, sha256)).sprite.meta.title).toBe('Before')
    })
})

const sha256: Sha256Digest = async (bytes) => {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
}
