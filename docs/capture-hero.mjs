/**
 * Captures docs/media/hero.gif — run with the dev server already up:
 *
 *   npm run dev          # terminal 1
 *   node docs/capture-hero.mjs   # terminal 2
 *
 * Requires: ffmpeg on PATH (for GIF palette + encoding).
 * Optional: URL as first argument (default: http://localhost:5173).
 */

import { createRequire } from 'module'
import { execFileSync } from 'child_process'
import { mkdirSync, rmSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const req = createRequire(join(__dirname, '..', 'package.json'))
const { chromium } = req('playwright')

const URL = process.argv[2] ?? 'http://localhost:5173'
const OUT = join(__dirname, 'media', 'hero.gif')
const TMP = join(__dirname, '.hero-frames')
const W = 1280
const H = 720
const FPS = 12
/* fit picks the largest zoom for the window; one step back keeps the star from filling the frame */
const ZOOM_OUT_STEPS = 1

async function wait(ms) {
    return new Promise((r) => setTimeout(r, ms))
}

async function screenshot(page, index) {
    const path = join(TMP, `f${String(index).padStart(4, '0')}.png`)
    await page.screenshot({ path, clip: { x: 0, y: 0, width: W, height: H } })
    return path
}

// Capture N screenshots at a fixed interval, returning frame count
async function record(page, ms, frames) {
    const interval = Math.round(1000 / FPS)
    let i = frames
    const end = Date.now() + ms
    while (Date.now() < end) {
        await screenshot(page, i++)
        await wait(interval)
    }
    return i
}

async function run() {
    mkdirSync(TMP, { recursive: true })

    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    await page.setViewportSize({ width: W, height: H })

    console.log(`→ opening ${URL}`)
    await page.goto(URL)
    await page.getByTestId('canvas').waitFor({ timeout: 15_000 })
    // wait for the initial render to settle
    await wait(400)

    for (let z = 0; z < ZOOM_OUT_STEPS; z++) {
        await page.getByTestId('zoom-out').click()
        await wait(120)
    }

    const playBtn = page.getByTestId('playback-toggle')
    const onionBtn = page.getByTestId('onion')
    const frameCells = page.getByTestId('frame-cell')

    // ── phase 1: three loops of the starter animation (~3s at 100ms/frame × 4f) ──
    console.log('→ recording playback (3 loops)')
    await playBtn.click()
    await wait(200)
    let n = 0
    n = await record(page, 3200, n)

    // ── phase 2: stop on frame 2 ──
    console.log('→ pausing')
    await playBtn.click()
    await wait(100)
    await frameCells.nth(1).click()
    await wait(150)
    n = await record(page, 400, n)

    // ── phase 3: onion skin on — ghosts appear ──
    console.log('→ toggling onion skin')
    const wasOn = (await onionBtn.getAttribute('aria-pressed')) === 'true'
    if (!wasOn) await onionBtn.click()
    await wait(120)
    n = await record(page, 500, n)

    // ── phase 4: step through frames so the ghosts show ──
    console.log('→ stepping through frames')
    for (let f = 0; f < 4; f++) {
        await frameCells.nth(f % 4).click()
        await wait(80)
        n = await record(page, 320, n)
    }

    // ── phase 5: hold last frame ──
    n = await record(page, 300, n)

    await browser.close()
    console.log(`→ captured ${n} frames`)

    // ── ffmpeg: build palette then GIF ──
    const palette = join(TMP, 'palette.png')
    console.log('→ building palette')
    execFileSync(
        'ffmpeg',
        [
            '-y',
            '-framerate',
            String(FPS),
            '-i',
            join(TMP, 'f%04d.png'),
            '-vf',
            'palettegen=max_colors=256:stats_mode=full',
            palette,
        ],
        { stdio: 'inherit' },
    )

    console.log('→ encoding GIF')
    execFileSync(
        'ffmpeg',
        [
            '-y',
            '-framerate',
            String(FPS),
            '-i',
            join(TMP, 'f%04d.png'),
            '-i',
            palette,
            '-lavfi',
            'paletteuse=dither=bayer:bayer_scale=5',
            OUT,
        ],
        { stdio: 'inherit' },
    )

    rmSync(TMP, { recursive: true, force: true })

    const kb = Math.round(statSync(OUT).size / 1024)
    console.log(`✓ wrote ${OUT} (${kb} KB)`)
}

run().catch((err) => {
    console.error(err)
    process.exit(1)
})
