import { inBounds, type Frame, type Sprite } from '../doc'
import {
    applyOperation,
    OperationError,
    type DocumentOperation,
    type FrameAddOperation,
    type LayerAddOperation,
    type PixelPatchOperation,
} from '../operation'
import { decodeSprite, encodeSprite } from '../serial'
import { CelStamps } from './cells'
import { OrderBook } from './order'
import { LwwRegisters } from './register'
import { isNewer, LamportClock, stampLamport, stampSite, type SiteId, type Stamp } from './stamp'

export interface StampedOperation {
    readonly type: 'operation'
    readonly stamp: Stamp
    readonly operation: DocumentOperation
    readonly orderKey?: number
}
export interface OrderRebalance {
    readonly type: 'order.rebalance'
    readonly stamp: Stamp
    readonly target: 'layer' | 'frame'
    readonly keys: readonly (readonly [id: string, key: number])[]
}
export type ReplicaMessage = StampedOperation | OrderRebalance
export interface ReplicaResult {
    readonly message: ReplicaMessage | null
    readonly operation: DocumentOperation | null
    readonly operations: readonly DocumentOperation[]
}
type Target = 'layer' | 'frame'
type StructuralOperation = Extract<
    DocumentOperation,
    {
        readonly kind:
            | 'layer.add'
            | 'layer.remove'
            | 'layer.move'
            | 'frame.add'
            | 'frame.remove'
            | 'frame.move'
    }
>
type OrderedOperation = Extract<
    StructuralOperation,
    { readonly kind: 'layer.add' | 'layer.move' | 'frame.add' | 'frame.move' }
>

export class GeometryLockedError extends Error {
    constructor() {
        super('Document geometry is locked while replication is active')
        this.name = 'GeometryLockedError'
    }
}
export class UnsupportedReplicaOperationError extends Error {
    constructor(kind: string) {
        super(`Replica does not support operation: ${kind}`)
        this.name = 'UnsupportedReplicaOperationError'
    }
}

export class Replica {
    private readonly clock: LamportClock
    private readonly registers = new LwwRegisters()
    private readonly celStamps = new Map<string, Map<string, CelStamps>>()
    private readonly layerOrder = new OrderBook()
    private readonly frameOrder = new OrderBook()
    private readonly layerAdds = new Map<string, LayerAddOperation>()
    private readonly frameAdds = new Map<string, FrameAddOperation>()
    private readonly layerAlive = new Map<string, boolean>()
    private readonly frameAlive = new Map<string, boolean>()
    private readonly pendingLayerRemovals = new Set<string>()
    private readonly pendingFrameRemovals = new Set<string>()
    private readonly pendingLayerMoves = new Map<
        string,
        { readonly key: number; readonly stamp: Stamp }
    >()
    private readonly pendingFrameMoves = new Map<
        string,
        { readonly key: number; readonly stamp: Stamp }
    >()
    private pendingDependents: StampedOperation[] = []
    private readonly doc: Sprite

    constructor(doc: Sprite, site: SiteId) {
        this.doc = doc
        this.clock = new LamportClock(site)
        this.layerOrder.seed(doc.layers.map(({ id }) => id))
        this.frameOrder.seed(doc.frames.map(({ id }) => id))
        for (const [index, layer] of doc.layers.entries()) {
            this.layerAlive.set(layer.id, true)
            this.layerAdds.set(layer.id, {
                kind: 'layer.add',
                layer,
                after: index === 0 ? null : doc.layers[index - 1]!.id,
            })
        }

        for (const [index, frame] of doc.frames.entries()) {
            this.frameAlive.set(frame.id, true)
            this.frameAdds.set(
                frame.id,
                frameAdd(doc, frame, index === 0 ? null : doc.frames[index - 1]!.id),
            )
        }
    }

