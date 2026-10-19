// Chrome host for "Selected area with DevTools": captureVisibleTab sees only the page, so the whole window
// (page, DevTools, browser UI) is taken through the desktop capture dialog and the area is selected on that image.
// Spark provides the same with its own window capture (docs/SPARK.md).

export const OFFSCREEN_URL = 'src/offscreen.html';

/** Creates the window capture for the service worker. `capture(tab)` returns a capture job or null when cancelled. */
export function createChromeWindowCapture({ chrome }) {
  const choose = () =>
    new Promise((resolve) =>
      chrome.desktopCapture.chooseDesktopMedia(['window', 'screen'], (streamId) => resolve(streamId)),
    );

  const grab = async (streamId) => {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ['USER_MEDIA'],
        justification: 'Grab one frame of the window the user picked, to select an area including the DevTools.',
      });
    }
    try {
      return await chrome.runtime.sendMessage({ target: 'offscreen', type: 'grab-window', streamId });
    } finally {
      await chrome.offscreen.closeDocument();
    }
  };

  return {
    async capture(tab) {
      const streamId = await choose();
      if (!streamId) return null;
      const frame = await grab(streamId);
      if (frame.error) throw new Error(frame.error);
      return {
        mode: 'window-area',
        url: tab.url,
        title: tab.title,
        viewportWidth: frame.width / frame.ratio,
        tiles: [{ dataUrl: frame.dataUrl, y: 0 }],
        crop: null,
        pageHeight: 0,
        select: true,
      };
    },
  };
}
