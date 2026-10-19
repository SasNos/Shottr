# Shottr

Chrome extension (Manifest V3, no build step, no dependencies).

## Features

- **Full page**: scrolls the page and stitches the screenshots. Only the page content is captured, never the browser UI.
- **Selected area**: drag a rectangle on the page (Esc cancels).
- **Visible part**: the current viewport.
- **Editor** after every capture: pen, hollow rectangles and ellipses (in the pen color), comments, undo, redo, clear.
  - Colors: four swatches plus a color picker. Stroke width 1 to 5 px.
  - Comments: black text on a white box. The box is resizable (down to one character wide) and wraps text; bold, italic and font size (10 to 48 px) apply to the whole comment.
- **Output**: download as PNG, WebP or PDF (single page, sized to the screenshot), copy to the clipboard (PNG), or share through the system share sheet (shown only when the browser supports sharing files).

## Install (development)

1. Open `chrome://extensions`, enable *Developer mode*.
2. *Load unpacked* and select this folder.

## Develop

```bash
npm test          # run the tests
npm run coverage  # tests with a 100% line, branch and function threshold
npm run icons     # regenerate icons/ (only needed when the icon design changes)
```

## Limitations

- Full page scrolls the page itself. Content inside a separately scrolling container (an inner scroll area of a web app) is not stitched.
- Fixed and sticky elements appear in the first tile only; they are hidden while the remaining tiles are captured.
- Pages are capped at 30000 CSS px of height; the stitched image is scaled down if it exceeds the canvas limits of Chrome (16384 px per side).
- Chrome does not allow capturing `chrome://` pages and the Chrome Web Store; the toolbar button then shows a `!` with the reason as tooltip.
- PDF pages are limited to 14400 pt; taller screenshots are scaled down to fit.

## Layout

- `src/capture.js`, `src/content.js`, `src/background.js`: capture pipeline (service worker, page script).
- `src/stitch.js`, `src/layout.js`: tile stitching and cropping.
- `src/editor*.js`, `src/annotations.js`: preview and annotation editor.
- `src/export.js`, `src/pdf.js`: PNG, WebP and PDF output (the PDF writer is built in).
- `test/`: unit tests with browser API doubles in `test/helpers/`.