    publish(
        operation: DocumentOperation,
        options?: { readonly alreadyApplied?: boolean },
    ): ReplicaResult {
        this.assertSupported(operation)
        const alreadyApplied = options?.alreadyApplied === true
        const outbound = this.outboundOperation(operation, alreadyApplied)
        if (!alreadyApplied) this.validate(outbound)
        if (isOrdered(outbound)) {
            const stamp = this.clock.next()
            const key = this.localOrderKey(outbound)
            if (key === null) return this.publishRebalance(targetOf(outbound), stamp)
            return result(
                { type: 'operation', stamp, operation: outbound, orderKey: key },
                this.acceptStructural(outbound, stamp, key, alreadyApplied),
            )
        }
        const stamp = this.clock.next()
        if (isStructural(outbound))
            return result(
                { type: 'operation', stamp, operation: outbound },
                this.acceptStructural(outbound, stamp, undefined, alreadyApplied),
            )
        if (outbound.kind === 'pixel.patch') {
            if (!this.isAlive('layer', outbound.layer) || !this.isAlive('frame', outbound.frame))
                return emptyResult()
            this.recordPixels(outbound, stamp)
            return result(
                { type: 'operation', stamp, operation: outbound },
                alreadyApplied ? [] : [outbound],
            )
        }
        this.record(outbound, stamp)
        return result(
            { type: 'operation', stamp, operation: outbound },
            alreadyApplied ? [] : [outbound],
        )
    }

    receive(message: ReplicaMessage): ReplicaResult {
        assertRemoteStamp(message.stamp)
        if (message.type === 'order.rebalance') return this.receiveRebalance(message)

        this.assertSupported(message.operation)
        const operation = this.remoteOperation(message.operation)

        if (operation.kind === 'pixel.patch') {
            if (
                !this.isAlive('layer', operation.layer) ||
                !this.isAlive('frame', operation.frame)
            ) {
                if (
                    !this.hasKnownStructure('layer', operation.layer) ||
                    !this.hasKnownStructure('frame', operation.frame)
                )
                    this.deferDependent(message)
                this.clock.observe(message.stamp)
                return emptyResult()
            }
            const filtered = this.receivePixels(operation, message.stamp)
            this.clock.observe(message.stamp)
            if (!filtered) return emptyResult()
            this.recordPixels(filtered, message.stamp)
            return result(null, [filtered])
        }

        if (isStructural(operation)) {
            const orderKey = isOrdered(operation) ? requiredOrderKey(message) : undefined
            this.validateStructural(operation, orderKey)
            const operations = this.acceptStructural(operation, message.stamp, orderKey, false)
            this.clock.observe(message.stamp)
            return result(null, operations)
        }

        if (this.isUnavailableDependent(operation)) {
            this.deferDependent(message)
            this.clock.observe(message.stamp)
            return emptyResult()
        }

        const key = registerKey(operation)
        if (!key) {
            this.validate(operation)
            return emptyResult()
        }

        if (!isNewer(message.stamp, this.registers.stamp(key))) {
            this.clock.observe(message.stamp)
            return emptyResult()
        }

        let unchanged = false
        try {
            this.validate(operation)
        } catch (error) {
            if (error instanceof OperationError && error.code === 'PRECONDITION') unchanged = true
            else throw error
        }
        this.clock.observe(message.stamp)
        if (!this.registers.accept(key, message.stamp)) return emptyResult()
        return unchanged ? emptyResult() : result(null, [operation])
    }

    private receiveRebalance(message: OrderRebalance): ReplicaResult {
        if (!isTarget(message.target))
            throw new RangeError(`Invalid rebalance target: ${String(message.target)}`)
        this.validateRebalance(message.target, message.keys)
        const accepted = this.orderFor(message.target).applyRebalance(message.keys, message.stamp)
        this.clock.observe(message.stamp)
        return accepted
            ? result(null, this.movesFor(message.target, this.liveIds(message.target)))
            : emptyResult()
    }

