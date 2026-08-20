import { openCursor } from './cursor'
import {
    PALETTE_MAX_COLORS,
    inBounds,
    normalizeSpriteTitle,
    type Frame,
    type Layer,
    type Sprite,
} from './doc'
import {
    FRAME_DURATION_MAX,
    FRAME_DURATION_MIN,
    insertFrame,
    moveFrame,
    removeFrame,
    setFrameDuration,
    type FrameCel,
} from './frames'
import { normalizePaletteName } from './palette'
import { resizeCanvas, restoreCels, scaleCanvas, snapshotCels, type CelPixels } from './resize'
import {
    insertLayer,
    moveLayer,
    normalizeLayerName,
    removeLayer,
    setLayerProp,
    type LayerProps,
} from './layers'
import type { CellWrite, DirtyRect } from './ops'

export type OperationErrorCode = 'TARGET' | 'PRECONDITION' | 'PAYLOAD'

export class OperationError extends Error {
    readonly code: OperationErrorCode

    constructor(code: OperationErrorCode, detail: string) {
        super(`operation rejected [${code.toLowerCase()}]: ${detail}`)
        this.name = 'OperationError'
        this.code = code
    }
}

export interface PixelPatchOperation {
    readonly kind: 'pixel.patch'
    readonly layer: string
    readonly frame: string

    readonly xs: Uint16Array
    readonly ys: Uint16Array
    readonly colors: Uint32Array
}

export interface LayerAddOperation {
    readonly kind: 'layer.add'
    readonly layer: Layer
    readonly after: string | null
}

export interface LayerRemoveOperation {
    readonly kind: 'layer.remove'
    readonly layer: string
}

export interface LayerMoveOperation {
    readonly kind: 'layer.move'
    readonly layer: string
    readonly after: string | null
}

export type LayerSetOperation = {
    [K in keyof LayerProps]: {
        readonly kind: 'layer.set'
        readonly layer: string
        readonly prop: K
        readonly value: LayerProps[K]
    }
}[keyof LayerProps]

export interface PaletteAddOperation {
    readonly kind: 'palette.add'
    readonly color: string
    readonly index: number
}

export interface PaletteRemoveOperation {
    readonly kind: 'palette.remove'
    readonly index: number
}

export interface PaletteMoveOperation {
    readonly kind: 'palette.move'
    readonly from: number
    readonly to: number
}

export interface PaletteSetOperation {
    readonly kind: 'palette.set'
    readonly index: number
    readonly color: string
}

export interface PaletteRenameOperation {
    readonly kind: 'palette.rename'
    readonly name: string
}

export interface FrameAddOperation {
    readonly kind: 'frame.add'
    readonly frame: Frame
    readonly after: string | null
    readonly cels?: readonly FrameCel[]
}

export interface FrameRemoveOperation {
    readonly kind: 'frame.remove'
    readonly frame: string
}

export interface FrameMoveOperation {
    readonly kind: 'frame.move'
    readonly frame: string
    readonly after: string | null
}

export interface FrameSetDurationOperation {
    readonly kind: 'frame.setDuration'
    readonly frame: string
    readonly duration: number
}

export interface DocumentRenameOperation {
    readonly kind: 'document.rename'
    readonly title: string
}

export interface DocumentResizeOperation {
    readonly kind: 'document.resize'
    readonly width: number
    readonly height: number
    readonly offsetX: number
    readonly offsetY: number
}

export interface DocumentScaleOperation {
    readonly kind: 'document.scale'
    readonly width: number
    readonly height: number
}

export interface DocumentRestoreOperation {
    readonly kind: 'document.restore'
    readonly width: number
    readonly height: number
    readonly cels: readonly CelPixels[]
}

export interface PaletteReplaceOperation {
    readonly kind: 'palette.replace'
    readonly name: string
    readonly colors: readonly string[]
}

export type DocumentOperation =
    | PixelPatchOperation
    | LayerAddOperation
    | LayerRemoveOperation
    | LayerMoveOperation
    | LayerSetOperation
    | PaletteAddOperation
    | PaletteRemoveOperation
    | PaletteMoveOperation
    | PaletteSetOperation
    | PaletteRenameOperation
    | PaletteReplaceOperation
    | FrameAddOperation
    | FrameRemoveOperation
    | FrameMoveOperation
    | FrameSetDurationOperation
    | DocumentRenameOperation
    | DocumentResizeOperation
    | DocumentScaleOperation
    | DocumentRestoreOperation

