import { Replica, type ReplicaMessage, type ReplicaResult, type SiteId } from '@starforge/core'
import type { DocumentSession } from '../document/session'

type Source = 'left' | 'right'

interface QueuedMessage {
    readonly source: Source
    readonly message: ReplicaMessage
}

export interface CrdtDemo {
    readonly queue: QueuedMessage[]
    deliver(index: number): void
    deliverAll(): void
    duplicate(index: number): void
    reverse(): void
    subscribe(listener: () => void): () => void
}

export function createCrdtDemo(
    left: DocumentSession,
    right: DocumentSession,
    leftSite: SiteId,
    rightSite: SiteId,
): CrdtDemo {
    const leftReplica = new Replica(left.doc, leftSite)
    const rightReplica = new Replica(right.doc, rightSite)
    const queue: QueuedMessage[] = []
    const listeners = new Set<() => void>()
    const notify = () => {
        for (const listener of listeners) listener()
    }

    left.onOperation((operation, origin) => {
        if (origin !== 'local') return
        const message = leftReplica.publish(operation, { alreadyApplied: true }).message
        if (message) {
            queue.push({ source: 'left', message })
            notify()
        }
    })
    right.onOperation((operation, origin) => {
        if (origin !== 'local') return
        const message = rightReplica.publish(operation, { alreadyApplied: true }).message
        if (message) {
            queue.push({ source: 'right', message })
            notify()
        }
    })

    return {
        queue,
        deliver(index: number): void {
            if (!Number.isInteger(index) || index < 0 || index >= queue.length) {
                throw new RangeError(`Queue index out of range: ${index}`)
            }
            const queued = queue.splice(index, 1)[0]
            if (!queued) throw new RangeError(`Queue index out of range: ${index}`)
            const { source, message } = queued
            const result =
                source === 'left' ? rightReplica.receive(message) : leftReplica.receive(message)
            applyResult(source === 'left' ? right : left, result)
            notify()
        },
        deliverAll(): void {
            while (queue.length > 0) this.deliver(0)
        },
        duplicate(index: number): void {
            const queued = queue[index]
            if (!queued) throw new RangeError(`Queue index out of range: ${index}`)
            queue.push(queued)
            notify()
        },
        reverse(): void {
            queue.reverse()
            notify()
        },
        subscribe(listener: () => void): () => void {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
    }
}

function applyResult(session: DocumentSession, result: ReplicaResult): void {
    for (const operation of result.operations) session.applyRemote(operation)
}
