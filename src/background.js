import { createCapturer } from './capture.js';
import { MODES, jobKey } from './job.js';

const capturer = createCapturer({
  chrome,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
});

const report = (badge, title) =>
  Promise.all([
    chrome.action.setBadgeText({ text: badge }),
    chrome.action.setBadgeBackgroundColor({ color: '#c5221f' }),
    chrome.action.setTitle({ title }),
  ]);

async function openEditor(job) {
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [jobKey(id)]: job });
  await chrome.tabs.create({ url: `${chrome.runtime.getURL('src/editor.html')}?job=${id}` });
}

async function handleCapture(mode) {
  try {
    if (mode === 'full') await report('…', 'Shottr: capturing. Press Esc on the page to cancel.');
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const job = await capturer.capture(tab, mode);
    if (job) await openEditor(job);
    await report('', 'Shottr');
  } catch (error) {
    await report('!', `Shottr: ${error.message}`);
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'capture' || !MODES.includes(message.mode)) return;
  handleCapture(message.mode);
});