export interface PixelChange {
    readonly kind: 'pixels'
    readonly layer: string
    readonly frame: string
    readonly rect: DirtyRect
}

export type ChangeSet =
    PixelChange | { readonly kind: 'structure'; readonly removedLayerIndex?: number }

export interface OperationResult {
    readonly change: ChangeSet
    readonly inverse: DocumentOperation

    readonly skipped: number
}

export interface PixelPatch {
    readonly operation: PixelPatchOperation
    readonly inverse: PixelPatchOperation
    readonly change: PixelChange
}

const STRUCTURE: ChangeSet = { kind: 'structure' }

export function applyOperation(sprite: Sprite, operation: DocumentOperation): OperationResult {
    switch (operation.kind) {
        case 'pixel.patch':
            return patchPixels(sprite, operation)
        case 'layer.add':
            return addLayer(sprite, operation)
        case 'layer.remove':
            return dropLayer(sprite, operation)
        case 'layer.move':
            return relocateLayer(sprite, operation)
        case 'layer.set':
            return writeLayerProp(sprite, operation)
        case 'frame.add':
            return addFrame(sprite, operation)
        case 'frame.remove':
            return dropFrame(sprite, operation)
        case 'frame.move':
            return relocateFrame(sprite, operation)
        case 'frame.setDuration':
            return writeFrameDuration(sprite, operation)
        case 'palette.add':
            return addPaletteColor(sprite, operation)
        case 'palette.remove':
            return removePaletteColor(sprite, operation)
        case 'palette.move':
            return movePaletteColor(sprite, operation)
        case 'palette.set':
            return setPaletteColor(sprite, operation)
        case 'palette.rename':
            return renamePalette(sprite, operation)
        case 'palette.replace':
            return replacePalette(sprite, operation)
        case 'document.rename':
            return renameDocument(sprite, operation)
        case 'document.resize':
            return resizeDocument(sprite, operation)
        case 'document.scale':
            return scaleDocument(sprite, operation)
        case 'document.restore':
            return restoreDocument(sprite, operation)
        default:
            fail('PAYLOAD', `unknown operation: ${String((operation as { kind: unknown }).kind)}`)
    }
}

export function layerSet<K extends keyof LayerProps>(
    layer: string,
    prop: K,
    value: LayerProps[K],
): LayerSetOperation {
    return { kind: 'layer.set', layer, prop, value } as LayerSetOperation
}

export function pixelPatchFrom(writes: readonly CellWrite[]): PixelPatch | null {
    const first = writes[0]
    if (!first) return null

    const count = writes.length
    const xs = new Uint16Array(count)
    const ys = new Uint16Array(count)
    const after = new Uint32Array(count)
    const before = new Uint32Array(count)

    let minX = first.x
    let maxX = first.x
    let minY = first.y
    let maxY = first.y

    for (let index = 0; index < count; index++) {
        const write = writes[index]!
        if (write.layer !== first.layer || write.frame !== first.frame) {
            fail('PAYLOAD', 'a pixel patch covers a single layer and frame')
        }

        xs[index] = write.x
        ys[index] = write.y
        before[index] = write.before
        after[index] = write.after

        if (write.x < minX) minX = write.x
        else if (write.x > maxX) maxX = write.x

        if (write.y < minY) minY = write.y
        else if (write.y > maxY) maxY = write.y
    }

    const target = { layer: first.layer, frame: first.frame } as const

    return {
        operation: { kind: 'pixel.patch', ...target, xs, ys, colors: after },
        inverse: { kind: 'pixel.patch', ...target, xs, ys, colors: before },
        change: {
            kind: 'pixels',
            ...target,
            rect: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
        },
    }
}

function patchPixels(sprite: Sprite, operation: PixelPatchOperation): OperationResult {
    const { xs, ys, colors } = operation
    if (xs.length !== ys.length || xs.length !== colors.length) {
        fail('PAYLOAD', 'pixel patch coordinates and colors have different lengths')
    }
    if (xs.length === 0) fail('PAYLOAD', 'pixel patch is empty')

    const layer = requireLayer(sprite, operation.layer)
    requireFrame(sprite, operation.frame)
    if (layer.locked) fail('PRECONDITION', `layer is locked: ${operation.layer}`)

    const cursor = openCursor(sprite, operation.layer, operation.frame)
    const before = new Uint32Array(xs.length)
    let skipped = 0

    let minX = 0
    let minY = 0
    let maxX = -1
    let maxY = -1

    for (let index = 0; index < xs.length; index++) {
        const x = xs[index]!
        const y = ys[index]!
        if (!inBounds(sprite, x, y)) {
            skipped++
            continue
        }

        const current = cursor.get(x, y)
        before[index] = current

        if (maxX < minX) {
            minX = maxX = x
            minY = maxY = y
        } else {
            if (x < minX) minX = x
            else if (x > maxX) maxX = x

            if (y < minY) minY = y
            else if (y > maxY) maxY = y
        }

        if (current === colors[index]) skipped++
        else cursor.set(x, y, colors[index]!)
    }

    if (maxX < minX) fail('PAYLOAD', 'pixel patch falls entirely outside the document')

    return {
        change: {
            kind: 'pixels',
            layer: operation.layer,
            frame: operation.frame,
            rect: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
        },
        inverse: { ...operation, colors: before },
        skipped,
    }
}

