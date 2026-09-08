const PINCH_RATIO = 1.12

export function pinchStepForRatio(ratio: number): 1 | -1 | 0 {
    if (ratio >= PINCH_RATIO) return 1
    if (ratio <= 1 / PINCH_RATIO) return -1
    return 0
}
