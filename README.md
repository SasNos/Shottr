# Shottr

Chrome extension (Manifest V3, no build step, no runtime dependencies; the dev dependencies are only the linters and the formatter).

## Features

- **Full page**: scrolls the page and stitches the screenshots. Only the page content is captured, never the browser UI.
- **Selected area**: drag a frame, then adjust it (eight handles to resize, drag inside to move) and confirm with Enter, the Capture button or a double click. Esc cancels.
- **Visible part**: the current viewport.
- **Editor** after every capture, opened in a new tab right next to the page (closing it returns to the page), preview in the real size of the page: pen, hollow rectangles and ellipses (in the pen color), comments, undo, redo, clear.
  - Color picker and stroke width 1 to 5 px.
  - Comments: black text on a white box. The box is resizable (down to one character wide) and wraps text; bold, italic and font size (10 to 48 px) apply to the whole comment.
- **Cancel**: Esc during the area selection or during a full page capture aborts it; Cancel (or Esc) in the editor closes the tab, with a confirmation when there are annotations.
- **Output**: download as PNG, WebP or PDF (single page, sized to the screenshot), copy to the clipboard (PNG), or share through the system share sheet (shown only when the browser supports sharing files).

## Install (development)

1. Open `chrome://extensions`, enable _Developer mode_.
2. _Load unpacked_ and select this folder.

## Develop

```bash
npm install       # once: ESLint, Stylelint and Prettier
npm test          # run the tests
npm run coverage  # tests with a 100% line, branch and function threshold
npm run lint      # ESLint (JS), Stylelint (CSS), Prettier check
npm run format    # Prettier and the auto-fixable lint rules
npm run icons     # regenerate icons/ (only needed when the icon design changes)
```

## Limitations

- Full page scrolls the page itself. Content inside a separately scrolling container (an inner scroll area of a web app) is not stitched.
- Fixed and sticky elements appear in the first tile only; they are hidden while the remaining tiles are captured.
- Pages are capped at 30000 CSS px of height; the stitched image is scaled down if it exceeds the canvas limits of Chrome (16384 px per side).
- Chrome does not allow capturing `chrome://` pages and the Chrome Web Store; the toolbar button then shows a `!` with the reason as tooltip.
- PDF pages are limited to 14400 pt; taller screenshots are scaled down to fit.

## Spark

Shottr is built into the browser Spark as a tool; the pipeline and the editor take their Chrome access through the hosts in `src/hosts/`, so Spark can supply its own. See [docs/SPARK.md](docs/SPARK.md).

## Design

The look comes from Spark, which takes its design system from Mber Flow (`SasNos/MberFlow`): `src/theme.css` is a copy of the Mber Flow tokens (spacing on the 4 px grid, type scale, control heights, radii, colors for light and dark). The other stylesheets use only these variables; Stylelint rejects hex and named colors and px values for font sizes, spacing and radii outside `theme.css`. Rules: `docs/STYLEGUIDE.md` in Mber Flow.

## Layout

- `src/capture.js`, `src/content.js`: capture pipeline and page script, independent of Chrome.
- `src/hosts/`: the Chrome side of the pipeline and the editor (`chrome.scripting`, `captureVisibleTab`, `chrome.storage`, tabs).
- `src/background.js`, `src/popup.*`, `src/editor-main.js`: the extension shell.
- `src/stitch.js`, `src/layout.js`: tile stitching and cropping.
- `src/editor*.js`, `src/annotations.js`: preview and annotation editor.
- `src/theme.css`, `src/theme.js`: design tokens and the light or dark switch.
- `src/export.js`, `src/pdf.js`: PNG, WebP and PDF output (the PDF writer is built in).
- `test/`: unit tests with browser API doubles in `test/helpers/`.
