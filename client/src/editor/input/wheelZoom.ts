export const NOTCH = 100
const LINE = NOTCH / 3

export class WheelZoom {
    readonly #notch: number
    #banked = 0

    constructor(notch: number = NOTCH) {
        this.#notch = notch
    }

    step(deltaY: number, deltaMode = 0): 1 | -1 | 0 {
        const delta = deltaY * (deltaMode === 1 ? LINE : deltaMode === 2 ? NOTCH : 1)
        if (delta === 0) return 0

        if (Math.sign(delta) !== Math.sign(this.#banked)) this.#banked = 0
        this.#banked += delta

        if (Math.abs(this.#banked) < this.#notch) return 0

        const direction = this.#banked < 0 ? 1 : -1
        this.#banked = 0

        return direction
    }
}
