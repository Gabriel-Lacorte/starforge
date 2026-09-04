import {
    createSprite,
    decodeSprite,
    documentFingerprint,
    encodeSprite,
    type DecodedProject,
    type Sprite,
} from '@starforge/core'
import { useEffect, useState } from 'preact/hooks'
import { DocumentSession } from '../document/session'
import { createStarterSprite } from '../document/starterSprite'
import { EditorCanvas } from '../editor/EditorCanvas'
import type { OpenedDocument } from '../storage/library'
import { createCrdtDemo, type CrdtDemo } from './crdtDemo'
import styles from './CrdtLab.module.css'

interface LabPair {
    readonly id: string
    readonly left: DocumentSession
    readonly right: DocumentSession
    readonly initialLayer: string
    readonly initialFrame: string
    readonly demo: CrdtDemo
}

function clone(sprite: Sprite): Sprite {
    return decodeSprite(encodeSprite(sprite))
}

function createPair(sprite: Sprite, initialLayer: string, initialFrame: string): LabPair {
    const left = new DocumentSession(clone(sprite), {
        author: 'crdt-lab-site-1',
        target: { layer: initialLayer, frame: initialFrame },
    })
    const right = new DocumentSession(clone(sprite), {
        author: 'crdt-lab-site-2',
        target: { layer: initialLayer, frame: initialFrame },
    })

    return {
        id: crypto.randomUUID(),
        left,
        right,
        initialLayer,
        initialFrame,
        demo: createCrdtDemo(left, right, 1, 2),
    }
}

function starterPair(): LabPair {
    const starter = createStarterSprite()
    return createPair(starter.sprite, starter.activeLayer, starter.sprite.frames[0]!.id)
}

export function CrdtLab() {
    const [pair, setPair] = useState(starterPair)
    const [activeSite, setActiveSite] = useState<1 | 2>(1)
    const [, renderQueue] = useState(0)

    useEffect(() => pair.demo.subscribe(() => renderQueue((revision) => revision + 1)), [pair])

    const queued = pair.demo.queue.length
    const converged = documentFingerprint(pair.left.doc) === documentFingerprint(pair.right.doc)

    const replace = (sprite: Sprite, layer: string, frame: string) => {
        setPair(createPair(sprite, layer, frame))
    }
    const createNew = (width: number, height: number, title: string) => {
        const sprite = createSprite({ width, height, title })
        replace(sprite, sprite.layers[0]!.id, sprite.frames[0]!.id)
    }
    const openStored = (opened: OpenedDocument) => {
        replace(opened.sprite, opened.activeLayer, opened.activeFrame)
    }
    const openProject = (project: DecodedProject) => {
        replace(project.sprite, project.workspace.activeLayerId, project.workspace.activeFrameId)
    }

    const editor = (site: 1 | 2) => {
        const session = site === 1 ? pair.left : pair.right
        return (
            <section
                key={`${pair.id}-${site}`}
                class={styles.site}
                data-testid={`crdt-site-${site}`}
                onPointerDown={() => setActiveSite(site)}
                onFocusCapture={() => setActiveSite(site)}
            >
                <header class={styles.siteHeader}>
                    <span class={`${styles.siteDot} ${site === 1 ? styles.gold : styles.blue}`} />
                    <strong>site {site}</strong>
                    <span class={styles.siteHint}>independent editor</span>
                </header>
                <div class={styles.editorHost}>
                    <EditorCanvas
                        sprite={session.doc}
                        session={session}
                        active={activeSite === site}
                        library={null}
                        storageNotice={null}
                        initialLayer={pair.initialLayer}
                        initialFrame={pair.initialFrame}
                        initialProjectNotice={null}
                        initialLayersOpen={false}
                        hideFileActions
                        onNew={createNew}
                        onOpenStored={openStored}
                        onOpenProject={openProject}
                    />
                </div>
            </section>
        )
    }

    return (
        <main class={styles.lab}>
            <header class={`bar ${styles.controls}`}>
                <div class={styles.title}>
                    <strong>CRDT lab</strong>
                    <span>multiplayer without a server</span>
                </div>
                <p class={styles.state} data-testid="crdt-status" aria-live="polite">
                    <strong class="mono" data-testid="crdt-queue-count">
                        {queued}
                    </strong>{' '}
                    {queued === 1 ? 'message' : 'messages'} in flight
                    <span aria-hidden="true"> · </span>
                    {converged ? 'documents match' : 'documents differ'}
                </p>
                <div class={styles.actions}>
                    <button
                        type="button"
                        data-testid="crdt-reverse"
                        disabled={queued < 2}
                        onClick={() => pair.demo.reverse()}
                    >
                        reverse
                    </button>
                    <button
                        type="button"
                        data-testid="crdt-duplicate"
                        disabled={queued === 0}
                        onClick={() => pair.demo.duplicate(0)}
                    >
                        duplicate first
                    </button>
                    <button
                        type="button"
                        data-testid="crdt-deliver-all"
                        disabled={queued === 0}
                        onClick={() => pair.demo.deliverAll()}
                    >
                        deliver all
                    </button>
                    <button type="button" onClick={() => setPair(starterPair())}>
                        reset
                    </button>
                </div>
            </header>
            <div class={styles.sites}>
                {editor(1)}
                {editor(2)}
            </div>
        </main>
    )
}
