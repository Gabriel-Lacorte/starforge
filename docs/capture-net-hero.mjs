/**
 * Captures docs/media/devlog-ship3-2.png (provisional hero for Ship #3 Devlog 2):
 *
 *   npm run dev -w client -- --port 5199 --strictPort   # terminal 1
 *   npm run relay                                       # terminal 2
 *   node docs/capture-net-hero.mjs                      # terminal 3
 *
 * Opens two /dev/net windows side by side, paints half a chunky heart per
 * browser through the live relay, waits for convergence, and composites
 * both windows into one 1280x720 PNG. No ffmpeg needed.
 *
 * Uses a FRESH relay: the room keeps every stroke until the process dies,
 * so restart it before shooting or the still starts from a dirty canvas.
 */

/* global window document */

import { createRequire } from 'module'
import { mkdirSync, readFileSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const req = createRequire(join(__dirname, '..', 'package.json'))
const { chromium } = req('playwright')

const BASE = process.argv[2] ?? 'http://localhost:5199'
const OUT = join(__dirname, 'media', 'devlog-ship3-2.png')
const TMP = join(__dirname, '.net-hero-frames')
const W = 640
const H = 720

async function wait(ms) {
    return new Promise((r) => setTimeout(r, ms))
}

const HEART = [
    '..XXX...XXX..',
    '.XXXXXXXXXXX.',
    'XXXXXXXXXXXXX',
    'XXXXXXXXXXXXX',
    'XXXXXXXXXXXXX',
    '.XXXXXXXXXXX.',
    '..XXXXXXXXX..',
    '...XXXXXXX...',
    '....XXXXX....',
    '.....XXX.....',
    '......X......',
]
const SX = 3
const OX = 13
const OY = 18

function spans(row, lo, hi) {
    const out = []
    let start = -1
    for (let c = lo; c <= hi; c++) {
        if (row[c] === 'X') {
            if (start < 0) start = c
        } else if (start >= 0) {
            out.push([start, c - 1])
            start = -1
        }
    }
    if (start >= 0) out.push([start, hi])
    return out
}

async function mapper(page) {
    await page.getByTestId('zoom').click()
    await wait(200)
    const box = await page.getByTestId('canvas').boundingBox()
    if (!box) throw new Error('lab canvas is not visible')
    const m = await page.evaluate(() => {
        const canvas = document.querySelector('[data-testid="canvas"]')
        const r = canvas.getBoundingClientRect()
        const z = parseInt(document.querySelector('[data-testid="zoom"]').textContent, 10) / 100
        return {
            left: r.left,
            top: r.top,
            w: r.width,
            h: r.height,
            z,
            dpr: window.devicePixelRatio || 1,
        }
    })
    const ox = box.x + m.left + (m.w - (64 * m.z) / m.dpr) / 2
    const oy = box.y + m.top + (m.h - (64 * m.z) / m.dpr) / 2
    const unit = m.z / m.dpr
    return { X: (x) => ox + (x + 0.5) * unit, Y: (y) => oy + (y + 0.5) * unit }
}

async function setBrush(page) {
    await page.keyboard.press(']')
    await page.keyboard.press(']')
}

async function paintRow(page, map, swatch, r, lo, hi) {
    await page.getByTestId('swatch').nth(swatch).click()
    for (const [c0, c1] of spans(HEART[r], lo, hi)) {
        const x0 = OX + c0 * SX
        const x1 = OX + c1 * SX + (SX - 1)
        const y = OY + r * SX + 1
        await page.mouse.move(map.X(x0), map.Y(y))
        await page.mouse.down()
        if (x1 > x0) await page.mouse.move(map.X(x1), map.Y(y), { steps: x1 - x0 })
        await page.mouse.up()
    }
}

async function paintTogether(pageA, mapA, pageB, mapB) {
    for (let r = 0; r < HEART.length; r++) {
        await paintRow(pageA, mapA, 6, r, 0, 5)
        await paintRow(pageB, mapB, 13, r, 6, 12)
    }
}

async function run() {
    mkdirSync(TMP, { recursive: true })
    const browser = await chromium.launch({ headless: true })

    const first = await browser.newContext({ viewport: { width: W, height: H } })
    const second = await browser.newContext({ viewport: { width: W, height: H } })
    const a = await first.newPage()
    const b = await second.newPage()

    console.log('> opening two /dev/net windows')
    await a.goto(`${BASE}/dev/net`)
    await b.goto(`${BASE}/dev/net`)
    await a.getByTestId('canvas').waitFor({ timeout: 15_000 })
    await b.getByTestId('canvas').waitFor({ timeout: 15_000 })
    await a.getByTestId('net-status').getByText('open').waitFor({ timeout: 15_000 })
    await b.getByTestId('net-status').getByText('open').waitFor({ timeout: 15_000 })
    await wait(600)

    console.log('> mapping sprite pixels to screen pixels')
    const mapA = await mapper(a)
    await setBrush(a)
    const mapB = await mapper(b)
    await setBrush(b)

    console.log('> painting half a heart per browser, together, through the relay')
    await paintTogether(a, mapA, b, mapB)

    console.log('> waiting for convergence')
    await wait(2500)

    const shotA = join(TMP, 'left.png')
    const shotB = join(TMP, 'right.png')
    await a.screenshot({ path: shotA })
    await b.screenshot({ path: shotB })
    await browser.close()

    console.log('> compositing side by side')
    const imgA = readFileSync(shotA).toString('base64')
    const imgB = readFileSync(shotB).toString('base64')
    const browser2 = await chromium.launch({ headless: true })
    const page = await browser2.newPage({ viewport: { width: W * 2, height: H } })
    await page.setContent(
        `<body style="margin:0;display:flex"><img src="data:image/png;base64,${imgA}" width="${W}" height="${H}"><img src="data:image/png;base64,${imgB}" width="${W}" height="${H}">`,
    )
    await wait(300)
    await page.screenshot({ path: OUT })
    await browser2.close()

    rmSync(TMP, { recursive: true, force: true })
    console.log(`! wrote ${OUT}`)
}

run().catch((err) => {
    console.error(err)
    process.exit(1)
})
