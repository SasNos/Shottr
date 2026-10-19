import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OFFSCREEN_URL, createChromeWindowCapture } from '../src/hosts/chrome-window.js';

const tab = { id: 7, url: 'https://example.com/', title: 'Example' };

function setup({ streamId = 'stream-1', frame, hasDocument = false } = {}) {
  const log = [];
  const chrome = {
    desktopCapture: {
      chooseDesktopMedia: (sources, callback) => {
        log.push(['choose', sources]);
        callback(streamId);
      },
    },
    offscreen: {
      hasDocument: async () => hasDocument,
      createDocument: async (options) => log.push(['create', options.url, options.reasons]),
      closeDocument: async () => log.push(['close']),
    },
    runtime: {
      sendMessage: async (message) => {
        log.push(['send', message]);
        return frame ?? { dataUrl: 'data:image/png;base64,W', width: 2000, height: 1200, ratio: 2 };
      },
    },
  };
  return { log, capturer: createChromeWindowCapture({ chrome }) };
}

test('the picked window becomes a job whose area is selected in the editor', async () => {
  const { log, capturer } = setup();
  const job = await capturer.capture(tab);
  assert.deepEqual(job, {
    mode: 'window-area',
    url: tab.url,
    title: tab.title,
    viewportWidth: 1000,
    tiles: [{ dataUrl: 'data:image/png;base64,W', y: 0 }],
    crop: null,
    pageHeight: 0,
    select: true,
  });
  assert.deepEqual(log, [
    ['choose', ['window', 'screen']],
    ['create', OFFSCREEN_URL, ['USER_MEDIA']],
    ['send', { target: 'offscreen', type: 'grab-window', streamId: 'stream-1' }],
    ['close'],
  ]);
});

test('an existing offscreen document is reused', async () => {
  const { log, capturer } = setup({ hasDocument: true });
  await capturer.capture(tab);
  assert.equal(
    log.some(([name]) => name === 'create'),
    false,
  );
});

test('a cancelled picker returns null without an offscreen document', async () => {
  const { log, capturer } = setup({ streamId: '' });
  assert.equal(await capturer.capture(tab), null);
  assert.deepEqual(log, [['choose', ['window', 'screen']]]);
});

test('an error of the offscreen document is thrown after it is closed', async () => {
  const { log, capturer } = setup({ frame: { error: 'Permission denied' } });
  await assert.rejects(capturer.capture(tab), /Permission denied/);
  assert.deepEqual(log.at(-1), ['close']);
});
