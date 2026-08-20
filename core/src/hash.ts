import type { Sprite } from './doc'

const LOW_PRIME = 0x01000193
const HIGH_PRIME = 0x01000199

export function documentFingerprint(sprite: Sprite): string {
    const digest = new Fingerprint()

    digest.text(sprite.id)
    digest.int(sprite.width)
    digest.int(sprite.height)

    digest.text(sprite.meta.title)
    digest.text(sprite.meta.createdAt)
    digest.text(sprite.meta.updatedAt)

    digest.text(sprite.palette.name)
    digest.int(sprite.palette.colors.length)
    for (const color of sprite.palette.colors) digest.text(color)

    digest.int(sprite.frames.length)
    for (const frame of sprite.frames) {
        digest.text(frame.id)
        digest.int(frame.duration)
    }

    digest.int(sprite.layers.length)
    for (const layer of sprite.layers) {
        digest.text(layer.id)
        digest.text(layer.name)
        digest.int(layer.opacity)
        digest.text(layer.blendMode)
        digest.int((layer.visible ? 1 : 0) | (layer.locked ? 2 : 0))

        for (const frameId of [...layer.cels.keys()].sort()) {
            const cel = layer.cels.get(frameId)!
            if (isBlank(cel.pixels)) continue

            digest.text(frameId)
            digest.int(cel.x)
            digest.int(cel.y)
            digest.bytes(cel.pixels)
        }
        digest.text('')
    }

    return digest.toString()
}

class Fingerprint {
    #low = 0x811c9dc5
    #high = 0x84222325

    byte(value: number): void {
        this.#low = Math.imul(this.#low ^ value, LOW_PRIME)
        this.#high = Math.imul(this.#high ^ value, HIGH_PRIME)
    }

    int(value: number): void {
        this.byte(value & 0xff)
        this.byte((value >>> 8) & 0xff)
        this.byte((value >>> 16) & 0xff)
        this.byte((value >>> 24) & 0xff)
    }

    text(value: string): void {
        this.int(value.length)
        for (let index = 0; index < value.length; index++) {
            const unit = value.charCodeAt(index)
            this.byte(unit & 0xff)
            this.byte(unit >>> 8)
        }
    }

    bytes(values: Uint8Array): void {
        this.int(values.length)
        for (const value of values) this.byte(value)
    }

    toString(): string {
        return hex(this.#high) + hex(this.#low)
    }
}

function isBlank(pixels: Uint8Array): boolean {
    for (const value of pixels) {
        if (value !== 0) return false
    }

    return true
}

function hex(value: number): string {
    return (value >>> 0).toString(16).padStart(8, '0')
}