    private acceptStructural(
        operation: StructuralOperation,
        stamp: Stamp,
        orderKey: number | undefined,
        alreadyApplied: boolean,
    ): DocumentOperation[] {
        const target = targetOf(operation),
            id = idOf(operation),
            lifeKey = `${target}:${id}:alive`
        if (operation.kind === 'layer.add' || operation.kind === 'frame.add') {
            if (!this.registers.accept(lifeKey, stamp)) return []
            if (orderKey === undefined)
                throw new RangeError(`Missing order key for ${operation.kind}`)
            this.acceptOrder(target, id, orderKey, stamp)

            const pending = this.pendingMovesFor(target).get(id)
            if (pending) {
                this.orderFor(target).accept(id, pending.key, pending.stamp)
                this.pendingMovesFor(target).delete(id)
            }

            this.setAdd(operation)
            this.aliveFor(target).set(id, true)
            this.pendingFor(target).delete(id)

            if (alreadyApplied || this.ids(target).includes(id))
                return this.releaseDependents(this.flushPending(target, []))

            const desired = this.orderFor(target).sorted([...this.ids(target), id])
            const index = desired.indexOf(id)
            const retained = this.addFor(target).get(id)!
            const payload =
                retained.kind === 'layer.add'
                    ? { ...retained, layer: this.layerForOutput(retained.layer) }
                    : retained
            const add = withAfter(payload, index === 0 ? null : desired[index - 1]!)
            return this.releaseDependents(
                this.flushPending(target, [
                    add,
                    ...this.movesFor(target, insertAfter(this.ids(target), id, add.after), desired),
                ]),
            )
        }
        if (operation.kind === 'layer.remove' || operation.kind === 'frame.remove') {
            if (!this.registers.accept(lifeKey, stamp)) return []
            this.aliveFor(target).set(id, false)

            const ids = this.ids(target)
            if (alreadyApplied || !ids.includes(id)) return []
            if (ids.length <= 1) {
                this.pendingFor(target).add(id)
                return []
            }

            return [
                target === 'layer'
                    ? { kind: 'layer.remove', layer: id }
                    : { kind: 'frame.remove', frame: id },
            ]
        }
        if (orderKey === undefined) throw new RangeError(`Missing order key for ${operation.kind}`)
        if (!this.hasOrderEntry(target, id)) {
            const pending = this.pendingMovesFor(target).get(id)
            if (!pending || isNewer(stamp, pending.stamp)) {
                this.pendingMovesFor(target).set(id, { key: orderKey, stamp })
            }
            return []
        }
        if (!this.orderFor(target).accept(id, orderKey, stamp)) return []
        if (alreadyApplied || !this.ids(target).includes(id)) return []

        return this.flushPending(target, this.movesFor(target, this.ids(target)))
    }

    private publishRebalance(target: Target, stamp: Stamp): ReplicaResult {
        const order = this.orderFor(target),
            ids = order.sorted(this.liveIds(target))
        const keys = ids.map((id, index) => [id, index] as const)
        order.applyRebalance(keys, stamp)
        return result({ type: 'order.rebalance', stamp, target, keys }, [])
    }

    private localOrderKey(operation: OrderedOperation): number | null {
        const target = targetOf(operation),
            ids = this.ids(target).filter((id) => id !== idOf(operation))

        const position = operation.after === null ? 0 : ids.indexOf(operation.after) + 1
        if (position < 0) throw new RangeError(`Unknown ${target} id: ${operation.after}`)
        const order = this.orderFor(target)

        const left = position === 0 ? undefined : order.key(ids[position - 1]!)
        const right = position === ids.length ? undefined : order.key(ids[position]!)
        if (left === undefined) return right === undefined ? 0 : right - 1
        if (right === undefined) return left + 1

        const midpoint = (left + right) / 2
        return midpoint === left || midpoint === right ? null : midpoint
    }

