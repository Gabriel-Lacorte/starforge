import { decodeFrame, encodeFrame, type Hello, type NetFrame } from '@starforge/core'

export interface SocketLike {
    send(data: Uint8Array): void
    close(): void
    onopen: (() => void) | null
    onmessage: ((data: ArrayBuffer) => void) | null
    onerror: (() => void) | null
    onclose: (() => void) | null
}

export type ConnStatus = 'connecting' | 'open' | 'closed'

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000]

const UNREADABLE_MESSAGE = 'the relay sent bytes this client cannot read'
const UNWELCOMED_MESSAGE = 'the relay did not welcome this client'

export function openBrowserSocket(url: string): SocketLike {
    const socket = new WebSocket(url)
    socket.binaryType = 'arraybuffer'
    const like: SocketLike = {
        send(data: Uint8Array): void {
            socket.send(data as Uint8Array<ArrayBuffer>)
        },
        close(): void {
            socket.close()
        },
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
    }
    socket.addEventListener('open', () => {
        like.onopen?.()
    })
    socket.addEventListener('message', (event) => {
        like.onmessage?.(event.data as ArrayBuffer)
    })
    socket.addEventListener('error', () => {
        like.onerror?.()
    })
    socket.addEventListener('close', () => {
        like.onclose?.()
    })
    return like
}

export class RoomConnection {
    onError: (message: string) => void = (): void => undefined
    onFrame: (frame: NetFrame) => void = (): void => undefined

    lastSeq = 0

    private phase: ConnStatus = 'closed'
    private readonly listeners = new Set<() => void>()
    private readonly url: string
    private readonly hello: () => Hello
    private readonly openSocket: (url: string) => SocketLike
    private socket: SocketLike | null = null
    private timer: ReturnType<typeof setTimeout> | null = null
    private redials = 0
    private welcomed = false
    private generation = 0

    constructor(
        url: string,
        hello: () => Hello,
        openSocket: (url: string) => SocketLike = openBrowserSocket,
    ) {
        this.url = url
        this.hello = hello
        this.openSocket = openSocket
    }

    status(): ConnStatus {
        return this.phase
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener)
        return (): void => {
            this.listeners.delete(listener)
        }
    }

    connect(): void {
        if (this.phase === 'connecting' || this.phase === 'open') return
        this.dial()
    }

    resetSeq(seq: number): void {
        this.lastSeq = seq
    }

    send(frame: NetFrame): void {
        if (this.phase !== 'open' || this.socket === null) return
        try {
            this.socket.send(encodeFrame(frame))
        } catch {
            /* */
        }
    }

    close(): void {
        this.generation += 1
        this.redials = 0
        if (this.timer !== null) {
            clearTimeout(this.timer)
            this.timer = null
        }
        const socket = this.socket
        this.socket = null
        if (socket !== null) {
            socket.onopen = null
            socket.onmessage = null
            socket.onerror = null
            socket.onclose = null
            socket.close()
        }
        this.setStatus('closed')
    }

    private dial(): void {
        this.generation += 1
        const generation = this.generation
        this.welcomed = false
        const socket = this.openSocket(this.url)
        this.socket = socket
        this.setStatus('connecting')
        socket.onopen = (): void => {
            if (!this.isCurrent(generation, socket)) return
            this.setStatus('open')
            socket.send(encodeFrame(this.hello()))
        }
        socket.onmessage = (data: ArrayBuffer): void => {
            if (!this.isCurrent(generation, socket)) return
            this.handleMessage(data)
        }
        socket.onerror = (): void => {
            if (!this.isCurrent(generation, socket)) return
        }
        socket.onclose = (): void => {
            if (!this.isCurrent(generation, socket)) return
            this.socket = null
            if (this.phase === 'closed') return
            this.setStatus('connecting')
            const delay = BACKOFF_MS[Math.min(this.redials, BACKOFF_MS.length - 1)] ?? 8000
            this.redials += 1
            this.timer = setTimeout((): void => {
                this.timer = null
                if (this.phase === 'closed') return
                this.dial()
            }, delay)
        }
    }

    private handleMessage(data: ArrayBuffer): void {
        let frame: NetFrame
        try {
            frame = decodeFrame(new Uint8Array(data))
        } catch {
            this.onError(UNREADABLE_MESSAGE)
            this.close()
            return
        }
        if (frame.type === 'error') {
            this.onError(frame.message)
            this.close()
            return
        }
        if (!this.welcomed) {
            if (frame.type !== 'welcome') {
                this.onError(UNWELCOMED_MESSAGE)
                this.close()
                return
            }
            this.welcomed = true
            this.redials = 0
        }
        if ((frame.type === 'op' || frame.type === 'welcome') && frame.seq > this.lastSeq)
            this.lastSeq = frame.seq
        this.onFrame(frame)
    }

    private isCurrent(generation: number, socket: SocketLike): boolean {
        return generation === this.generation && this.socket === socket
    }

    private setStatus(next: ConnStatus): void {
        if (next === this.phase) return
        this.phase = next
        for (const listener of this.listeners) listener()
    }
}
