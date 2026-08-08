# Starforge

[![CI](https://github.com/Gabriel-Lacorte/starforge/actions/workflows/ci.yml/badge.svg)](https://github.com/Gabriel-Lacorte/starforge/actions/workflows/ci.yml)

A pixel art & animation studio that runs entirely in the browser. Open the page and draw.

![The Starforge editor](docs/media/editor.png)

## Features

**Drawing**: pencil, eraser, line, rectangle and ellipse (outline or filled),
and a bucket with scanline flood fill, per-channel tolerance and a
contiguous/global switch. Rectangular select with lift-and-move.

**Layers**: add, duplicate, delete, reorder, rename. Per-layer opacity, seven
blend modes (normal, multiply, screen, overlay, darken, lighten, additive),
visibility and lock.

**History**: undo and redo of whole gestures _and_ of structural edits. Dragging
the opacity slider is one undo step, not sixty. Deleting a layer costs no memory
to undo, the entry keeps the detached layer itself instead of copying its pixels.

**Rendering**: the frame is composited once into an offscreen canvas and blitted
to the screen, and it only recomposites when something actually changed. Pixels
stay crisp at every zoom level.

**Export**: PNG of the current frame.

Keyboard:
`B` pencil * `E` eraser * `L` line * `U` rect/ellipse * `G` bucket *
`M` select * `[` `]` brush size * `Space` pan * `Alt`+click eyedropper

## Run locally

Requires Node 20.19+.

```bash
npm install
npm run dev      # editor at localhost:5173
npm run build    # production bundle
npm test         # 163 unit and property tests
npm run lint     # prettier + eslint + tsc
```

## Architecture

An npm workspace with two packages, split by what they are allowed to know:

| Package   | Contains                                                      | Depends on |
| --------- | ------------------------------------------------------------- | ---------- |
| `core/`   | document model, pixel ops, flood fill, geometry, undo command | nothing    |
| `client/` | canvas engine, tools, compositor, layers UI                   | `core`     |

`core/` has zero dependencies on purpose, it is the half that the relay server
will also run when multiplayer lands, so it cannot reach for the DOM.

## Roadmap

Shipped: canvas engine * the tool set above * layers.

Next: palettes and symmetry * frames, timeline and onion skin * **a CRDT for
real-time collaboration** (LWW per cell with Lamport clocks) *
a GIF89a + LZW encoder * WebGL filters * IndexedDB autosave and
crash recovery * a public gallery.

## License

[MIT](LICENSE)

The interface is set in [Silkscreen](https://github.com/googlefonts/silkscreen) by
Jason Kottke, used under the SIL Open Font License
([client/public/fonts/OFL.txt](client/public/fonts/OFL.txt)).