    private acceptOrder(target: Target, id: string, key: number, stamp: Stamp): void {
        const order = this.orderFor(target)
        try {
            order.add(id, key, stamp)
        } catch (error) {
            if (!(error instanceof RangeError) || !error.message.startsWith('Duplicate order id:'))
                throw error
            order.accept(id, key, stamp)
        }
    }

    private movesFor(
        target: Target,
        current: readonly string[],
        desired = this.orderFor(target).sorted(current),
    ): DocumentOperation[] {
        const work = [...current],
            moves: DocumentOperation[] = []
        const preserved = new Set(longestInOrderSubsequence(work, desired))

        for (let index = 0; index < desired.length; index++) {
            const id = desired[index]!
            if (preserved.has(id)) continue
            const after = index === 0 ? null : desired[index - 1]!
            const currentIndex = work.indexOf(id)
            if ((currentIndex === 0 ? null : work[currentIndex - 1]!) === after) continue
            moves.push(
                target === 'layer'
                    ? { kind: 'layer.move', layer: id, after }
                    : { kind: 'frame.move', frame: id, after },
            )
            moveAfter(work, id, after)
        }

        return moves
    }

    private flushPending(target: Target, operations: DocumentOperation[]): DocumentOperation[] {
        const ids = projectedIds(target, this.ids(target), operations)
        for (const id of [...this.pendingFor(target)]) {
            if (!ids.includes(id) || ids.length <= 1) continue
            operations.push(
                target === 'layer'
                    ? { kind: 'layer.remove', layer: id }
                    : { kind: 'frame.remove', frame: id },
            )
            removeId(ids, id)
            this.pendingFor(target).delete(id)
        }
        return operations
    }

    private orderFor(target: Target): OrderBook {
        return target === 'layer' ? this.layerOrder : this.frameOrder
    }

    private ids(target: Target): string[] {
        return target === 'layer'
            ? this.doc.layers.map(({ id }) => id)
            : this.doc.frames.map(({ id }) => id)
    }

    private liveIds(target: Target): string[] {
        return this.ids(target).filter((id) => this.isAlive(target, id))
    }

    private aliveFor(target: Target): Map<string, boolean> {
        return target === 'layer' ? this.layerAlive : this.frameAlive
    }

    private pendingFor(target: Target): Set<string> {
        return target === 'layer' ? this.pendingLayerRemovals : this.pendingFrameRemovals
    }

    private pendingMovesFor(
        target: Target,
    ): Map<string, { readonly key: number; readonly stamp: Stamp }> {
        return target === 'layer' ? this.pendingLayerMoves : this.pendingFrameMoves
    }

    private isAlive(target: Target, id: string): boolean {
        return this.aliveFor(target).get(id) === true
    }

    private addFor(target: Target): Map<string, LayerAddOperation | FrameAddOperation> {
        return target === 'layer' ? this.layerAdds : this.frameAdds
    }

    private setAdd(operation: LayerAddOperation | FrameAddOperation): void {
        if (operation.kind === 'layer.add') this.layerAdds.set(operation.layer.id, operation)
        else this.frameAdds.set(operation.frame.id, operation)
    }

    private hasOrderEntry(target: Target, id: string): boolean {
        try {
            this.orderFor(target).key(id)
            return true
        } catch (error) {
            if (error instanceof RangeError) return false
            throw error
        }
    }

    private hasKnownStructure(target: Target, id: string): boolean {
        return this.aliveFor(target).has(id)
    }

    private isUnavailableDependent(operation: DocumentOperation): boolean {
        return operation.kind === 'layer.set'
            ? !this.isAlive('layer', operation.layer)
            : operation.kind === 'frame.setDuration'
              ? !this.isAlive('frame', operation.frame)
              : false
    }
    private deferDependent(message: StampedOperation): void {
        this.pendingDependents.push(message)
    }

