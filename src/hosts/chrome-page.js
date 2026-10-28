// Chrome host for the capture pipeline: reaches the page through chrome.scripting and grabs it with
// chrome.tabs.captureVisibleTab. Spark provides the same three functions from Rust (docs/SPARK.md).

/** Chrome allows only about two captureVisibleTab calls per second, so grabs are spaced by this. */
export const CAPTURE_INTERVAL_MS = 600;

/** How long the "copied" note stays on the page. */
export const COPIED_TOAST_MS = 1600;

/** Runs inside the page: calls a function exposed by content.js. */
export function callContent(name, args) {
  return globalThis.__shottr[name](...args);
}

/**
 * Runs inside the page: puts the PNG (base64) on the clipboard and shows `message` for `toastMs`. Self-contained
 * (no outer names), since chrome.scripting passes only the function's source. The clipboard needs the user's click
 * or key press, so the PNG goes to the write that Copy in the selection started (content.js `takeCopy`); without
 * one it is written directly. Resolves with `{ ok: true }` or `{ error }`, because a rejection would not reach the
 * service worker.
 */
export async function copyInPage(base64, message, toastMs) {
  try {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/png' });
    const pending = globalThis.__shottr?.takeCopy();
    if (pending) {
      pending.resolve(blob);
      const refused = await pending.written;
      if (refused) throw refused;
    } else {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    }
  } catch (error) {
    return { error: error.message };
  }
  // Mber Flow toast values (theme.css is not loaded in the page): --ink on --on-ink and --shadow, light or dark,
  // --radius-ctl 8 px, --fs-md 13 px.
  const [ink, onInk, shadow] = matchMedia('(prefers-color-scheme: dark)').matches
    ? ['#ede1d8', '#23262d', '0 1px 2px rgba(0,0,0,0.3),0 8px 24px rgba(0,0,0,0.35)']
    : ['#3d434f', '#ffffff', '0 1px 2px rgba(61,67,79,0.08),0 8px 24px rgba(61,67,79,0.12)'];
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText =
    'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;padding:8px 16px;' +
    `background:${ink};color:${onInk};font:600 13px/1.45 system-ui,sans-serif;border-radius:8px;` +
    `box-shadow:${shadow};pointer-events:none;`;
  document.documentElement.append(toast);
  setTimeout(() => toast.remove(), toastMs);
  return { ok: true };
}

/** Creates the page access for createCapturer() in a Chrome extension. A tab is a chrome.tabs.Tab. */
export function createChromePage({ chrome, sleep, now }) {
  let lastCapture = 0;
  return {
    async inject(tab) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content.js'] });
    },

    async call(tab, name, ...args) {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: callContent,
        args: [name, args],
      });
      return result;
    },

    async copy(tab, base64) {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: copyInPage,
        args: [base64, 'Copied to the clipboard.', COPIED_TOAST_MS],
      });
      return result;
    },

    async grab(tab) {
      const wait = lastCapture + CAPTURE_INTERVAL_MS - now();
      if (wait > 0) await sleep(wait);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      lastCapture = now();
      return dataUrl;
    },
  };
}