function addLayer(sprite: Sprite, operation: LayerAddOperation): OperationResult {
    if (sprite.layers.some((layer) => layer.id === operation.layer.id)) {
        fail('PRECONDITION', `layer already present: ${operation.layer.id}`)
    }
    if (operation.after !== null) requireLayer(sprite, operation.after)

    insertLayer(sprite, operation.layer, operation.after)

    return {
        change: STRUCTURE,
        inverse: { kind: 'layer.remove', layer: operation.layer.id },
        skipped: 0,
    }
}

function dropLayer(sprite: Sprite, operation: LayerRemoveOperation): OperationResult {
    requireLayer(sprite, operation.layer)
    if (sprite.layers.length <= 1) fail('PRECONDITION', 'a document keeps at least one layer')

    const index = sprite.layers.findIndex((layer) => layer.id === operation.layer)
    const after = index === 0 ? null : sprite.layers[index - 1]!.id
    const removed = removeLayer(sprite, operation.layer)!

    return {
        change: { kind: 'structure', removedLayerIndex: removed.index },
        inverse: { kind: 'layer.add', layer: removed.layer, after },
        skipped: 0,
    }
}

function relocateLayer(sprite: Sprite, operation: LayerMoveOperation): OperationResult {
    requireLayer(sprite, operation.layer)
    if (operation.after === operation.layer) {
        fail('PRECONDITION', `a layer cannot move above itself: ${operation.layer}`)
    }
    if (operation.after !== null) requireLayer(sprite, operation.after)

    const previous = moveLayer(sprite, operation.layer, operation.after)
    if (!previous) fail('PRECONDITION', `layer already sits there: ${operation.layer}`)

    return {
        change: STRUCTURE,
        inverse: { kind: 'layer.move', layer: operation.layer, after: previous.after },
        skipped: 0,
    }
}

function writeLayerProp(sprite: Sprite, operation: LayerSetOperation): OperationResult {
    const layer = requireLayer(sprite, operation.layer)
    checkLayerProp(operation)
    const previous = layer[operation.prop]

    setLayerProp(sprite, operation.layer, operation.prop, operation.value as never)

    return {
        change: STRUCTURE,
        inverse: layerSet(operation.layer, operation.prop, previous as never),
        skipped: 0,
    }
}

function checkLayerProp(operation: LayerSetOperation): void {
    if (operation.prop === 'opacity') {
        const { value } = operation
        if (!Number.isInteger(value) || value < 0 || value > 255) {
            fail('PAYLOAD', `layer opacity must be an integer in 0..255, got ${String(value)}`)
        }
    } else if (
        operation.prop === 'name' &&
        normalizeLayerName(operation.value) !== operation.value
    ) {
        fail('PAYLOAD', 'layer name must be normalized before it reaches the document')
    }
}

const CANONICAL_HEX = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/

function addPaletteColor(sprite: Sprite, operation: PaletteAddOperation): OperationResult {
    const colors = sprite.palette.colors
    requireCanonicalHex(operation.color)
    if (
        !Number.isInteger(operation.index) ||
        operation.index < 0 ||
        operation.index > colors.length
    ) {
        fail('PAYLOAD', `palette index out of range: ${String(operation.index)}`)
    }
    if (colors.length >= PALETTE_MAX_COLORS) {
        fail('PRECONDITION', `a palette holds at most ${PALETTE_MAX_COLORS} colors`)
    }

    colors.splice(operation.index, 0, operation.color)
    sprite.revision++

    return {
        change: STRUCTURE,
        inverse: { kind: 'palette.remove', index: operation.index },
        skipped: 0,
    }
}

