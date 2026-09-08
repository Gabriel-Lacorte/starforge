import { ByteReader, ByteWriter } from './wire'
import type {
    DocumentOperation,
    FrameAddOperation,
    LayerAddOperation,
    PixelPatchOperation,
} from './operation'
import type { Cel } from './doc'
import type { CelPixels } from './resize'

const KIND_TAG = {
    'pixel.patch': 0,
    'layer.add': 1,
    'layer.remove': 2,
    'layer.move': 3,
    'layer.set': 4,
    'palette.add': 5,
    'palette.remove': 6,
    'palette.move': 7,
    'palette.set': 8,
    'palette.rename': 9,
    'palette.replace': 10,
    'frame.add': 11,
    'frame.remove': 12,
    'frame.move': 13,
    'frame.setDuration': 14,
    'document.rename': 15,
    'document.resize': 16,
    'document.scale': 17,
    'document.restore': 18,
} as const

type Kind = keyof typeof KIND_TAG

function tagFor(kind: Kind): number {
    return KIND_TAG[kind]
}

function kindFor(tag: number): Kind {
    switch (tag) {
        case 0:
            return 'pixel.patch'
        case 1:
            return 'layer.add'
        case 2:
            return 'layer.remove'
        case 3:
            return 'layer.move'
        case 4:
            return 'layer.set'
        case 5:
            return 'palette.add'
        case 6:
            return 'palette.remove'
        case 7:
            return 'palette.move'
        case 8:
            return 'palette.set'
        case 9:
            return 'palette.rename'
        case 10:
            return 'palette.replace'
        case 11:
            return 'frame.add'
        case 12:
            return 'frame.remove'
        case 13:
            return 'frame.move'
        case 14:
            return 'frame.setDuration'
        case 15:
            return 'document.rename'
        case 16:
            return 'document.resize'
        case 17:
            return 'document.scale'
        case 18:
            return 'document.restore'
        default:
            throw new RangeError(`unknown operation kind tag: ${tag}`)
    }
}

export function splitPixelPatch(op: PixelPatchOperation, maxColors = 255): PixelPatchOperation[] {
    const total = op.xs.length
    if (total === 0) return [{ ...copyPatch(op, 0, 0) }]

    const chunks: PixelPatchOperation[] = []
    let start = 0
    let distinct = new Set<number>()

    for (let i = 0; i < total; i++) {
        const color = op.colors[i]!
        if (!distinct.has(color) && distinct.size >= maxColors) {
            chunks.push(copyPatch(op, start, i))
            start = i
            distinct = new Set<number>()
        }
        distinct.add(color)
    }
    chunks.push(copyPatch(op, start, total))
    return chunks
}

function copyPatch(op: PixelPatchOperation, start: number, end: number): PixelPatchOperation {
    return {
        kind: 'pixel.patch',
        layer: op.layer,
        frame: op.frame,
        xs: op.xs.slice(start, end),
        ys: op.ys.slice(start, end),
        colors: op.colors.slice(start, end),
    }
}

export function encodePatchBody(op: PixelPatchOperation): Uint8Array<ArrayBuffer> {
    const count = op.xs.length
    const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => {
        const ya = op.ys[a]!
        const yb = op.ys[b]!
        if (ya !== yb) return ya - yb
        return op.xs[a]! - op.xs[b]!
    })
    const table: number[] = []
    const indexOf = new Map<number, number>()
    for (const i of order) {
        const color = op.colors[i]!
        if (!indexOf.has(color)) {
            if (table.length >= 255) {
                throw new RangeError('pixel patch exceeds 255 colours; split it first')
            }
            indexOf.set(color, table.length)
            table.push(color)
        }
    }

    const out = new ByteWriter()
    out.varint(count)
    out.u8(table.length)
    for (const color of table) out.u32(color)

    let px = 0
    let py = 0
    for (const i of order) {
        const x = op.xs[i]!
        const y = op.ys[i]!

        out.zigzag(x - px)
        out.zigzag(y - py)
        out.u8(indexOf.get(op.colors[i]!)!)

        px = x
        py = y
    }

    return out.done()
}

function decodePatchBody(at: ByteReader, layer: string, frame: string): PixelPatchOperation {
    const count = at.varint()
    const tableSize = at.u8()
    const table: number[] = []
    for (let i = 0; i < tableSize; i++) table.push(at.u32())

    const xs = new Uint16Array(count)
    const ys = new Uint16Array(count)
    const colors = new Uint32Array(count)
    let px = 0
    let py = 0

    for (let i = 0; i < count; i++) {
        const dx = at.unzigzag()
        const dy = at.unzigzag()
        const ci = at.u8()
        if (ci >= table.length) throw new RangeError('pixel colour index out of range')
        px += dx
        py += dy
        xs[i] = px
        ys[i] = py
        colors[i] = table[ci]!
    }

    return { kind: 'pixel.patch', layer, frame, xs, ys, colors }
}

