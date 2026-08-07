# Starforge

A multiplayer pixel art & animation studio that runs entirely in the browser.

![Starforge editor](docs/media/editor.png)

## Features (so far)

- Pencil, eraser, line, rectangle and ellipse
- Bucket with scanline flood fill with per-channel tolerance, contiguous or global mode
- Undo/redo of whole gestures (`Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`)
- Eyedropper (`Alt`+click)
- Palette bar with the + a status bar reading out the pixel under the cursor
- Crisp pixel rendering at every zoom level
- 118 tests covering client and core


## Run locally

```bash
npm install
npm run dev
npm test
npm run lint
```

Node 20.19+

## Architecture

Monorepo with npm workspaces:
`core/` Holds the document model and ops with zero dependencies.
`client/` The Vite + Preact editor.

The full design document lives at
[docs/DESIGN.md](docs/DESIGN.md).

## License

[MIT](LICENSE).
