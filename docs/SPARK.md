# Shottr in Spark

Spark (`SasNos/Spark`) has no extension system; Shottr becomes a built-in tool (Spark `CONCEPT.md` 6.16, target
version 0.3). This file describes what Shottr provides for that and what Spark has to supply. Nothing on the Spark
side is built yet.

## What is shared and what is Chrome only

| Part                           | Files                                                                     | In Spark                                                                                |
| ------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Capture pipeline               | `src/capture.js`, `src/layout.js`                                         | reused as is, with Spark's page host                                                    |
| Page script                    | `src/content.js`                                                          | injected into the tab by Spark                                                          |
| Stitching, annotations, export | `src/stitch.js`, `src/annotations.js`, `src/export.js`, `src/pdf.js`      | reused as is                                                                            |
| Editor                         | `src/editor.js`, `src/editor.html`, `src/editor.css`, `src/theme.css`     | reused as a Spark page in the chrome web view, with Spark's editor host                 |
| Chrome hosts                   | `src/hosts/chrome-page.js`, `src/hosts/chrome-editor.js`                  | replaced by Spark hosts                                                                 |
| Extension shell                | `manifest.json`, `src/background.js`, `src/popup.*`, `src/editor-main.js` | replaced: toolbar or menu entry and shortcut in Spark, Rust module for the capture flow |

The look already follows Spark: `src/theme.css` holds the Mber Flow tokens with the same names, and Spark sets
`data-theme` itself.

## The two host interfaces

**Page host** for `createCapturer({ page })` (`src/capture.js`). A `tab` is whatever Spark uses to name a tab view;
the pipeline reads `tab.url` and `tab.title`.

| Function                                        | Chrome (`hosts/chrome-page.js`)                        | Spark, Windows (WebView2)                                         | Spark, macOS (WKWebView)                  |
| ----------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- | ----------------------------------------- |
| `inject(tab)`                                   | `chrome.scripting.executeScript` with `src/content.js` | `ExecuteScriptAsync` with the file's text                         | `evaluateJavaScript` with the file's text |
| `call(tab, name, ...args)`                      | `executeScript` with `callContent`                     | DevTools `Runtime.evaluate` with `awaitPromise` (see open points) | `callAsyncJavaScript`                     |
| `grab(tab)`                                     | `captureVisibleTab`, at most 2 per second              | `CapturePreviewAsync` (PNG)                                       | `takeSnapshot`                            |
| `copy(tab, base64)` (Copy in the selection bar) | `copyInPage` in the tab: async clipboard, short note   | OS clipboard from Rust (`arboard`), toast in the chrome           | same                                      |

**Editor host** for `initEditor({ host })` (`src/editor.js`).

| Function                  | Chrome (`hosts/chrome-editor.js`)               | Spark                                           |
| ------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| `loadJob()`               | reads and deletes the job from `chrome.storage` | Tauri command of the Shottr module              |
| `confirmDiscard(message)` | browser `confirm()`                             | Mber `askConfirm` (no browser dialogs in Spark) |
| `close()`                 | closes the editor tab                           | closes the editor page or panel                 |

## Selected area with DevTools

Only the area selection can include the DevTools. In Chrome (`src/hosts/chrome-window.js`) the whole window is taken
through the desktop capture dialog, and the editor lets the user select the area on that picture (`select: true` in
the job, `pickArea` in `src/editor.js`). Spark needs one more host function for the same job:

| Function                                                                                         | Spark, Windows                                                                                                                                       | Spark, macOS                                                                         |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `grabWindow()`: picture of the Spark window and its DevTools window, PNG plus device pixel ratio | Windows Graphics Capture (`IGraphicsCaptureItemInterop::CreateForWindow` on Spark's own windows, no picker; without the yellow border on Windows 11) | ScreenCaptureKit for Spark's own windows; needs the screen recording permission once |

If Spark later shows its DevTools as a panel inside the chrome web view, `CapturePreviewAsync` / `takeSnapshot` of
that view is enough and no screen capture permission is needed.

## Open points for the Spark side

1. `selectArea` returns a promise. WebView2's `ExecuteScriptAsync` does not wait for promises, so Spark needs the
   DevTools protocol (`CallDevToolsProtocolMethodAsync`, `Runtime.evaluate` with `awaitPromise: true`) or a polled
   result.
2. Security review: `content.js` puts `globalThis.__shottr` into the page while a capture runs. It holds no
   privileges, but Spark's rule is that tab views get nothing callable from Spark. On macOS it can run in its own
   `WKContentWorld`; on Windows there is no isolated world for injected scripts.
3. Saving: the editor downloads through an `<a download>` link (`export.js`). Inside Spark this should go through
   Spark's download manager, which needs a `save(blob, name)` function on the editor host.
4. Full page on Windows could use DevTools `Page.captureScreenshot` with `captureBeyondViewport` instead of scrolling
   and stitching; that would also capture inner scroll areas. To be measured in the Spark slice.