function removePaletteColor(sprite: Sprite, operation: PaletteRemoveOperation): OperationResult {
    const colors = sprite.palette.colors
    if (
        !Number.isInteger(operation.index) ||
        operation.index < 0 ||
        operation.index >= colors.length
    ) {
        fail('TARGET', `no palette color at index ${String(operation.index)}`)
    }

    const [removed] = colors.splice(operation.index, 1)
    sprite.revision++

    return {
        change: STRUCTURE,
        inverse: { kind: 'palette.add', color: removed!, index: operation.index },
        skipped: 0,
    }
}

function addFrame(sprite: Sprite, operation: FrameAddOperation): OperationResult {
    if (sprite.frames.some((frame) => frame.id === operation.frame.id)) {
        fail('PRECONDITION', `frame already present: ${operation.frame.id}`)
    }
    if (operation.after !== null) requireFrame(sprite, operation.after)
    if (
        !Number.isInteger(operation.frame.duration) ||
        operation.frame.duration < FRAME_DURATION_MIN ||
        operation.frame.duration > FRAME_DURATION_MAX
    ) {
        fail('PAYLOAD', `frame duration out of range: ${String(operation.frame.duration)}`)
    }

    insertFrame(sprite, operation.frame, operation.after, operation.cels ?? [])

    return {
        change: STRUCTURE,
        inverse: { kind: 'frame.remove', frame: operation.frame.id },
        skipped: 0,
    }
}

function dropFrame(sprite: Sprite, operation: FrameRemoveOperation): OperationResult {
    requireFrame(sprite, operation.frame)
    if (sprite.frames.length <= 1) fail('PRECONDITION', 'a document keeps at least one frame')

    const removed = removeFrame(sprite, operation.frame)!

    return {
        change: STRUCTURE,
        inverse: {
            kind: 'frame.add',
            frame: removed.frame,
            after: removed.after,
            cels: removed.cels,
        },
        skipped: 0,
    }
}

function relocateFrame(sprite: Sprite, operation: FrameMoveOperation): OperationResult {
    requireFrame(sprite, operation.frame)
    if (operation.after === operation.frame) {
        fail('PRECONDITION', `a frame cannot move after itself: ${operation.frame}`)
    }
    if (operation.after !== null) requireFrame(sprite, operation.after)

    const previous = moveFrame(sprite, operation.frame, operation.after)
    if (!previous) fail('PRECONDITION', `frame already sits there: ${operation.frame}`)

    return {
        change: STRUCTURE,
        inverse: { kind: 'frame.move', frame: operation.frame, after: previous.after },
        skipped: 0,
    }
}

function writeFrameDuration(sprite: Sprite, operation: FrameSetDurationOperation): OperationResult {
    requireFrame(sprite, operation.frame)

    let previous: number | null
    try {
        previous = setFrameDuration(sprite, operation.frame, operation.duration)
    } catch (error) {
        if (error instanceof RangeError) fail('PAYLOAD', error.message)
        throw error
    }
    if (previous === null) fail('PRECONDITION', 'frame duration is unchanged')

    return {
        change: STRUCTURE,
        inverse: { kind: 'frame.setDuration', frame: operation.frame, duration: previous },
        skipped: 0,
    }
}

function movePaletteColor(sprite: Sprite, operation: PaletteMoveOperation): OperationResult {
    const colors = sprite.palette.colors
    const from = requireIndex(colors.length, operation.from, 'from')
    const to = requireIndex(colors.length, operation.to, 'to')
    if (from === to) fail('PRECONDITION', `palette colour already sits at ${to}`)

    const [moved] = colors.splice(from, 1)
    colors.splice(to, 0, moved!)
    sprite.revision++

    return {
        change: STRUCTURE,
        inverse: { kind: 'palette.move', from: to, to: from },
        skipped: 0,
    }
}

function setPaletteColor(sprite: Sprite, operation: PaletteSetOperation): OperationResult {
    const colors = sprite.palette.colors
    const index = requireIndex(colors.length, operation.index, 'index')
    requireCanonicalHex(operation.color)

    const previous = colors[index]!
    if (previous === operation.color) fail('PRECONDITION', 'palette colour is unchanged')
    colors[index] = operation.color
    sprite.revision++

    return {
        change: STRUCTURE,
        inverse: { kind: 'palette.set', index, color: previous },
        skipped: 0,
    }
}

function renamePalette(sprite: Sprite, operation: PaletteRenameOperation): OperationResult {
    if (normalizePaletteName(operation.name) !== operation.name) {
        fail('PAYLOAD', 'palette name must be normalized before it reaches the document')
    }

    const previous = sprite.palette.name
    if (previous === operation.name) fail('PRECONDITION', 'palette name is unchanged')
    sprite.palette.name = operation.name
    sprite.revision++

    return {
        change: STRUCTURE,
        inverse: { kind: 'palette.rename', name: previous },
        skipped: 0,
    }
}

