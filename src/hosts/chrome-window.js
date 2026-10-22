// Chrome host for "Selected area with DevTools": captureVisibleTab sees only the page, so the whole window
// (page, DevTools, browser UI) is taken through the desktop capture dialog and the area is selected on that image.
// Spark provides the same with its own window capture (docs/SPARK.md).
//
// Chrome opens the dialog from a service worker only for a target tab, and the stream it grants can then be used
// only in that tab. So the dialog is bound to the captured page and the frame is grabbed there by grabInPage.

/** Time for the picker dialog to disappear from the captured window before the frame is taken. */
export const SETTLE_MS = 300;

/**
 * Runs inside the page: grabs one frame of the window or screen the user picked and stops the stream.
 * Self-contained (no outer names), since chrome.scripting passes only the function's source. Resolves with
 * `{ dataUrl, width, height, ratio }` (a PNG in device pixels, the page's device pixel ratio) or `{ error }`,
 * because a rejection would not reach the service worker.
 */
export async function grabInPage(streamId, settleMs) {
  let stream;
  let answer;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: streamId } },
    });
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    answer = {
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
      ratio: devicePixelRatio,
    };
  } catch (error) {
    answer = { error: error.message };
  }
  if (stream) for (const track of stream.getTracks()) track.stop();
  return answer;
}

/** Creates the window capture for the service worker. `capture(tab)` returns a capture job or null when cancelled. */
export function createChromeWindowCapture({ chrome }) {
  // Resolves with the stream id, '' when the user cancelled; rejects when Chrome did not open the dialog.
  const choose = (tab) =>
    new Promise((resolve, reject) =>
      chrome.desktopCapture.chooseDesktopMedia(['window', 'screen'], tab, (streamId) => {
        if (typeof streamId === 'string') resolve(streamId);
        else reject(new Error(chrome.runtime.lastError?.message ?? 'The desktop capture dialog could not be opened.'));
      }),
    );

  const grab = async (tab, streamId) => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: grabInPage,
      args: [streamId, SETTLE_MS],
    });
    if (!result) throw new Error('the page did not answer');
    if (result.error) throw new Error(result.error);
    return result;
  };

  return {
    async capture(tab) {
      const streamId = await choose(tab);
      if (!streamId) return null;
      const frame = await grab(tab, streamId);
      // The page's device pixel ratio includes its zoom; the window picture does not.
      const ratio = frame.ratio / (await chrome.tabs.getZoom(tab.id));
      return {
        mode: 'window-area',
        url: tab.url,
        title: tab.title,
        viewportWidth: frame.width / ratio,
        tiles: [{ dataUrl: frame.dataUrl, y: 0 }],
        crop: null,
        pageHeight: 0,
        select: true,
      };
    },
  };
}
