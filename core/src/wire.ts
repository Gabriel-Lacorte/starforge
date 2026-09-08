interface TextCodecEncoder {
    encode(value: string): Uint8Array
}

interface TextCodecDecoder {
    decode(value: Uint8Array): string
}

function utf8Encoder(): TextCodecEncoder {
    const scope = globalThis as unknown as {
        TextEncoder: new () => TextCodecEncoder
    }
    return new scope.TextEncoder()
}

function utf8Decoder(): TextCodecDecoder {
    const scope = globalThis as unknown as {
        TextDecoder: new () => TextCodecDecoder
    }
    return new scope.TextDecoder()
}

export class ByteWriter {
    private bytes: number[] = []

    u8(value: number): void {
        this.bytes.push(value & 0xff)
    }

    u16(value: number): void {
        this.bytes.push((value >>> 8) & 0xff, value & 0xff)
    }

    u32(value: number): void {
        this.bytes.push(
            (value >>> 24) & 0xff,
            (value >>> 16) & 0xff,
            (value >>> 8) & 0xff,
            value & 0xff,
        )
    }

    i16(value: number): void {
        this.u16(value & 0xffff)
    }

    varint(value: number): void {
        let rest = value >>> 0
        while (rest > 0x7f) {
            this.bytes.push((rest & 0x7f) | 0x80)
            rest >>>= 7
        }
        this.bytes.push(rest)
    }

    zigzag(value: number): void {
        this.varint(((value << 1) ^ (value >> 31)) >>> 0)
    }

    str(value: string): void {
        const encoded = utf8Encoder().encode(value)
        this.u32(encoded.length)
        for (const byte of encoded) this.bytes.push(byte)
    }

    raw(value: Uint8Array): void {
        for (const byte of value) this.bytes.push(byte)
    }

    done(): Uint8Array<ArrayBuffer> {
        return Uint8Array.from(this.bytes)
    }
}

export class ByteReader {
    private pos = 0
    private readonly bytes: Uint8Array

    constructor(bytes: Uint8Array) {
        this.bytes = bytes
    }

    get remaining(): number {
        return this.bytes.length - this.pos
    }

    private take(count: number): number {
        if (this.pos + count > this.bytes.length) throw new RangeError('truncated frame')
        const at = this.pos
        this.pos += count
        return at
    }

    u8(): number {
        return this.bytes[this.take(1)]!
    }

    u16(): number {
        const at = this.take(2)
        return ((this.bytes[at]! << 8) | this.bytes[at + 1]!) >>> 0
    }

    u32(): number {
        const at = this.take(4)
        return (
            (this.bytes[at]! * 0x1000000 +
                (this.bytes[at + 1]! << 16) +
                (this.bytes[at + 2]! << 8) +
                this.bytes[at + 3]!) >>>
            0
        )
    }

    i16(): number {
        const raw = this.u16()
        return raw > 0x7fff ? raw - 0x10000 : raw
    }

    varint(): number {
        let result = 0
        let shift = 0
        for (;;) {
            const byte = this.u8()
            result |= (byte & 0x7f) << shift
            if ((byte & 0x80) === 0) return result >>> 0
            shift += 7
            if (shift > 35) throw new RangeError('varint overflow')
        }
    }

    unzigzag(): number {
        const raw = this.varint()
        return (raw >>> 1) ^ -(raw & 1)
    }

    str(): string {
        const length = this.u32()
        const at = this.take(length)
        return utf8Decoder().decode(this.bytes.subarray(at, at + length))
    }

    raw(length: number): Uint8Array {
        const at = this.take(length)
        return this.bytes.slice(at, at + length)
    }
}

export const WIRE_PROTOCOL = 1

export const FrameType = { hello: 1, welcome: 2, op: 3, error: 8 } as const
export type FrameType = (typeof FrameType)[keyof typeof FrameType]

export const ErrorCode = {
    invalidOperation: 1,
    messageTooLarge: 2,
    documentTooLarge: 3,
    roomFull: 4,
    lamportExhausted: 5,
} as const
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

export interface Hello {
    readonly type: 'hello'
    readonly protocol: number
    readonly room: string
    readonly nickname: string
    readonly color: number
    readonly since: number
}

export interface Welcome {
    readonly type: 'welcome'
    readonly site: number
    readonly seq: number
    readonly lamport: number
    readonly snapshot: Uint8Array
}

export interface OpMsg {
    readonly type: 'op'
    readonly seq: number
    readonly stamp: number
    readonly body: Uint8Array
}

export interface NetError {
    readonly type: 'error'
    readonly code: number
    readonly message: string
}

export type NetFrame = Hello | Welcome | OpMsg | NetError

export function encodeFrame(frame: NetFrame): Uint8Array<ArrayBuffer> {
    const out = new ByteWriter()
    switch (frame.type) {
        case 'hello':
            out.u8(FrameType.hello)
            out.u8(frame.protocol)
            out.str(frame.room)
            out.str(frame.nickname)
            out.u32(frame.color)
            out.u32(frame.since)
            break
        case 'welcome':
            out.u8(FrameType.welcome)
            out.u8(frame.site)
            out.u32(frame.seq)
            out.u32(frame.lamport)
            out.u32(frame.snapshot.length)
            out.raw(frame.snapshot)
            break
        case 'op':
            out.u8(FrameType.op)
            out.u32(frame.seq)
            out.u32(frame.stamp)
            out.raw(frame.body)
            break
        case 'error':
            out.u8(FrameType.error)
            out.u16(frame.code)
            out.str(frame.message)
            break
    }
    return out.done()
}

export function decodeFrame(bytes: Uint8Array): NetFrame {
    const at = new ByteReader(bytes)
    const type = at.u8()
    switch (type) {
        case FrameType.hello:
            return {
                type: 'hello',
                protocol: at.u8(),
                room: at.str(),
                nickname: at.str(),
                color: at.u32(),
                since: at.u32(),
            }
        case FrameType.welcome: {
            const site = at.u8()
            const seq = at.u32()
            const lamport = at.u32()
            const length = at.u32()
            return { type: 'welcome', site, seq, lamport, snapshot: at.raw(length) }
        }
        case FrameType.op: {
            const seq = at.u32()
            const stamp = at.u32()
            return { type: 'op', seq, stamp, body: at.raw(at.remaining) }
        }
        case FrameType.error:
            return { type: 'error', code: at.u16(), message: at.str() }
        default:
            throw new RangeError(`unknown frame type: ${type}`)
    }
}
