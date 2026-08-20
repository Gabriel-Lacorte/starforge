import { PROJECT_FILE_LIMITS, ProjectFileError, createSprite } from '@starforge/core'
import { describe, expect, it } from 'vitest'
import {
    ProjectRecoveryError,
    createProjectBlob,
    downloadProjectBlob,
    openProjectTransaction,
    projectFilename,
    readProjectBlob,
    type DownloadEnvironment,
    type ProjectFileSource,
} from './projectFile'

describe('browser project file adapters', () => {
    it('creates and reads an application/json .starforge Blob', async () => {
        const sprite = createSprite({ width: 16, height: 16, title: 'Moon Café' })
        const workspace = {
            activeLayerId: sprite.layers[0]!.id,
            activeFrameId: sprite.frames[0]!.id,
        }
        const download = await createProjectBlob({ sprite, workspace })

        expect(download.filename).toBe('moon-cafe.starforge')
        expect(download.blob.type).toBe('application/json')
        const decoded = await readProjectBlob(download.blob)
        expect(decoded.sprite.id).toBe(sprite.id)
        expect(decoded.workspace).toEqual(workspace)
    })

    it('checks the declared size before reading bytes', async () => {
        let read = false
        const source: ProjectFileSource = {
            size: PROJECT_FILE_LIMITS.maxBytes + 1,
            arrayBuffer: () => {
                read = true
                return Promise.resolve(new ArrayBuffer(0))
            },
        }

        await expect(readProjectBlob(source)).rejects.toMatchObject({ code: 'LIMIT' })
        expect(read).toBe(false)
    })

    it('rejects a source that changes size while being read', async () => {
        const source: ProjectFileSource = {
            size: 12,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
        }

        await expect(readProjectBlob(source)).rejects.toMatchObject({ code: 'CORRUPTION' })
    })

    it('uses an object URL once and schedules its revocation', () => {
        const events: string[] = []
        const environment: DownloadEnvironment = {
            createObjectURL: () => {
                events.push('create')
                return 'blob:project'
            },
            click: (url, filename) => events.push(`click:${url}:${filename}`),
            revokeObjectURL: (url) => events.push(`revoke:${url}`),
            defer: (task) => {
                events.push('defer')
                task()
            },
        }

        downloadProjectBlob(
            { blob: new Blob(['project']), filename: 'sprite.starforge' },
            environment,
        )

        expect(events).toEqual([
            'create',
            'click:blob:project:sprite.starforge',
            'defer',
            'revoke:blob:project',
        ])
    })

    it('revokes immediately when the browser cannot start a download', () => {
        const revoked: string[] = []
        const environment: DownloadEnvironment = {
            createObjectURL: () => 'blob:failed',
            click: () => {
                throw new Error('blocked')
            },
            revokeObjectURL: (url) => revoked.push(url),
            defer: () => {
                throw new Error('must not defer')
            },
        }

        expect(() =>
            downloadProjectBlob(
                { blob: new Blob(['project']), filename: 'sprite.starforge' },
                environment,
            ),
        ).toThrow('blocked')
        expect(revoked).toEqual(['blob:failed'])
    })

    it('decodes, secures the current document, then replaces it', async () => {
        const current = createSprite({ width: 16, height: 16, title: 'Current' })
        const incoming = createSprite({ width: 16, height: 16, title: 'Incoming' })
        const incomingFile = await createProjectBlob({
            sprite: incoming,
            workspace: {
                activeLayerId: incoming.layers[0]!.id,
                activeFrameId: incoming.frames[0]!.id,
            },
        })
        const events: string[] = []

        await openProjectTransaction(
            incomingFile.blob,
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

    it('never preserves or replaces when decode fails', async () => {
        const current = createSprite({ width: 16, height: 16 })
        let preserved = false
        let replaced = false

        await expect(
            openProjectTransaction(
                new Blob(['{"format":']),
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
        ).rejects.toBeInstanceOf(ProjectFileError)
        expect(preserved).toBe(false)
        expect(replaced).toBe(false)
    })

    it('does not replace when the current document cannot be secured', async () => {
        const current = createSprite({ width: 16, height: 16 })
        const incoming = createSprite({ width: 16, height: 16 })
        const incomingFile = await createProjectBlob({
            sprite: incoming,
            workspace: {
                activeLayerId: incoming.layers[0]!.id,
                activeFrameId: incoming.frames[0]!.id,
            },
        })
        let replaced = false

        await expect(
            openProjectTransaction(
                incomingFile.blob,
                { sprite: current, activeLayer: current.layers[0]!.id },
                () => {
                    replaced = true
                },
                { preserveCurrent: () => false },
            ),
        ).rejects.toBeInstanceOf(ProjectRecoveryError)
        expect(replaced).toBe(false)
    })

    it('sanitizes project names and always provides a fallback', () => {
        expect(projectFilename('  CON / sky ✦ study  ')).toBe('con-sky-study.starforge')
        expect(projectFilename('✨')).toBe('starforge.starforge')
        expect(projectFilename('a'.repeat(100))).toBe(`${'a'.repeat(80)}.starforge`)
    })
})
