export const TWO_FINGER_TAP_MS = 300
export const TWO_FINGER_TAP_SLOP = 12

interface TapPoint {
    readonly x: number
    readonly y: number
}

export class TwoFingerTap {
    private candidate: { id: number; t: number } | null = null
    private anchor: { first: TapPoint; second: TapPoint } | null = null

    private readonly now: () => number

    constructor(now: () => number = Date.now) {
        this.now = now
    }

    press(id: number, touches: ReadonlyMap<number, TapPoint>): void {
        this.candidate = null
        this.anchor = null
        if (touches.size !== 2) return

        const point = touches.get(id)
        const other = [...touches].find(([key]) => key !== id)
        if (point === undefined || other === undefined) return

        this.candidate = { id, t: this.now() }
        this.anchor = {
            first: { x: other[1].x, y: other[1].y },
            second: { x: point.x, y: point.y },
        }
    }

    drifted(touches: ReadonlyMap<number, TapPoint>): boolean {
        const candidate = this.candidate
        const anchor = this.anchor
        if (candidate === null || anchor === null) return false

        const current = touches.get(candidate.id)
        const other = [...touches].find(([key]) => key !== candidate.id)?.[1]
        if (current === undefined || other === undefined) return true

        return (
            Math.hypot(current.x - anchor.second.x, current.y - anchor.second.y) >
                TWO_FINGER_TAP_SLOP ||
            Math.hypot(other.x - anchor.first.x, other.y - anchor.first.y) > TWO_FINGER_TAP_SLOP
        )
    }

    release(id: number): boolean {
        const candidate = this.candidate
        if (candidate?.id !== id) return false
        this.candidate = null
        this.anchor = null
        return this.now() - candidate.t < TWO_FINGER_TAP_MS
    }

    cancel(): void {
        this.candidate = null
        this.anchor = null
    }
}
