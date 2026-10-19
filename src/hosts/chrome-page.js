// Chrome host for the capture pipeline: reaches the page through chrome.scripting and grabs it with
// chrome.tabs.captureVisibleTab. Spark provides the same three functions from Rust (docs/SPARK.md).

/** Chrome allows only about two captureVisibleTab calls per second, so grabs are spaced by this. */
export const CAPTURE_INTERVAL_MS = 600;

/** Runs inside the page: calls a function exposed by content.js. */
export function callContent(name, args) {
  return globalThis.__shottr[name](...args);
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

    async grab(tab) {
      const wait = lastCapture + CAPTURE_INTERVAL_MS - now();
      if (wait > 0) await sleep(wait);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      lastCapture = now();
      return dataUrl;
    },
  };
}