    private releaseDependents(operations: DocumentOperation[]): DocumentOperation[] {
        if (this.pendingDependents.length === 0) return operations
        const candidate = this.snapshot()
        for (const operation of operations)
            applyOperation(candidate, simulationOperation(operation))

        const retained: StampedOperation[] = []
        for (const message of [...this.pendingDependents].sort(
            (left, right) => left.stamp - right.stamp,
        )) {
            if (!this.dependenciesAvailable(message.operation)) {
                retained.push(message)
                continue
            }

            const released = this.releaseDependent(candidate, message)
            if (!released) continue

            operations.push(released)
        }

        this.pendingDependents = retained
        return operations
    }

    private dependenciesAvailable(operation: DocumentOperation): boolean {
        return operation.kind === 'pixel.patch'
            ? this.isAlive('layer', operation.layer) && this.isAlive('frame', operation.frame)
            : operation.kind === 'layer.set'
              ? this.isAlive('layer', operation.layer)
              : operation.kind === 'frame.setDuration'
                ? this.isAlive('frame', operation.frame)
                : true
    }

    private releaseDependent(
        candidate: Sprite,
        message: StampedOperation,
    ): DocumentOperation | null {
        const operation = message.operation
        if (operation.kind === 'pixel.patch') {
            const filtered = this.filterPixels(operation, message.stamp)
            if (!filtered) return null
            applyOperation(candidate, filtered)
            this.recordPixels(filtered, message.stamp)
            return filtered
        }
        const key = registerKey(operation)
        if (!key || !isNewer(message.stamp, this.registers.stamp(key))) return null
        try {
            applyOperation(candidate, operation)
        } catch (error) {
            if (error instanceof OperationError && error.code === 'PRECONDITION') {
                this.registers.accept(key, message.stamp)
                return null
            }
            throw error
        }
        if (!this.registers.accept(key, message.stamp)) return null
        return operation
    }

    private validateStructural(operation: StructuralOperation, orderKey: number | undefined): void {
        if (operation.kind === 'layer.add' || operation.kind === 'frame.add') {
            this.validateAdd(operation)
            return
        }
        if (!isOrdered(operation) || !this.ids(targetOf(operation)).includes(idOf(operation)))
            return
        if (orderKey === undefined) throw new RangeError(`Missing order key for ${operation.kind}`)
        const target = targetOf(operation),
            desired = this.desiredWithKey(target, idOf(operation), orderKey)
        const index = desired.indexOf(idOf(operation)),
            after = index === 0 ? null : desired[index - 1]!
        const current = this.ids(target),
            currentIndex = current.indexOf(idOf(operation))
        if ((currentIndex === 0 ? null : current[currentIndex - 1]!) === after) return
        this.validate(
            target === 'layer'
                ? { kind: 'layer.move', layer: idOf(operation), after }
                : { kind: 'frame.move', frame: idOf(operation), after },
        )
    }

    private desiredWithKey(target: Target, id: string, key: number): string[] {
        const order = this.orderFor(target)
        return this.ids(target).sort((left, right) => {
            const leftKey = left === id ? key : order.key(left)
            const rightKey = right === id ? key : order.key(right)
            return leftKey - rightKey || left.localeCompare(right)
        })
    }

    private validateAdd(operation: LayerAddOperation | FrameAddOperation): void {
        const candidate = this.snapshot()
        if (operation.kind === 'layer.add') {
            const existing = candidate.layers.find((layer) => layer.id === operation.layer.id)
            if (existing) existing.id = '__replica_validation_layer__'
        } else {
            const existing = candidate.frames.find((frame) => frame.id === operation.frame.id)
            if (existing) existing.id = '__replica_validation_frame__'
        }
        applyOperation(candidate, withAfter(operation, null))
    }

    private layerForOutput(layer: LayerAddOperation['layer']): LayerAddOperation['layer'] {
        const frames = new Set(this.ids('frame'))
        if ([...layer.cels.keys()].every((frame) => frames.has(frame))) return layer
        return { ...layer, cels: new Map([...layer.cels].filter(([frame]) => frames.has(frame))) }
    }

