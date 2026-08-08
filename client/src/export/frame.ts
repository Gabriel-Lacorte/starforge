import type { Sprite } from '@starforge/core'
import { Compositor, canvasBackend } from '../render/compositor'

export function composeFrameCanvas(sprite: Sprite, frameId: string): HTMLCanvasElement {
    return new Compositor(canvasBackend()).get(sprite, frameId)
}
