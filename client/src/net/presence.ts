import type { ToolId } from '../editor/store'

/** Wire order for tools in presence frames; the index is the byte on the wire. */
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

/** Unknown codes fall back to `'pencil'` so a new tool never breaks an old client. */
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
}

/** Peers older than this many milliseconds die in `sweep`. */
export const PRESENCE_EXPIRY_MS = 5000

/** Who paints beside you: joins seed a cursor, presence moves it, sweep ages it out. */
export class PresenceStore {
    private readonly bySite = new Map<number, RoomPeer>()

    peers(): RoomPeer[] {
        return [...this.bySite.values()].map((peer) => ({ ...peer }))
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
        })
    }

    applyLeave(site: number): void {
        this.bySite.delete(site)
    }

    /** Presence from a site that never joined is ignored. */
    applyPresence(
        site: number,
        x: number,
        y: number,
        tool: ToolId,
        layer: string,
        frame: string,
        now: number,
    ): void {
        const peer = this.bySite.get(site)
        if (peer === undefined) return
        peer.x = x
        peer.y = y
        peer.tool = tool
        peer.layer = layer
        peer.frame = frame
        peer.updatedAt = now
    }

    sweep(now: number): void {
        for (const [site, peer] of this.bySite) {
            if (now - peer.updatedAt > PRESENCE_EXPIRY_MS) this.bySite.delete(site)
        }
    }
}
