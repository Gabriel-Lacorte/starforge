import type { Socket } from 'node:net'
import { FrameDecoder, TooLargeError, encodeServerFrame } from './frame.js'

export interface Peer {
    send(bytes: Uint8Array): void
    close(code: number, reason?: string): void
}

export class WsSocket implements Peer {
    readonly #socket: Socket
    readonly #decoder: FrameDecoder
    #closed = false
    onMessage: (opcode: number, payload: Uint8Array) => void = () => undefined
    onClose: (code: number) => void = () => undefined
    onPong: () => void = () => undefined

    constructor(socket: Socket, maxBytes: number) {
        this.#socket = socket
        this.#decoder = new FrameDecoder(maxBytes)
        socket.on('data', (chunk) => this.#ingest(chunk))
        socket.on('close', () => this.#finish(1006))
        socket.on('error', () => undefined)
    }

    send(bytes: Uint8Array): void {
        if (!this.#closed) this.#socket.write(encodeServerFrame(0x2, bytes))
    }

    ping(): void {
        if (!this.#closed) this.#socket.write(encodeServerFrame(0x9, new Uint8Array()))
    }

    close(code: number, reason = ''): void {
        if (this.#closed) return
        this.#closed = true
        const body = new TextEncoder().encode(reason)
        const payload = Uint8Array.from([code >> 8, code & 0xff, ...body])
        this.#socket.write(encodeServerFrame(0x8, payload))
        this.#socket.end()
    }

    #ingest(chunk: Buffer): void {
        let frames
        try {
            frames = this.#decoder.push(new Uint8Array(chunk))
        } catch (error) {
            this.close(error instanceof TooLargeError ? 1009 : 1002)
            return
        }
        for (const frame of frames) {
            if (frame.opcode === 0x8) {
                const code =
                    frame.payload.length >= 2 ? (frame.payload[0]! << 8) | frame.payload[1]! : 1005
                this.#closed = true
                this.onClose(code)
                this.#socket.end()
            } else if (frame.opcode === 0x9) {
                if (!this.#closed) this.#socket.write(encodeServerFrame(0xa, frame.payload))
            } else if (frame.opcode === 0xa) {
                try {
                    this.onPong()
                } catch {
                    this.close(1011)
                }
            } else {
                try {
                    this.onMessage(frame.opcode, frame.payload)
                } catch {
                    this.close(1011)
                }
            }
        }
    }

    #finish(code: number): void {
        if (this.#closed) return
        this.#closed = true
        this.onClose(code)
    }
}