    private validateRebalance(target: Target, keys: OrderRebalance['keys']): void {
        const ids = this.liveIds(target)
        if (keys.length !== ids.length) throw new RangeError(`Incomplete ${target} rebalance table`)

        const expectedIds = new Set(ids)
        const seenIds = new Set<string>()
        const seenKeys = new Set<number>()

        for (const entry of keys) {
            const id: unknown = entry[0]
            const key: unknown = entry[1]
            if (typeof id !== 'string' || !expectedIds.has(id) || seenIds.has(id))
                throw new RangeError(`Invalid ${target} rebalance id: ${String(id)}`)

            if (
                typeof key !== 'number' ||
                !Number.isInteger(key) ||
                key < 0 ||
                key >= ids.length ||
                seenKeys.has(key)
            )
                throw new RangeError(`Invalid ${target} rebalance key: ${String(key)}`)

            seenIds.add(id)
            seenKeys.add(key)
        }

        if (seenIds.size !== ids.length || seenKeys.size !== ids.length)
            throw new RangeError(`Incomplete ${target} rebalance table`)
    }

    private outboundOperation(
        operation: DocumentOperation,
        alreadyApplied: boolean,
    ): DocumentOperation {
        if (operation.kind === 'pixel.patch') return copyPixelPatch(operation)
        if (!isPaletteEdit(operation) || operation.kind === 'palette.replace') return operation
        if (alreadyApplied) return paletteReplace(this.doc)
        const candidate = this.snapshot()
        applyOperation(candidate, operation)
        return paletteReplace(candidate)
    }

    private remoteOperation(operation: DocumentOperation): DocumentOperation {
        if (!isPaletteEdit(operation) || operation.kind === 'palette.replace') return operation
        const candidate = this.snapshot()
        applyOperation(candidate, operation)
        return paletteReplace(candidate)
    }

    private receivePixels(
        operation: PixelPatchOperation,
        stamp: Stamp,
    ): PixelPatchOperation | null {
        this.validate(operation)
        const filtered = this.filterPixels(operation, stamp)
        if (!filtered) return null
        this.validate(filtered)
        return filtered
    }

    private filterPixels(operation: PixelPatchOperation, stamp: Stamp): PixelPatchOperation | null {
        const xs: number[] = []
        const ys: number[] = []
        const colors: number[] = []

        for (let index = 0; index < operation.xs.length; index++) {
            const x = operation.xs[index]!
            const y = operation.ys[index]!
            if (!inBounds(this.doc, x, y)) continue

            const current =
                this.stampsFor(operation.layer, operation.frame)?.read(y * this.doc.width + x) ?? 0
            if (!isNewer(stamp, current)) continue

            xs.push(x)
            ys.push(y)
            colors.push(operation.colors[index]!)
        }

        return xs.length === 0
            ? null
            : {
                  kind: 'pixel.patch',
                  layer: operation.layer,
                  frame: operation.frame,
                  xs: Uint16Array.from(xs),
                  ys: Uint16Array.from(ys),
                  colors: Uint32Array.from(colors),
              }
    }

    private record(operation: DocumentOperation, stamp: Stamp): void {
        const key = registerKey(operation as Exclude<DocumentOperation, PixelPatchOperation>)
        if (!key) throw new UnsupportedReplicaOperationError(operation.kind)
        this.registers.accept(key, stamp)
    }

    private recordPixels(operation: PixelPatchOperation, stamp: Stamp): void {
        const stamps = this.stampsFor(operation.layer, operation.frame, true)!
        for (let index = 0; index < operation.xs.length; index++) {
            const x = operation.xs[index]!
            const y = operation.ys[index]!
            if (inBounds(this.doc, x, y)) stamps.accept(y * this.doc.width + x, stamp)
        }
    }

