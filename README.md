# Starforge

[![Hit Count](https://hits.dwyl.com/Gabriel-Lacorte/starforge.svg)](https://hits.dwyl.com/Gabriel-Lacorte/starforge)

A pixel art & animation studio that runs entirely in the browser. Open the page and draw.

![The Starforge editor](docs/media/editor.png)

## Features

- **Documents**: start a new sprite at any size from 16x16 to 1024x1024, name it,
  or pick a preset and go. Whatever is on screen is kept in the browser and comes
  back on reload. Export writes a PNG named after the sprite, and says so when it lands.

- **Drawing**: pencil, eraser, line, rectangle and ellipse (outline or filled),
  and a bucket with scanline flood fill, per-channel tolerance and a
  contiguous/global switch. Rectangular select with lift-and-move.

- **Layers**: add, duplicate, delete, reorder, rename. Per-layer opacity, seven
  blend modes (normal, multiply, screen, overlay, darken, lighten, additive),
  visibility and lock.

- **History**: undo and redo of whole gestures _and_ of structural edits, from the
  toolbar or the keyboard. Dragging the opacity slider is one undo step, not sixty.
  Deleting a layer costs no memory to undo, the entry keeps the detached layer
  itself instead of copying its pixels.

- **Rendering**: the frame is composited once into an offscreen canvas and blitted
  to the screen, and it only recomposites when something actually changed. Pixels
  stay crisp at every zoom level.

- **On a phone**: pinch to zoom, two fingers to pan, and a zoom control in the
  status bar that fits the document to the window. The layers panel folds away by
  default and floats over the canvas, so the drawing keeps the full width of the
  screen, and tapping outside the panel dismisses it instead of drawing on your
  sprite. Every control you can point at is at least 24px, and 36px on a phone.

- **When something breaks**: a render error does not take the drawing off the
  screen. The recovery screen still exports, because the PNG is built from the
  document and not from the editor that failed.

## Run locally

Requires Node 20.19+.

```bash
npm install
npm run dev      # editor at localhost:5173
npm run build    # production bundle
npm test         # 208 unit and property tests
npm run lint     # prettier + eslint + tsc
```

## Architecture

An npm workspace with two packages, split by what they are allowed to know:

| Package   | Contains                                                                 | Depends on |
| --------- | ------------------------------------------------------------------------ | ---------- |
| `core/`   | document model, pixel ops, flood fill, geometry, undo command, snapshots | nothing    |
| `client/` | canvas engine, tools, compositor, layers UI, storage                     | `core`     |

`core/` has zero dependencies on purpose, it is the half that the relay server
will also run when multiplayer lands, so it cannot reach for the DOM.

## Roadmap

Shipped: canvas engine * the tool set above * layers * documents that survive a reload.

Next:

- palettes and symmetry * frames
- timeline and onion skin * a CRDT for real-time collaboration (LWW per cell with Lamport clocks)
- a GIF89a + LZW encoder * WebGL filters * IndexedDB for documents too big for localStorage
- a public gallery?

## License

[MIT](LICENSE)

The interface is set in [Silkscreen](https://github.com/googlefonts/silkscreen) by
Jason Kottke, used under the SIL Open Font License
([client/public/fonts/OFL.txt](client/public/fonts/OFL.txt)).
