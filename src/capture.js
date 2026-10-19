import { planScrollPositions } from './layout.js';

export const MAX_PAGE_HEIGHT = 30000;

/**
 * Creates the capture orchestrator. `capture(tab, mode)` returns a capture job (see stitch.js) or null when the
 * user cancelled (Esc during the area selection or during a full page capture).
 *
 * `page` is the host's access to the page, so the same pipeline runs in the Chrome extension
 * (hosts/chrome-page.js) and in Spark:
 * - `inject(tab)` loads content.js into the page,
 * - `call(tab, name, ...args)` runs a function of content.js in the page and returns its result,
 * - `grab(tab)` returns the visible part of the page as a PNG data URL.
 */
export function createCapturer({ page }) {
  const modes = {
    viewport: async (tab) => ({ tiles: [{ dataUrl: await page.grab(tab), y: 0 }], crop: null, pageHeight: 0 }),

    area: async (tab) => {
      const crop = await page.call(tab, 'selectArea');
      if (!crop) return null;
      return { tiles: [{ dataUrl: await page.grab(tab), y: 0 }], crop, pageHeight: 0 };
    },

    full: async (tab, metrics) => {
      const pageHeight = Math.min(metrics.pageHeight, MAX_PAGE_HEIGHT);
      const tiles = [];
      for (const position of planScrollPositions(pageHeight, metrics.viewportHeight)) {
        if (await page.call(tab, 'isCancelled')) return null;
        const y = await page.call(tab, 'scrollTo', position);
        tiles.push({ dataUrl: await page.grab(tab), y });
        await page.call(tab, 'hideFixed');
      }
      return { tiles, crop: null, pageHeight };
    },
  };

  return {
    async capture(tab, mode) {
      await page.inject(tab);
      try {
        const metrics = await page.call(tab, 'measure');
        const result = await modes[mode](tab, metrics);
        if (!result) return null;
        return { mode, url: tab.url, title: tab.title, viewportWidth: metrics.viewportWidth, ...result };
      } finally {
        await page.call(tab, 'restore');
      }
    },
  };
}
