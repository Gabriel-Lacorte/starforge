import {
    applyInk,
    applyOperation,
    Command,
    getLayer,
    inBounds,
    isSelected,
    openCursor,
    pixelPatchFrom,
    type CelCursor,
    type InkContext,
    type RGBA,
    type SelectionMask,
    type Sprite,
} from '@starforge/core'
import type { DocumentSession } from '../document/session'
import type { EditTarget, EditorStore } from './store'
import {
    captureSettings,
    makeTool,
    toolDefinition,
    type GestureToolId,
    type Mods,
    type Tool,
    type ToolHost,
} from './tools'
import type { ToolSettings } from './tools/definition'

export interface InvalidateSink {
    invalidate(
        sprite: Sprite,
        layer: string,
        frame: string,
        x: number,
        y: number,
        w: number,
        h: number,
    ): void
}

export interface PreviewSink {
    setCells(cells: Iterable<number>, color: RGBA): void
    clear(): void
}

interface GestureDeps {
    sprite: Sprite

    target: () => EditTarget
    selection?: () => SelectionMask | null
    session: DocumentSession
    renderer: InvalidateSink
    overlay: PreviewSink
    store: EditorStore

    requestRender: () => void
}

export class GestureController {
    readonly #deps: GestureDeps
    readonly #host: ToolHost
    #tool: Tool | null = null
    #command: Command | null = null

    #cursor: CelCursor | null = null
    #target: EditTarget | null = null

    #mask: SelectionMask | null = null
    #settings: ToolSettings | null = null

    #seed = 0
    #mirror = false
    readonly #inkBase = new Map<number, RGBA>()

    #dirtyMinX = 0
    #dirtyMinY = 0
    #dirtyMaxX = -1
    #dirtyMaxY = -1

    constructor(deps: GestureDeps) {
        this.#deps = deps
        this.#host = this.#makeHost()
    }

    #makeHost(): ToolHost {
        const deps = this.#deps
        const target = () => this.#gestureTarget()
        const settings = () => this.#gestureSettings()

        return {
            sprite: deps.sprite,

            get layer() {
                return target().layer
            },

            get frame() {
                return target().frame
            },

            get settings() {
                return settings()
            },

            write: (x, y, context) => {
                this.#ink(x, y, context)
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

        const target = this.#deps.target()
        if (getLayer(this.#deps.sprite, target.layer).locked) {
            return
        }
        this.#target = target
        this.#mask = this.#deps.selection?.() ?? null
        this.#settings = captureSettings(this.#deps.store.state, this.#seed++)
        this.#mirror = toolDefinition(tool).geometry === 'freehand'
        this.#inkBase.clear()
        const command = new Command(tool)
        this.#command = command

        this.#cursor = openCursor(this.#deps.sprite, target.layer, target.frame, (write) => {
            command.record(write)
            this.#extendDirty(write.x, write.y)
        })
        this.#tool = makeTool(toolDefinition(tool), this.#host)
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
        this.#clear()
    }

    abort(): void {
        if (!this.#tool || !this.#command) return

        const patch = pixelPatchFrom(this.#command.writes())
        if (patch) {
            applyOperation(this.#deps.sprite, patch.inverse)
            const { x, y, w, h } = patch.change.rect
            this.#extendDirty(x, y)
            this.#extendDirty(x + w - 1, y + h - 1)
        }
        this.#deps.overlay.clear()
        this.#flushDirty()

        this.#deps.requestRender()
        this.#clear()
    }

    history(direction: 'undo' | 'redo'): void {
        if (this.#tool) return

        if (direction === 'undo') this.#deps.session.undo()
        else this.#deps.session.redo()
    }

    #ink(x: number, y: number, context: InkContext): void {
        const settings = this.#settings
        const mirrorH = this.#mirror && settings?.symmetryH === true
        const mirrorV = this.#mirror && settings?.symmetryV === true

        if (!mirrorH && !mirrorV) {
            this.#inkCell(x, y, context)
            return
        }

        const w = this.#deps.sprite.width
        const h = this.#deps.sprite.height
        const xs = mirrorH && w - 1 - x !== x ? [x, w - 1 - x] : [x]
        const ys = mirrorV && h - 1 - y !== y ? [y, h - 1 - y] : [y]

        for (const py of ys) {
            for (const px of xs) this.#inkCell(px, py, context)
        }
    }

    #inkCell(x: number, y: number, context: InkContext): void {
        const cursor = this.#cursor
        if (!cursor || !inBounds(this.#deps.sprite, x, y)) return

        const mask = this.#mask
        if (mask && !isSelected(mask, x, y)) return

        const cell = y * this.#deps.sprite.width + x
        let before = this.#inkBase.get(cell)
        if (before === undefined) {
            before = cursor.get(x, y)
            this.#inkBase.set(cell, before)
        }
        cursor.set(x, y, applyInk(before, context))
    }

    #gestureTarget(): EditTarget {
        const target = this.#target
        if (!target) throw new Error('no gesture in progress')

        return target
    }

    #gestureSettings(): ToolSettings {
        const settings = this.#settings
        if (!settings) throw new Error('no gesture in progress')

        return settings
    }

    #clear(): void {
        this.#tool = null
        this.#command = null
        this.#cursor = null
        this.#target = null
        this.#mask = null
        this.#settings = null
        this.#mirror = false
        this.#inkBase.clear()
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
        const { layer, frame } = this.#gestureTarget()
        this.#deps.renderer.invalidate(
            this.#deps.sprite,
            layer,
            frame,
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
