import { bench, describe } from 'vitest'
import { rgba } from './color'
import { applyInk, type InkContext } from './ink'

const CONTEXT: InkContext = {
    mode: 'source-over',
    color: rgba(237, 84, 126, 173),
    opacity: 191,
}

describe.each([
    [64, 64],
    [256, 256],
])('ink kernel %d*%d patch', (width, height) => {
    const pixels = makePatch(width, height)
    const output = new Uint32Array(pixels.length)

    bench(
        'source-over',
        () => {
            for (let index = 0; index < pixels.length; index++) {
                output[index] = applyInk(pixels[index]!, CONTEXT)
            }
            void output[output.length - 1]
        },
        { time: 500, warmupTime: 100 },
    )
})

function makePatch(width: number, height: number): Uint32Array {
    const pixels = new Uint32Array(width * height)

    let state = 0x51a7f09d
    for (let index = 0; index < pixels.length; index++) {
        state = (state * 1_664_525 + 1_013_904_223) >>> 0
        pixels[index] = state
    }

    return pixels
}
