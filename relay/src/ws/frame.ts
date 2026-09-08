export class TooLargeError extends RangeError {
    constructor(message = 'frame exceeds the size limit') {
        super(message)
        this.name = 'TooLargeError'
    }
}

export interface DecodedFrame {
    readonly fin: boolean
    readonly opcode: number
    readonly payload: Uint8Array
}

export function encodeServerFrame(opcode: number, payload: Uint8Array): Uint8Array {
    const len = payload.length
    let header: number[]
    if (len <= 125) {
        header = [0x80 | (opcode & 0x0f), len]
    } else if (len <= 0xffff) {
        header = [0x80 | (opcode & 0x0f), 126, (len >>> 8) & 0xff, len & 0xff]
    } else {
        const hi = Math.floor(len / 0x100000000)
        const lo = len >>> 0
        header = [
            0x80 | (opcode & 0x0f),
            127,
            (hi >>> 24) & 0xff,
            (hi >>> 16) & 0xff,
            (hi >>> 8) & 0xff,
            hi & 0xff,
            (lo >>> 24) & 0xff,
            (lo >>> 16) & 0xff,
            (lo >>> 8) & 0xff,
            lo & 0xff,
        ]
    }
    const out = new Uint8Array(header.length + len)
    out.set(header, 0)
    out.set(payload, header.length)
    return out
}

export class FrameDecoder {
    private buffer = new Uint8Array(0)
    private fragmentOpcode: number | null = null
    private fragments: Uint8Array[] = []
    private fragmentBytes = 0
    private readonly maxBytes: number

    constructor(maxBytes: number) {
        this.maxBytes = maxBytes
    }

    push(chunk: Uint8Array): DecodedFrame[] {
        const merged = new Uint8Array(this.buffer.length + chunk.length)
        merged.set(this.buffer, 0)
        merged.set(chunk, this.buffer.length)
        this.buffer = merged
        const out: DecodedFrame[] = []
        for (;;) {
            const frame = this.consumeOne()
            if (frame === null) break
            const complete = this.handleFrame(frame)
            if (complete !== null) out.push(complete)
        }
        return out
    }

    private consumeOne(): { fin: boolean; opcode: number; payload: Uint8Array } | null {
        const buf = this.buffer
        if (buf.length < 2) return null
        const first = buf[0]!
        const second = buf[1]!
        const fin = (first & 0x80) !== 0
        const opcode = first & 0x0f
        const masked = (second & 0x80) !== 0
        let length = second & 0x7f
        let offset = 2
        if (length === 126) {
            if (buf.length < offset + 2) return null
            length = ((buf[offset]! << 8) | buf[offset + 1]!) >>> 0
            offset += 2
        } else if (length === 127) {
            if (buf.length < offset + 8) return null
            const hi =
                buf[offset]! * 0x1000000 +
                (buf[offset + 1]! << 16) +
                (buf[offset + 2]! << 8) +
                buf[offset + 3]!
            const lo =
                buf[offset + 4]! * 0x1000000 +
                (buf[offset + 5]! << 16) +
                (buf[offset + 6]! << 8) +
                buf[offset + 7]!
            if (hi !== 0) {
                throw new TooLargeError()
            }
            if (lo > Number.MAX_SAFE_INTEGER) throw new TooLargeError()
            length = lo
            offset += 8
        }
        if (length > this.maxBytes) throw new TooLargeError()
        if (opcode >= 0x8) {
            if (!fin) throw new RangeError('fragmented control frame')
            if (length > 125) throw new RangeError('control frame too large')
        }
        if (opcode === 0x1) throw new RangeError('text frames are not supported')
        if (!masked) throw new RangeError('client frames must be masked')
        if (buf.length < offset + 4 + length) return null
        const key = buf.subarray(offset, offset + 4)
        offset += 4
        const payload = buf.slice(offset, offset + length)
        for (let i = 0; i < payload.length; i++) {
            payload[i] = (payload[i]! ^ key[i % 4]!) & 0xff
        }
        this.buffer = buf.slice(offset + length)
        return { fin, opcode, payload }
    }

    private handleFrame(frame: {
        fin: boolean
        opcode: number
        payload: Uint8Array
    }): DecodedFrame | null {
        const { fin, opcode, payload } = frame
        if (opcode === 0x8 || opcode === 0x9 || opcode === 0xa) {
            return { fin: true, opcode, payload }
        }

        if (opcode === 0x0) {
            if (this.fragmentOpcode === null) throw new RangeError('stray continuation')
            this.fragments.push(payload)
            this.fragmentBytes += payload.length
            if (this.fragmentBytes > this.maxBytes) throw new TooLargeError()
            if (!fin) return null
            const opcodeOut = this.fragmentOpcode
            this.fragmentOpcode = null
            const parts = this.fragments
            this.fragments = []
            this.fragmentBytes = 0
            return { fin: true, opcode: opcodeOut, payload: concat(parts) }
        }

        if (opcode !== 0x2) throw new RangeError(`unsupported opcode: ${opcode}`)
        if (this.fragmentOpcode !== null) throw new RangeError('overlapping data frame')
        if (fin) return { fin: true, opcode, payload }
        this.fragmentOpcode = opcode
        this.fragments = [payload]
        this.fragmentBytes = payload.length
        return null
    }
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
    let total = 0
    for (const part of parts) total += part.length
    const out = new Uint8Array(total)
    let at = 0
    for (const part of parts) {
        out.set(part, at)
        at += part.length
    }
    return out
}
