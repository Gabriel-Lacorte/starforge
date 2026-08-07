import { Command, openCursor, type CelCursor, type Sprite } from '@starforge/core'
import type { DocumentSession } from '../document/session'
import type { PreviewOverlay } from '../render/overlay'
import type { Renderer } from '../render/renderer'
import type { EditorStore } from './store'
import { makeTool, type GestureToolId, type Mods, type Tool, type ToolHost } from './tools'

interface GestureDeps {
    sprite: Sprite
    layer: string
    frame: string
    session: DocumentSession
    renderer: Renderer
    overlay: PreviewOverlay
    store: EditorStore
    requestRender: () => void
}

export class GestureController {
    readonly #deps: GestureDeps
    readonly #host: ToolHost

    #tool: Tool | null = null
    #command: Command | null = null

    #cursor: CelCursor | null = null

    #dirtyMinX = 0
    #dirtyMinY = 0
    #dirtyMaxX = -1
    #dirtyMaxY = -1

    constructor(deps: GestureDeps) {
        this.#deps = deps
        this.#host = {
            sprite: deps.sprite,
            layer: deps.layer,
            frame: deps.frame,

            get state() {
                return deps.store.state
            },

            write: (x, y, color) => {
                this.#cursor?.set(x, y, color)
            },

            absorb: (writes) => {
                if (!this.#command) return
                for (const write of writes) {
                    this.#command.record(write)
                    this.#extendDirty(write.x, write.y)
                }
            },

            preview: (cells, color) => {
                deps.overlay.setCells(cells, color)
                deps.requestRender()
            },
            clearPreview: () => {
                deps.overlay.clear()
                deps.requestRender()
            },
        }
    }

    get active(): boolean {
        return this.#tool !== null
    }

    begin(tool: GestureToolId, x: number, y: number, mods: Mods): void {
        if (this.#tool) return

        const command = new Command(tool)
        this.#command = command

        this.#cursor = openCursor(
            this.#deps.sprite,
            this.#deps.layer,
            this.#deps.frame,
            (write) => {
                command.record(write)
                this.#extendDirty(write.x, write.y)
            },
        )

        this.#tool = makeTool(tool, this.#host)
        this.#tool.begin(x, y, mods)

        this.#flushDirty()
    }

    move(x: number, y: number, mods: Mods): void {
        this.#tool?.move(x, y, mods)
    }

    endBatch(): void {
        this.#flushDirty()
    }

    finish(x: number, y: number, mods: Mods): void {
        if (!this.#tool || !this.#command) return
        const commit = this.#tool.end(x, y, mods)
        this.#flushDirty()

        if (commit) this.#deps.session.commit(this.#command)
        this.#tool = null
        this.#command = null
        this.#cursor = null
    }

    abort(): void {
        if (!this.#tool || !this.#command) return

        const cursor = openCursor(this.#deps.sprite, this.#deps.layer, this.#deps.frame, (w) => {
            this.#extendDirty(w.x, w.y)
        })
        for (const write of this.#command.writes()) cursor.set(write.x, write.y, write.before)

        this.#deps.overlay.clear()
        this.#flushDirty()

        this.#deps.requestRender()
        this.#tool = null
        this.#command = null
        this.#cursor = null
    }

    history(direction: 'undo' | 'redo'): void {
        if (this.#tool) return

        if (direction === 'undo') this.#deps.session.undo()
        else this.#deps.session.redo()
    }

    #extendDirty(x: number, y: number): void {
        if (this.#dirtyMaxX < this.#dirtyMinX) {
            this.#dirtyMinX = this.#dirtyMaxX = x
            this.#dirtyMinY = this.#dirtyMaxY = y
            return
        }

        if (x < this.#dirtyMinX) this.#dirtyMinX = x
        else if (x > this.#dirtyMaxX) this.#dirtyMaxX = x
        if (y < this.#dirtyMinY) this.#dirtyMinY = y
        else if (y > this.#dirtyMaxY) this.#dirtyMaxY = y
    }

    #flushDirty(): void {
        if (this.#dirtyMaxX < this.#dirtyMinX) return
        this.#deps.renderer.invalidate(
            this.#deps.sprite,
            this.#deps.layer,
            this.#deps.frame,
            this.#dirtyMinX,
            this.#dirtyMinY,
            this.#dirtyMaxX - this.#dirtyMinX + 1,
            this.#dirtyMaxY - this.#dirtyMinY + 1,
        )
        this.#dirtyMaxX = -1
        this.#dirtyMinX = 0
        this.#deps.requestRender()
    }
}
