import type { ToolId } from '../store'
import type { Tool, ToolHost } from './tool'
import { makeBucket } from './bucket'
import { makeFreehand } from './pencil'
import { makeShape } from './shapes'

type ToolFactory = (host: ToolHost) => Tool

export type GestureToolId = Exclude<ToolId, 'select'>

const REGISTRY: Record<GestureToolId, ToolFactory> = {
    pencil: (host) => makeFreehand(host, false),
    eraser: (host) => makeFreehand(host, true),
    line: (host) => makeShape(host, 'line'),
    rect: (host) => makeShape(host, 'rect'),
    ellipse: (host) => makeShape(host, 'ellipse'),
    bucket: (host) => makeBucket(host),
}

export function makeTool(id: GestureToolId, host: ToolHost): Tool {
    return REGISTRY[id](host)
}
