// Offscreen document: the service worker has no DOM, so the frame of a picked window is grabbed here.
import { grabFrame } from './window-frame.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'offscreen' || message.type !== 'grab-window')
    return false;
  grabFrame({
    navigator,
    document,
    streamId: message.streamId,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ratio: devicePixelRatio,
  }).then(sendResponse, (error) => sendResponse({ error: error.message }));
  return true;
});
