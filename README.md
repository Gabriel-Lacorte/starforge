# Starforge

[![Hit Count](https://hits.dwyl.com/Gabriel-Lacorte/starforge.svg)](https://hits.dwyl.com/Gabriel-Lacorte/starforge)

A pixel art & animation studio that runs entirely in the browser. Open the page and draw.

![The Starforge editor](docs/media/editor.png)

## Features

- **Drawing**: pencil, eraser, line, rectangle and ellipse (outline or filled),
  and a bucket with scanline flood fill, per-channel tolerance and a
  contiguous/global switch. Pixel-perfect freehand strokes drop the corner a
  turn leaves behind, and lock alpha paints only where there is already colour.

- **Selection**: rectangle, ellipse, lasso and magic wand, combinable with
  Shift/Alt, with lift-and-move, flip, rotate and crop-to-selection. What is
  selected is what a stroke can touch.

- **Animation**: frames on a timeline with per-frame duration, duplicate with
  cels, reorder, and looping playback that never writes into the frame you are
  editing.

- **Color**: a palette bar backed by an editable, reorderable, importable
  palette, and a Color Studio that mixes in HSV with hex and per-channel input.
  Hue survives a trip through black instead of snapping to red.

- **Layers**: add, duplicate, delete, reorder, rename. Per-layer opacity, seven
  blend modes, visibility and lock.

- **History**: undo and redo of whole gestures _and_ of structural edits, from the
  toolbar or the keyboard. Dragging the opacity slider is one undo step, not sixty.
  Deleting a layer costs no memory to undo, the entry keeps the detached layer
  itself instead of copying its pixels.

- **Files**: drawings autosave to the browser and come back on reload, with a
  library to keep more than one. Save an editable `.starforge` project, or
  export a Portable PNG, a real image with the full project embedded in it, so
  the file you post is also the file you can keep editing. PNG export per frame.

- **Rendering**: the frame is composited once into an offscreen canvas and blitted
  to the screen, and it only recomposites when something actually changed. Pixels
  stay crisp at every zoom level, and wheel zoom accumulates trackpad deltas so
  one glide is one step, not twenty-five.

- **On a phone**: pinch to zoom, two fingers to pan, and a zoom control in the
  status bar that fits the document to the window. The layers panel folds away by
  default and floats over the canvas, and tapping outside it dismisses it instead
  of drawing on your sprite. Every control you can point at is at least 24px.

- **When something breaks**: a render error does not take the drawing off the
  screen. The recovery screen still exports, because the PNG is built from the
  document and not from the editor that failed.

## Run locally

Requires Node 20.19+.

```bash
npm install
npm run dev        # editor at localhost:5173
npm run build      # production bundle
npm test           # 511 unit and property tests
npm run test:e2e   # Playwright: draw, reload, export
npm run bench      # ink kernels on node, compositor in the browser
npm run lint       # prettier + eslint + tsc
```

## Architecture

An npm workspace with two packages, split by what they are allowed to know:

| Package   | Contains                                                                                                            | Depends on |
| --------- | ------------------------------------------------------------------------------------------------------------------- | ---------- |
| `core/`   | document model, operations with inverses, ink kernels, flood fill, geometry, masks, frames, palettes, serialization | nothing    |
| `client/` | canvas engine, tools, compositor, controllers, UI, storage                                                          | `core`     |

`core/` has zero dependencies on purpose, it is the half that the relay server will also run when multiplayer lands.

## Roadmap

Shipped: canvas engine, the tool set above, layers, animation frames and
playback, palettes and the Color Studio, project files and portable PNG,
documents that survive a reload.

Next:

- onion skin
- a CRDT for real-time collaboration (LWW per cell with Lamport clocks)
- a GIF89a + LZW encoder · WebGL filters
- a public gallery?

## License

[MIT](LICENSE)

The interface is set in [Silkscreen](https://github.com/googlefonts/silkscreen) by
Jason Kottke, used under the SIL Open Font License
([client/public/fonts/OFL.txt](client/public/fonts/OFL.txt)).

Toolbar and UI icons are from [pixelarticons](https://pixelarticons.com) by
Gerrit Halfmann, used under the MIT License
([THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md)).