function replacePalette(sprite: Sprite, operation: PaletteReplaceOperation): OperationResult {
    if (normalizePaletteName(operation.name) !== operation.name) {
        fail('PAYLOAD', 'palette name must be normalized before it reaches the document')
    }
    if (operation.colors.length === 0) fail('PAYLOAD', 'a palette keeps at least one colour')
    if (operation.colors.length > PALETTE_MAX_COLORS) {
        fail('PRECONDITION', `a palette holds at most ${PALETTE_MAX_COLORS} colours`)
    }
    for (const color of operation.colors) requireCanonicalHex(color)

    const previous = sprite.palette
    sprite.palette = { name: operation.name, colors: [...operation.colors] }
    sprite.revision++

    return {
        change: STRUCTURE,
        inverse: { kind: 'palette.replace', name: previous.name, colors: previous.colors },
        skipped: 0,
    }
}

function renameDocument(sprite: Sprite, operation: DocumentRenameOperation): OperationResult {
    if (operation.title.length === 0) fail('PAYLOAD', 'a document keeps a title')
    if (normalizeSpriteTitle(operation.title) !== operation.title) {
        fail('PAYLOAD', 'document title must be normalized before it reaches the document')
    }

    const previous = sprite.meta.title
    if (previous === operation.title) fail('PRECONDITION', 'document title is unchanged')
    sprite.meta.title = operation.title
    sprite.revision++

    return {
        change: STRUCTURE,
        inverse: { kind: 'document.rename', title: previous },
        skipped: 0,
    }
}

function resizeDocument(sprite: Sprite, operation: DocumentResizeOperation): OperationResult {
    const before = keepDocument(sprite)
    if (
        operation.width === sprite.width &&
        operation.height === sprite.height &&
        operation.offsetX === 0 &&
        operation.offsetY === 0
    ) {
        fail('PRECONDITION', 'the canvas already has that size and position')
    }
    if (!Number.isInteger(operation.offsetX) || !Number.isInteger(operation.offsetY)) {
        fail('PAYLOAD', 'canvas offset must be whole pixels')
    }

    sized(() => {
        resizeCanvas(sprite, operation, operation.offsetX, operation.offsetY)
    })

    return { change: STRUCTURE, inverse: before, skipped: 0 }
}

function scaleDocument(sprite: Sprite, operation: DocumentScaleOperation): OperationResult {
    const before = keepDocument(sprite)
    if (operation.width === sprite.width && operation.height === sprite.height) {
        fail('PRECONDITION', 'the canvas already has that size')
    }

    sized(() => {
        scaleCanvas(sprite, operation)
    })

    return { change: STRUCTURE, inverse: before, skipped: 0 }
}

function restoreDocument(sprite: Sprite, operation: DocumentRestoreOperation): OperationResult {
    const before = keepDocument(sprite)
    sized(() => {
        restoreCels(sprite, operation, operation.cels)
    })
    sprite.revision++

    return { change: STRUCTURE, inverse: before, skipped: 0 }
}

function keepDocument(sprite: Sprite): DocumentRestoreOperation {
    return {
        kind: 'document.restore',
        width: sprite.width,
        height: sprite.height,
        cels: snapshotCels(sprite),
    }
}

function sized(change: () => void): void {
    try {
        change()
    } catch (error) {
        if (error instanceof RangeError) fail('PAYLOAD', error.message)
        throw error
    }
}

function requireIndex(length: number, index: number, what: string): number {
    if (!Number.isInteger(index) || index < 0 || index >= length) {
        fail('TARGET', `no palette colour at ${what} ${String(index)}`)
    }

    return index
}

function requireCanonicalHex(color: string): void {
    if (!CANONICAL_HEX.test(color)) {
        fail('PAYLOAD', `palette color is not canonical hex: ${color}`)
    }
}

function requireLayer(sprite: Sprite, id: string): Layer {
    const layer = sprite.layers.find((candidate) => candidate.id === id)
    if (!layer) fail('TARGET', `unknown layer: ${id}`)

    return layer
}

function requireFrame(sprite: Sprite, id: string): void {
    if (!sprite.frames.some((frame) => frame.id === id)) fail('TARGET', `unknown frame: ${id}`)
}

function fail(code: OperationErrorCode, detail: string): never {
    throw new OperationError(code, detail)
}