    private stampsFor(layer: string, frame: string, create = false): CelStamps | undefined {
        let byFrame = this.celStamps.get(layer)
        if (!byFrame && create) {
            byFrame = new Map()
            this.celStamps.set(layer, byFrame)
        }

        let stamps = byFrame?.get(frame)
        if (!stamps && create) {
            stamps = new CelStamps(this.doc.width * this.doc.height)
            byFrame!.set(frame, stamps)
        }

        return stamps
    }

    private validate(operation: DocumentOperation): void {
        applyOperation(this.snapshot(), operation)
    }

    private snapshot(): Sprite {
        return decodeSprite(encodeSprite(this.doc))
    }

    private assertSupported(operation: DocumentOperation): void {
        if (
            operation.kind === 'document.resize' ||
            operation.kind === 'document.scale' ||
            operation.kind === 'document.restore'
        )
            throw new GeometryLockedError()
    }
}

function isStructural(operation: DocumentOperation): operation is StructuralOperation {
    return (
        operation.kind === 'layer.add' ||
        operation.kind === 'layer.remove' ||
        operation.kind === 'layer.move' ||
        operation.kind === 'frame.add' ||
        operation.kind === 'frame.remove' ||
        operation.kind === 'frame.move'
    )
}

function isOrdered(operation: DocumentOperation): operation is OrderedOperation {
    return (
        operation.kind === 'layer.add' ||
        operation.kind === 'layer.move' ||
        operation.kind === 'frame.add' ||
        operation.kind === 'frame.move'
    )
}

function isTarget(value: unknown): value is Target {
    return value === 'layer' || value === 'frame'
}

function targetOf(operation: StructuralOperation): Target {
    return operation.kind.startsWith('layer.') ? 'layer' : 'frame'
}

function idOf(operation: StructuralOperation): string {
    switch (operation.kind) {
        case 'layer.add':
            return operation.layer.id
        case 'frame.add':
            return operation.frame.id
        case 'layer.remove':
        case 'layer.move':
            return operation.layer
        case 'frame.remove':
        case 'frame.move':
            return operation.frame
    }
}

function withAfter(
    operation: LayerAddOperation | FrameAddOperation,
    after: string | null,
): LayerAddOperation | FrameAddOperation {
    return { ...operation, after }
}

function requiredOrderKey(message: StampedOperation): number {
    const key = message.orderKey
    if (key === undefined || !Number.isFinite(key))
        throw new RangeError(`Invalid order key: ${String(key)}`)

    return key
}

function result(
    message: ReplicaMessage | null,
    operations: readonly DocumentOperation[],
): ReplicaResult {
    return { message, operations, operation: operations.length === 1 ? operations[0]! : null }
}

function emptyResult(): ReplicaResult {
    return result(null, [])
}

function frameAdd(doc: Sprite, frame: Frame, after: string | null): FrameAddOperation {
    const cels = doc.layers.flatMap((layer) => {
        const cel = layer.cels.get(frame.id)
        return cel ? [{ layer: layer.id, cel }] : []
    })
    return cels.length === 0
        ? { kind: 'frame.add', frame, after }
        : { kind: 'frame.add', frame, after, cels }
}

function insertAfter(ids: readonly string[], id: string, after: string | null): string[] {
    const next = [...ids]
    next.splice(after === null ? 0 : next.indexOf(after) + 1, 0, id)
    return next
}

function moveAfter(ids: string[], id: string, after: string | null): void {
    removeId(ids, id)
    ids.splice(after === null ? 0 : ids.indexOf(after) + 1, 0, id)
}

function removeId(ids: string[], id: string): void {
    const index = ids.indexOf(id)
    if (index !== -1) ids.splice(index, 1)
}

