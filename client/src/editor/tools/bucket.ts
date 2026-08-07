import { floodFill } from '@starforge/core'
import type { Tool, ToolHost } from './tool'

export function makeBucket(host: ToolHost): Tool {
    return {
        begin(x, y) {
            const { color, fillTolerance, fillContiguous } = host.state
            host.absorb(
                floodFill(host.sprite, host.layer, host.frame, x, y, color, {
                    tolerance: fillTolerance,
                    contiguous: fillContiguous,
                }),
            )
        },
        move() {
            /* will paint on begin */
        },
        end() {
            return true
        },
    }
}
