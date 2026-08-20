export const ZOOM_LEVELS = [1, 2, 4, 8, 16, 32] as const
export type Zoom = (typeof ZOOM_LEVELS)[number]

export interface View {
    panX: number
    panY: number
    zoom: Zoom
}

export function createView(): View {
    return { panX: 0, panY: 0, zoom: 1 }
}

export function screenToSprite(view: View, sx: number, sy: number): { x: number; y: number } {
    return {
        x: Math.floor((sx - view.panX) / view.zoom),
        y: Math.floor((sy - view.panY) / view.zoom),
    }
}

export function spriteToScreen(view: View, x: number, y: number): { x: number; y: number } {
    return {
        x: x * view.zoom + view.panX,
        y: y * view.zoom + view.panY,
    }
}

export function panBy(view: View, dx: number, dy: number): void {
    view.panX += dx
    view.panY += dy
}

export function zoomAt(view: View, zoom: Zoom, cx: number, cy: number): void {
    const sx = (cx - view.panX) / view.zoom
    const sy = (cy - view.panY) / view.zoom
    view.zoom = zoom
    view.panX = cx - sx * zoom
    view.panY = cy - sy * zoom
}

export function stepZoom(view: View, direction: 1 | -1, cx: number, cy: number): void {
    const next = ZOOM_LEVELS[ZOOM_LEVELS.indexOf(view.zoom) + direction]
    if (next !== undefined) zoomAt(view, next, cx, cy)
}

export function clampPan(
    view: View,
    spriteW: number,
    spriteH: number,
    viewportW: number,
    viewportH: number,
): void {
    const w = spriteW * view.zoom
    const h = spriteH * view.zoom

    const keepX = Math.min(w, viewportW * 0.25)
    const keepY = Math.min(h, viewportH * 0.25)

    view.panX = Math.min(viewportW - keepX, Math.max(keepX - w, view.panX))
    view.panY = Math.min(viewportH - keepY, Math.max(keepY - h, view.panY))
}

export function fitSprite(
    view: View,
    spriteW: number,
    spriteH: number,
    viewportW: number,
    viewportH: number,
): void {
    let zoom: Zoom = 1

    for (const level of ZOOM_LEVELS)
        if (spriteW * level <= viewportW && spriteH * level <= viewportH) zoom = level

    view.zoom = zoom
    view.panX = Math.round((viewportW - spriteW * zoom) / 2)
    view.panY = Math.round((viewportH - spriteH * zoom) / 2)
}
