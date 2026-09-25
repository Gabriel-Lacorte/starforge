import type { StrokePreview } from '@starforge/core'
import type { ToolId } from '../editor/store'

export const TOOL_WIRE: readonly ToolId[] = [
    'pencil',
    'eraser',
    'line',
    'rect',
    'ellipse',
    'bucket',
    'select',
    'selectEllipse',
    'lasso',
    'wand',
    'eyedropper',
]

export function toolToWire(tool: ToolId): number {
    return TOOL_WIRE.indexOf(tool)
}

export function toolFromWire(n: number): ToolId {
    return TOOL_WIRE[n] ?? 'pencil'
}

export interface RoomPeer {
    readonly site: number
    nickname: string
    color: number
    x: number
    y: number
    tool: ToolId
    layer: string
    frame: string
    updatedAt: number
    previewCells: ReadonlySet<number>
    previewColor: number
}

export const PRESENCE_EXPIRY_MS = 30000

export class PresenceStore {
    private readonly bySite = new Map<number, RoomPeer>()

    peers(): RoomPeer[] {
        return [...this.bySite.values()].map((peer) => ({ ...peer }))
    }

    reset(): void {
        this.bySite.clear()
    }

    applyJoin(site: number, nickname: string, color: number, now: number): void {
        const known = this.bySite.get(site)
        if (known !== undefined) {
            known.nickname = nickname
            known.color = color
            known.updatedAt = now
            return
        }
        this.bySite.set(site, {
            site,
            nickname,
            color,
            x: 0,
            y: 0,
            tool: 'pencil',
            layer: '',
            frame: '',
            updatedAt: now,
            previewCells: new Set<number>(),
            previewColor: 0,
        })
    }

    applyLeave(site: number): void {
        this.bySite.delete(site)
    }

    applyPresence(
        site: number,
        x: number,
        y: number,
        tool: ToolId,
        layer: string,
        frame: string,
        nickname: string,
        color: number,
        preview: StrokePreview | undefined,
        now: number,
    ): void {
        let peer = this.bySite.get(site)
        if (peer === undefined) {
            peer = {
                site,
                nickname,
                color,
                x: 0,
                y: 0,
                tool: 'pencil',
                layer: '',
                frame: '',
                updatedAt: now,
                previewCells: new Set<number>(),
                previewColor: 0,
            }
            this.bySite.set(site, peer)
        }
        peer.x = x
        peer.y = y
        peer.tool = tool
        peer.layer = layer
        peer.frame = frame
        peer.nickname = nickname
        peer.color = color
        peer.updatedAt = now

        if (preview === undefined) {
            if (peer.previewCells.size > 0) peer.previewCells = new Set<number>()
            return
        }
        peer.previewColor = preview.color
        if (preview.full) {
            peer.previewCells = new Set(preview.cells)
        } else if (preview.cells.length > 0) {
            const next = new Set(peer.previewCells)
            for (const cell of preview.cells) next.add(cell)
            peer.previewCells = next
        }
    }

    sweep(now: number): void {
        for (const [site, peer] of this.bySite) {
            if (now - peer.updatedAt > PRESENCE_EXPIRY_MS) this.bySite.delete(site)
        }
    }
}
