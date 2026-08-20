/* eslint-disable-next-line no-control-regex */
const CONTROL = /[\u0000-\u001f\u007f]/g

const GRAPHEMES = new Intl.Segmenter()

export function normalizeName(value: string, maximum: number): string {
    const flat = value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
    if (flat.length <= maximum) return flat

    let out = ''
    let count = 0
    for (const { segment } of GRAPHEMES.segment(flat)) {
        if (++count > maximum) break
        out += segment
    }

    return out.trim()
}
