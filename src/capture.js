import { planScrollPositions } from './layout.js';

export const CAPTURE_INTERVAL_MS = 600;
export const MAX_PAGE_HEIGHT = 30000;

/** Runs inside the page: calls a function exposed by content.js. */
export function callContent(name, args) {
  return globalThis.__shottr[name](...args);
}

/**
 * Creates the capture orchestrator. `capture(tab, mode)` returns a capture job (see stitch.js) or null when the
 * user cancelled (Esc during the area selection or during a full page capture). Chrome allows only about two captureVisibleTab calls per second, so grabs
 * are spaced by CAPTURE_INTERVAL_MS.
 */
export function createCapturer({ chrome, sleep, now }) {
  let lastCapture = 0;

  const call = async (tabId, name, ...args) => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: callContent,
      args: [name, args],
    });
    return result;
  };

  const grab = async (windowId) => {
    const wait = lastCapture + CAPTURE_INTERVAL_MS - now();
    if (wait > 0) await sleep(wait);
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    lastCapture = now();
    return dataUrl;
  };

  const modes = {
    viewport: async (tab) => ({ tiles: [{ dataUrl: await grab(tab.windowId), y: 0 }], crop: null, pageHeight: 0 }),

    area: async (tab) => {
      const crop = await call(tab.id, 'selectArea');
      if (!crop) return null;
      return { tiles: [{ dataUrl: await grab(tab.windowId), y: 0 }], crop, pageHeight: 0 };
    },

    full: async (tab, metrics) => {
      const pageHeight = Math.min(metrics.pageHeight, MAX_PAGE_HEIGHT);
      const tiles = [];
      for (const position of planScrollPositions(pageHeight, metrics.viewportHeight)) {
        if (await call(tab.id, 'isCancelled')) return null;
        const y = await call(tab.id, 'scrollTo', position);
        tiles.push({ dataUrl: await grab(tab.windowId), y });
        await call(tab.id, 'hideFixed');
      }
      return { tiles, crop: null, pageHeight };
    },
  };

  return {
    async capture(tab, mode) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content.js'] });
      try {
        const metrics = await call(tab.id, 'measure');
        const result = await modes[mode](tab, metrics);
        if (!result) return null;
        return { mode, url: tab.url, title: tab.title, viewportWidth: metrics.viewportWidth, ...result };
      } finally {
        await call(tab.id, 'restore');
      }
    },
  };
}