function longestInOrderSubsequence(
    current: readonly string[],
    desired: readonly string[],
): string[] {
    const positions = new Map(desired.map((id, index) => [id, index]))
    const tails: number[] = [],
        previous = new Array<number>(current.length).fill(-1)

    for (let index = 0; index < current.length; index++) {
        const position = positions.get(current[index]!)
        if (position === undefined) continue

        let low = 0,
            high = tails.length
        while (low < high) {
            const middle = (low + high) >>> 1
            if (positions.get(current[tails[middle]!]!)! < position) low = middle + 1
            else high = middle
        }

        if (low > 0) previous[index] = tails[low - 1]!
        tails[low] = index
    }

    const result: string[] = []
    for (let index = tails[tails.length - 1] ?? -1; index !== -1; index = previous[index]!)
        result.push(current[index]!)

    return result.reverse()
}
function projectedIds(
    target: Target,
    current: string[],
    operations: readonly DocumentOperation[],
): string[] {
    const ids = [...current]
    for (const operation of operations) {
        if (target === 'layer' && operation.kind === 'layer.add')
            ids.splice(
                operation.after === null ? 0 : ids.indexOf(operation.after) + 1,
                0,
                operation.layer.id,
            )
        else if (target === 'frame' && operation.kind === 'frame.add')
            ids.splice(
                operation.after === null ? 0 : ids.indexOf(operation.after) + 1,
                0,
                operation.frame.id,
            )
        else if (target === 'layer' && operation.kind === 'layer.remove')
            removeId(ids, operation.layer)
        else if (target === 'frame' && operation.kind === 'frame.remove')
            removeId(ids, operation.frame)
    }
    return ids
}
function paletteReplace(doc: Sprite): DocumentOperation {
    return { kind: 'palette.replace', name: doc.palette.name, colors: [...doc.palette.colors] }
}
function copyPixelPatch(operation: PixelPatchOperation): PixelPatchOperation {
    return {
        kind: 'pixel.patch',
        layer: operation.layer,
        frame: operation.frame,
        xs: Uint16Array.from(operation.xs),
        ys: Uint16Array.from(operation.ys),
        colors: Uint32Array.from(operation.colors),
    }
}
function simulationOperation(operation: DocumentOperation): DocumentOperation {
    if (operation.kind === 'layer.add')
        return { ...operation, layer: { ...operation.layer, cels: new Map(operation.layer.cels) } }
    if (operation.kind === 'frame.add')
        return operation.cels
            ? {
                  ...operation,
                  frame: { ...operation.frame },
                  cels: operation.cels.map((entry) => ({
                      layer: entry.layer,
                      cel: { ...entry.cel, pixels: new Uint8Array(entry.cel.pixels) },
                  })),
              }
            : { ...operation, frame: { ...operation.frame } }
    return operation
}
function assertRemoteStamp(stamp: Stamp): void {
    if (
        !Number.isInteger(stamp) ||
        stamp < 0 ||
        stamp > 0xffffffff ||
        stampLamport(stamp) < 1 ||
        stampSite(stamp) < 1
    )
        throw new RangeError(`Invalid remote stamp: ${stamp}`)
}
function isPaletteEdit(operation: DocumentOperation): boolean {
    return (
        operation.kind === 'palette.add' ||
        operation.kind === 'palette.remove' ||
        operation.kind === 'palette.move' ||
        operation.kind === 'palette.set' ||
        operation.kind === 'palette.rename' ||
        operation.kind === 'palette.replace'
    )
}

function registerKey(operation: Exclude<DocumentOperation, PixelPatchOperation>): string | null {
    switch (operation.kind) {
        case 'layer.set':
            return `layer:${operation.layer}:${operation.prop}`
        case 'frame.setDuration':
            return `frame:${operation.frame}:duration`
        case 'document.rename':
            return 'document:title'
        case 'palette.add':
        case 'palette.remove':
        case 'palette.move':
        case 'palette.set':
        case 'palette.rename':
        case 'palette.replace':
            return 'document:palette'
        case 'layer.add':
        case 'layer.remove':
        case 'layer.move':
        case 'frame.add':
        case 'frame.remove':
        case 'frame.move':
        case 'document.resize':
        case 'document.scale':
        case 'document.restore':
            return null
    }
}
