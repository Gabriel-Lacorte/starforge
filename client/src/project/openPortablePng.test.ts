import { PORTABLE_PNG_LIMITS, type Sha256Digest } from '@starforge/core'
import { describe, expect, it } from 'vitest'
import { createStarterSprite } from '../document/starterSprite'
import { createPortablePng } from '../export/portablePng'
import { VALID_PNG } from '../testing/validPng'
import { createProjectBlob, type ProjectFileSource } from './projectFile'
import {
    PortableProjectMissingError,
    openProjectFileTransaction,
    readOpenProjectFile,
} from './openPortablePng'

describe('opening Starforge files and portable PNGs', () => {
    it('recognizes and decodes portable PNG content without trusting MIME or extension', async () => {
        const incoming = createStarterSprite().sprite
        incoming.meta.title = 'Portable'
        const workspace = {
            activeLayerId: incoming.layers[0]!.id,
            activeFrameId: incoming.frames[0]!.id,
        }
        const portable = await createPortablePng(new Blob([VALID_PNG]), {
            sprite: incoming,
            workspace,
        })

        const decoded = await readOpenProjectFile(portable.blob)

        expect(decoded.sprite.meta.title).toBe('Portable')
        expect(decoded.workspace).toEqual(workspace)
    })

    it('continues to decode canonical .starforge files through the same boundary', async () => {
        const incoming = createStarterSprite().sprite
        const project = await createProjectBlob({
            sprite: incoming,
            workspace: {
                activeLayerId: incoming.layers[0]!.id,
                activeFrameId: incoming.frames[0]!.id,
            },
        })

        await expect(readOpenProjectFile(project.blob)).resolves.toMatchObject({
            sprite: { id: incoming.id },
        })
    })

    it('reports a valid visual PNG without editable data and keeps the current document', async () => {
        const current = createStarterSprite().sprite
        let preserved = false
        let replaced = false

        await expect(
            openProjectFileTransaction(
                new Blob([VALID_PNG]),
                { sprite: current, activeLayer: current.layers[0]!.id },
                () => {
                    replaced = true
                },
                {
                    preserveCurrent: () => {
                        preserved = true
                        return true
                    },
                },
            ),
        ).rejects.toBeInstanceOf(PortableProjectMissingError)
        expect(preserved).toBe(false)
        expect(replaced).toBe(false)
    })

    it('rejects a bad PNG CRC before recovery or replacement', async () => {
        const current = createStarterSprite().sprite
        const corrupted = VALID_PNG.slice()
        corrupted[41] = corrupted[41]! ^ 1
        let preserved = false
        let replaced = false

        await expect(
            openProjectFileTransaction(
                new Blob([corrupted]),
                { sprite: current, activeLayer: current.layers[0]!.id },
                () => {
                    replaced = true
                },
                {
                    preserveCurrent: () => {
                        preserved = true
                        return true
                    },
                },
            ),
        ).rejects.toMatchObject({ code: 'CHECKSUM' })
        expect(preserved).toBe(false)
        expect(replaced).toBe(false)
    })

    it('secures current work only after the complete portable decode', async () => {
        const current = createStarterSprite().sprite
        const incoming = createStarterSprite().sprite
        incoming.meta.title = 'Incoming'
        const portable = await createPortablePng(new Blob([VALID_PNG]), {
            sprite: incoming,
            workspace: {
                activeLayerId: incoming.layers[0]!.id,
                activeFrameId: incoming.frames[0]!.id,
            },
        })
        const events: string[] = []

        await openProjectFileTransaction(
            portable.blob,
            { sprite: current, activeLayer: current.layers[0]!.id },
            (project) => events.push(`replace:${project.sprite.meta.title}`),
            {
                preserveCurrent: () => {
                    events.push('preserve')
                    return true
                },
            },
        )

        expect(events).toEqual(['preserve', 'replace:Incoming'])
    })

    it('checks the portable PNG size before reading bytes', async () => {
        let read = false
        const source: ProjectFileSource = {
            size: PORTABLE_PNG_LIMITS.maxPngBytes + 1,
            arrayBuffer: () => {
                read = true
                return Promise.resolve(new ArrayBuffer(0))
            },
        }

        await expect(readOpenProjectFile(source)).rejects.toMatchObject({ code: 'LIMIT' })
        expect(read).toBe(false)
    })

    it('rejects an invalid digest provider without replacing the document', async () => {
        const current = createStarterSprite().sprite
        const incoming = createStarterSprite().sprite
        const portable = await createPortablePng(new Blob([VALID_PNG]), {
            sprite: incoming,
            workspace: {
                activeLayerId: incoming.layers[0]!.id,
                activeFrameId: incoming.frames[0]!.id,
            },
        })
        let replaced = false
        const invalidDigest: Sha256Digest = () => Promise.resolve(new Uint8Array(31))

        await expect(
            openProjectFileTransaction(
                portable.blob,
                { sprite: current, activeLayer: current.layers[0]!.id },
                () => {
                    replaced = true
                },
                { digest: invalidDigest, preserveCurrent: () => true },
            ),
        ).rejects.toMatchObject({ code: 'CORRUPTION' })
        expect(replaced).toBe(false)
    })
})