function writeBool(out: ByteWriter, value: boolean): void {
    out.u8(value ? 1 : 0)
}

function readBool(at: ByteReader): boolean {
    const v = at.u8()
    if (v !== 0 && v !== 1) throw new RangeError(`invalid bool: ${v}`)
    return v === 1
}

function writeNullableStr(out: ByteWriter, value: string | null): void {
    if (value === null) {
        out.u8(0)
    } else {
        out.u8(1)
        out.str(value)
    }
}

function readNullableStr(at: ByteReader): string | null {
    const has = at.u8()
    if (has === 0) return null
    if (has === 1) return at.str()
    throw new RangeError(`invalid option tag: ${has}`)
}

function writeLayer(out: ByteWriter, layer: LayerAddOperation['layer']): void {
    out.str(layer.id)
    out.str(layer.name)
    out.u8(layer.opacity)
    out.str(layer.blendMode)
    writeBool(out, layer.visible)
    writeBool(out, layer.locked)
    const cels = [...layer.cels.entries()]
    out.varint(cels.length)
    for (const [frame, cel] of cels) {
        out.str(frame)
        out.i16(cel.x)
        out.i16(cel.y)
        out.u32(cel.pixels.length)
        out.raw(cel.pixels)
        out.u32(cel.version)
    }
}

function readLayer(at: ByteReader): LayerAddOperation['layer'] {
    const id = at.str()
    const name = at.str()
    const opacity = at.u8()
    const blendMode = at.str() as LayerAddOperation['layer']['blendMode']
    const visible = readBool(at)
    const locked = readBool(at)
    const celCount = at.varint()
    const cels = new Map<string, Cel>()
    for (let i = 0; i < celCount; i++) {
        const frame = at.str()
        const x = at.i16()
        const y = at.i16()
        const len = at.u32()
        const raw = at.raw(len)
        const pixels = new Uint8Array(len)
        pixels.set(raw)
        const version = at.u32()
        cels.set(frame, {
            x,
            y,
            pixels,
            version,
        })
    }
    return { id, name, opacity, blendMode, visible, locked, cels }
}

function writeFrameCels(out: ByteWriter, cels: FrameAddOperation['cels']): void {
    const list = cels ?? []
    out.varint(list.length)
    for (const entry of list) {
        out.str(entry.layer)
        out.i16(entry.cel.x)
        out.i16(entry.cel.y)
        out.u32(entry.cel.pixels.length)
        out.raw(entry.cel.pixels)
        out.u32(entry.cel.version)
    }
}

function readFrameCels(at: ByteReader): FrameAddOperation['cels'] {
    const count = at.varint()
    if (count === 0) return undefined
    const out: { layer: string; cel: Cel }[] = []
    for (let i = 0; i < count; i++) {
        const layer = at.str()
        const x = at.i16()
        const y = at.i16()
        const len = at.u32()
        const raw = at.raw(len)
        const pixels = new Uint8Array(len)
        pixels.set(raw)
        const version = at.u32()
        out.push({
            layer,
            cel: {
                x,
                y,
                pixels,
                version,
            },
        })
    }
    return out
}

export function encodeOperation(op: DocumentOperation): Uint8Array<ArrayBuffer> {
    const out = new ByteWriter()
    out.u8(tagFor(op.kind))
    switch (op.kind) {
        case 'pixel.patch': {
            out.str(op.layer)
            out.str(op.frame)
            out.raw(encodePatchBody(op))
            break
        }
        case 'layer.add': {
            writeLayer(out, op.layer)
            writeNullableStr(out, op.after)
            break
        }
        case 'layer.remove': {
            out.str(op.layer)
            break
        }
        case 'layer.move': {
            out.str(op.layer)
            writeNullableStr(out, op.after)
            break
        }
        case 'layer.set': {
            out.str(op.layer)
            out.str(op.prop)
            switch (op.prop) {
                case 'opacity':
                    out.u8(op.value)
                    break
                case 'name':
                    out.str(op.value)
                    break
                case 'blendMode':
                    out.str(op.value)
                    break
                case 'visible':
                case 'locked':
                    writeBool(out, op.value)
                    break
            }
            break
        }
        case 'palette.add': {
            out.str(op.color)
            out.u16(op.index)
            break
        }
        case 'palette.remove': {
            out.u16(op.index)
            break
        }
        case 'palette.move': {
            out.u16(op.from)
            out.u16(op.to)
            break
        }
        case 'palette.set': {
            out.u16(op.index)
            out.str(op.color)
            break
        }
        case 'palette.rename': {
            out.str(op.name)
            break
        }
        case 'palette.replace': {
            out.str(op.name)
            out.varint(op.colors.length)
            for (const color of op.colors) out.str(color)
            break
        }
        case 'frame.add': {
            out.str(op.frame.id)
            out.u16(op.frame.duration)
            writeNullableStr(out, op.after)
            writeFrameCels(out, op.cels)
            break
        }
        case 'frame.remove': {
            out.str(op.frame)
            break
        }
        case 'frame.move': {
            out.str(op.frame)
            writeNullableStr(out, op.after)
            break
        }
        case 'frame.setDuration': {
            out.str(op.frame)
            out.u16(op.duration)
            break
        }
        case 'document.rename': {
            out.str(op.title)
            break
        }
        case 'document.resize': {
            out.u16(op.width)
            out.u16(op.height)
            out.i16(op.offsetX)
            out.i16(op.offsetY)
            break
        }
        case 'document.scale': {
            out.u16(op.width)
            out.u16(op.height)
            break
        }
        case 'document.restore': {
            out.u16(op.width)
            out.u16(op.height)
            out.varint(op.cels.length)
            for (const cel of op.cels) {
                out.str(cel.layer)
                out.str(cel.frame)
                out.i16(cel.x)
                out.i16(cel.y)
                out.u32(cel.pixels.length)
                out.raw(cel.pixels)
            }
            break
        }
    }
    return out.done()
}

