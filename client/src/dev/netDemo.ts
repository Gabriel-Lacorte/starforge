import {
    Replica,
    decodeFrame,
    decodeOperation,
    decodeSprite,
    encodeFrame,
    encodeOperation,
    splitPixelPatch,
    type DocumentOperation,
} from '@starforge/core'
import { DocumentSession } from '../document/session'

export interface NetStatus {
    readonly phase: 'connecting' | 'open' | 'closed'
    readonly site: number
    readonly error: string | null
}

export interface NetLink {
    readonly session: DocumentSession
    subscribe(listener: () => void): () => void
    status(): NetStatus
    close(): void
}

/**
 * Creates a throwaway lab room on the relay and returns its id. The caller
 * connects with `connectNet`; separating the two keeps the lab's Reset
 * button (new room per epoch) a one-liner.
 */
export async function createNetRoom(
    httpBase: string,
    init: { title: string; width: number; height: number },
): Promise<string> {
    const response = await fetch(`${httpBase}/api/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(init),
    })
    if (!response.ok) throw new Error(`could not create a net room (${String(response.status)})`)
    const data = (await response.json()) as { id: string }
    return data.id
}

export function connectNet(
    url: string,
    opts: { room: string; nickname: string; color: number },
): Promise<NetLink> {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(url)
        socket.binaryType = 'arraybuffer'
        let settled = false
        const timer = window.setTimeout(() => {
            if (!settled) {
                settled = true
                socket.close()
                reject(new Error('relay did not answer in time'))
            }
        }, 5000)

        socket.addEventListener('open', () => {
            socket.send(
                encodeFrame({
                    type: 'hello',
                    protocol: 1,
                    room: opts.room,
                    nickname: opts.nickname,
                    color: opts.color,
                    since: 0,
                }),
            )
        })

        const fail = (message: string): void => {
            if (settled) return
            settled = true
            window.clearTimeout(timer)
            socket.close()
            reject(new Error(message))
        }
        socket.addEventListener('error', () => {
            fail('could not reach the relay')
        })

        socket.addEventListener('message', (event) => {
            let frame
            try {
                frame = decodeFrame(new Uint8Array(event.data as ArrayBuffer))
            } catch {
                fail('the relay sent bytes this client cannot read')
                return
            }
            if (settled) return
            if (frame.type !== 'welcome') {
                fail('the relay did not welcome this client')
                return
            }
            settled = true
            window.clearTimeout(timer)
            const link = openLink(socket, frame, opts)
            resolve(link)
        })
    })
}

function splitPixelPatchIfNeeded(op: DocumentOperation): DocumentOperation[] {
    if (op.kind !== 'pixel.patch') return [op]
    return splitPixelPatch(op)
}

function openLink(
    socket: WebSocket,
    welcome: Extract<ReturnType<typeof decodeFrame>, { type: 'welcome' }>,
    opts: { room: string; nickname: string; color: number },
): NetLink {
    const snapshotJson = new TextDecoder().decode(welcome.snapshot)
    const sprite = decodeSprite(JSON.parse(snapshotJson) as unknown)
    const session = new DocumentSession(sprite, {
        author: `net-${String(welcome.site)}-${opts.nickname}`,
    })
    const replica = new Replica(session.doc, welcome.site)

    let current: NetStatus = { phase: 'open', site: welcome.site, error: null }
    const listeners = new Set<() => void>()
    const notify = (): void => {
        for (const listener of listeners) listener()
    }
    const setStatus = (next: NetStatus): void => {
        current = next
        notify()
    }

    const receiveOp = (stamp: number, body: Uint8Array): void => {
        let op: DocumentOperation
        try {
            op = decodeOperation(body)
        } catch {
            return
        }
        let result
        try {
            result = replica.receive({ type: 'operation', stamp, operation: op })
        } catch {
            return
        }
        for (const out of result.operations) {
            try {
                session.applyRemote(out)
            } catch {
                /* ignore */
            }
        }
    }

    const noteErrorMessage = (message: string): void => {
        setStatus({ phase: current.phase, site: current.site, error: message })
    }

    socket.addEventListener('message', (event) => {
        let frame
        try {
            frame = decodeFrame(new Uint8Array(event.data as ArrayBuffer))
        } catch {
            return
        }
        if (frame.type === 'op') receiveOp(frame.stamp, frame.body)
        else if (frame.type === 'error') noteErrorMessage(frame.message)
    })
    socket.addEventListener('close', () => {
        setStatus({ phase: 'closed', site: current.site, error: current.error })
    })

    session.onOperation((op, origin) => {
        if (origin !== 'local') return
        for (const chunk of splitPixelPatchIfNeeded(op)) {
            const out = replica.publish(chunk, { alreadyApplied: true })
            const msg = out.message
            if (msg?.type !== 'operation') continue
            socket.send(
                encodeFrame({
                    type: 'op',
                    seq: 0,
                    stamp: msg.stamp,
                    body: encodeOperation(chunk),
                }),
            )
        }
    })

    const link = {
        session,
        subscribe(listener: () => void): () => void {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
        status(): NetStatus {
            return current
        },
        close(): void {
            socket.close()
        },
        receiveOp,
        noteError: noteErrorMessage,
    } as unknown as NetLink
    return link
}
