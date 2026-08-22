export interface Quantization {
    palette: number[]
    map: Map<number, number>
}

interface Box {
    colors: number[]
    channel: 0 | 1 | 2
    range: number
}

function analyze(colors: number[]): Box {
    let rMin = 255
    let rMax = 0
    let gMin = 255
    let gMax = 0
    let bMin = 255
    let bMax = 0

    for (const c of colors) {
        const r = (c >>> 16) & 0xff
        const g = (c >>> 8) & 0xff
        const b = c & 0xff

        if (r < rMin) rMin = r
        if (r > rMax) rMax = r
        if (g < gMin) gMin = g
        if (g > gMax) gMax = g
        if (b < bMin) bMin = b
        if (b > bMax) bMax = b
    }
    const rRange = rMax - rMin
    const gRange = gMax - gMin
    const bRange = bMax - bMin

    let channel: 0 | 1 | 2 = 0
    let range = rRange
    if (gRange > range) {
        channel = 1
        range = gRange
    }
    if (bRange > range) {
        channel = 2
        range = bRange
    }

    return { colors, channel, range }
}

function channelShift(channel: 0 | 1 | 2): number {
    return channel === 0 ? 16 : channel === 1 ? 8 : 0
}

export function medianCut(colors: readonly number[], max: number): Quantization {
    if (max < 1) throw new Error('medianCut: max must be at least 1')
    if (colors.length === 0) return { palette: [], map: new Map() }

    const boxes: Box[] = [analyze([...colors])]

    while (boxes.length < max) {
        let target = -1
        for (let i = 0; i < boxes.length; i++) {
            const box = boxes[i]!
            if (box.colors.length < 2) continue
            if (target === -1 || box.range > boxes[target]!.range) target = i
        }
        if (target === -1) break

        const box = boxes[target]!
        const s = channelShift(box.channel)

        const sorted = [...box.colors].sort((a, b) => {
            const av = (a >>> s) & 0xff
            const bv = (b >>> s) & 0xff
            return av - bv || a - b
        })
        const mid = sorted.length >> 1
        boxes[target] = analyze(sorted.slice(0, mid))
        boxes.push(analyze(sorted.slice(mid)))
    }

    const palette: number[] = []
    const map = new Map<number, number>()

    for (let i = 0; i < boxes.length; i++) {
        const members = boxes[i]!.colors
        let rSum = 0
        let gSum = 0
        let bSum = 0
        for (const c of members) {
            rSum += (c >>> 16) & 0xff
            gSum += (c >>> 8) & 0xff
            bSum += c & 0xff
        }
        const n = members.length

        const r = Math.round(rSum / n)
        const g = Math.round(gSum / n)
        const b = Math.round(bSum / n)
        palette.push((r << 16) | (g << 8) | b)
        for (const c of members) map.set(c, i)
    }

    return { palette, map }
}