export function decodeOperation(bytes: Uint8Array): DocumentOperation {
    const at = new ByteReader(bytes)
    const kind = kindFor(at.u8())
    switch (kind) {
        case 'pixel.patch': {
            const layer = at.str()
            const frame = at.str()
            return decodePatchBody(at, layer, frame)
        }
        case 'layer.add': {
            const layer = readLayer(at)
            const after = readNullableStr(at)
            return { kind: 'layer.add', layer, after }
        }
        case 'layer.remove':
            return { kind: 'layer.remove', layer: at.str() }
        case 'layer.move':
            return { kind: 'layer.move', layer: at.str(), after: readNullableStr(at) }
        case 'layer.set': {
            const layer = at.str()
            const prop = at.str()
            switch (prop) {
                case 'opacity':
                    return { kind: 'layer.set', layer, prop, value: at.u8() }
                case 'name':
                    return { kind: 'layer.set', layer, prop, value: at.str() }
                case 'blendMode':
                    return {
                        kind: 'layer.set',
                        layer,
                        prop,
                        value: at.str() as 'normal',
                    }
                case 'visible':
                case 'locked':
                    return {
                        kind: 'layer.set',
                        layer,
                        prop: prop as 'visible',
                        value: readBool(at),
                    }
                default:
                    throw new RangeError(`unknown layer prop: ${prop}`)
            }
        }
        case 'palette.add':
            return { kind: 'palette.add', color: at.str(), index: at.u16() }
        case 'palette.remove':
            return { kind: 'palette.remove', index: at.u16() }
        case 'palette.move':
            return { kind: 'palette.move', from: at.u16(), to: at.u16() }
        case 'palette.set':
            return { kind: 'palette.set', index: at.u16(), color: at.str() }
        case 'palette.rename':
            return { kind: 'palette.rename', name: at.str() }
        case 'palette.replace': {
            const name = at.str()
            const count = at.varint()
            const colors: string[] = []
            for (let i = 0; i < count; i++) colors.push(at.str())
            return { kind: 'palette.replace', name, colors }
        }
        case 'frame.add': {
            const id = at.str()
            const duration = at.u16()
            const after = readNullableStr(at)
            const cels = readFrameCels(at)
            if (cels === undefined) return { kind: 'frame.add', frame: { id, duration }, after }
            return { kind: 'frame.add', frame: { id, duration }, after, cels }
        }
        case 'frame.remove':
            return { kind: 'frame.remove', frame: at.str() }
        case 'frame.move':
            return { kind: 'frame.move', frame: at.str(), after: readNullableStr(at) }
        case 'frame.setDuration':
            return { kind: 'frame.setDuration', frame: at.str(), duration: at.u16() }
        case 'document.rename':
            return { kind: 'document.rename', title: at.str() }
        case 'document.resize':
            return {
                kind: 'document.resize',
                width: at.u16(),
                height: at.u16(),
                offsetX: at.i16(),
                offsetY: at.i16(),
            }
        case 'document.scale':
            return { kind: 'document.scale', width: at.u16(), height: at.u16() }
        case 'document.restore': {
            const width = at.u16()
            const height = at.u16()
            const count = at.varint()
            const cels: CelPixels[] = []
            for (let i = 0; i < count; i++) {
                const layer = at.str()
                const frame = at.str()
                const x = at.i16()
                const y = at.i16()
                const len = at.u32()
                const raw = at.raw(len)
                const pixels = new Uint8Array(len)
                pixels.set(raw)
                cels.push({
                    layer,
                    frame,
                    x,
                    y,
                    pixels,
                })
            }
            return { kind: 'document.restore', width, height, cels }
        }
    }
}
