import { floodFillInk } from '@starforge/core'
import { inkFor, type ToolDefinition } from './definition'
import type { Tool, ToolHost } from './tool'

export function traceFlood(definition: ToolDefinition, host: ToolHost): Tool {
    return {
        begin(x, y) {
            const { fillTolerance, fillContiguous } = host.settings
            host.absorb(
                floodFillInk(
                    host.sprite,
                    host.layer,
                    host.frame,
                    x,
                    y,
                    inkFor(definition, host.settings),
                    {
                        tolerance: fillTolerance,
                        contiguous: fillContiguous,
                        within: host.selection,
                    },
                ),
            )
        },
        move() {
            /* the fill already landed on begin */
        },
        end() {
            return true
        },
    }
}
