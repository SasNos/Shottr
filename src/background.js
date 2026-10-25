import { createCapturer } from './capture.js';
import { jobToPngBase64 } from './clipboard.js';
import { createChromePage } from './hosts/chrome-page.js';
import { createChromeWindowCapture } from './hosts/chrome-window.js';
import { MODES, jobKey } from './job.js';

const page = createChromePage({
  chrome,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
});
const capturer = createCapturer({ page });

const windowCapture = createChromeWindowCapture({ chrome });

const report = (badge, title) =>
  Promise.all([
    chrome.action.setBadgeText({ text: badge }),
    chrome.action.setBadgeBackgroundColor({ color: '#c5221f' }),
    chrome.action.setTitle({ title }),
  ]);

async function openEditor(job, tab) {
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [jobKey(id)]: job });
  // Next to the captured tab, with that tab as opener, so closing the editor returns to the page.
  await chrome.tabs.create({
    url: `${chrome.runtime.getURL('src/editor.html')}?job=${id}`,
    index: tab.index + 1,
    openerTabId: tab.id,
  });
}

// Copy in the selection bar: the area goes straight to the clipboard of the page. If the page cannot (no clipboard
// API on http pages, no focus, a site policy), the editor opens with the job still marked `copy`, copies the area
// there (clipboardWrite) and closes again.
async function copyArea(job, tab) {
  const base64 = await jobToPngBase64(job, {
    loadImage: async (url) => createImageBitmap(await (await fetch(url)).blob()),
    createCanvas: (width, height) => new OffscreenCanvas(width, height),
  });
  const result = await page.copy(tab, base64);
  if (!result?.ok) await openEditor(job, tab);
}

async function handleCapture(mode) {
  try {
    if (mode === 'full') await report('…', 'Shottr: capturing. Press Esc on the page to cancel.');
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const job = mode === 'window-area' ? await windowCapture.capture(tab) : await capturer.capture(tab, mode);
    if (job?.copy) await copyArea(job, tab);
    else if (job) await openEditor(job, tab);
    await report('', 'Shottr');
  } catch (error) {
    await report('!', `Shottr: ${error.message}`);
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'capture' || !MODES.includes(message.mode)) return;
  handleCapture(message.mode);
});
