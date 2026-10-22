import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { FakeDocument } from './helpers/fakes.js';
import { SETTLE_MS, createChromeWindowCapture, grabInPage } from '../src/hosts/chrome-window.js';

const tab = { id: 7, url: 'https://example.com/', title: 'Example' };
const FRAME = { dataUrl: 'data:image/png;base64,W', width: 2000, height: 1200, ratio: 2 };

// An option given as undefined stays undefined (Chrome's answer when it refuses), so no default parameters here.
function setup(options = {}) {
  const { lastError, zoom = 1 } = options;
  const streamId = 'streamId' in options ? options.streamId : 'stream-1';
  const result = 'result' in options ? options.result : FRAME;
  const log = [];
  const chrome = {
    runtime: {},
    desktopCapture: {
      chooseDesktopMedia: (sources, target, callback) => {
        log.push(['choose', sources, target.id]);
        if (lastError) chrome.runtime.lastError = { message: lastError };
        callback(streamId);
        delete chrome.runtime.lastError;
      },
    },
    scripting: {
      executeScript: async (options) => {
        log.push(['grab', options.target.tabId, options.func, options.args]);
        return [{ result }];
      },
    },
    tabs: {
      getZoom: async (tabId) => {
        log.push(['zoom', tabId]);
        return zoom;
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
    ['choose', ['window', 'screen'], 7],
    ['grab', 7, grabInPage, ['stream-1', SETTLE_MS]],
    ['zoom', 7],
  ]);
});

test('the page zoom is taken out of the device pixel ratio of the page', async () => {
  const { capturer } = setup({ zoom: 1.25, result: { ...FRAME, ratio: 2.5 } });
  const job = await capturer.capture(tab);
  assert.equal(job.viewportWidth, 1000);
});

test('a cancelled picker returns null without touching the page', async () => {
  const { log, capturer } = setup({ streamId: '' });
  assert.equal(await capturer.capture(tab), null);
  assert.deepEqual(log, [['choose', ['window', 'screen'], 7]]);
});

test('a picker that Chrome refuses is reported instead of doing nothing', async () => {
  const { log, capturer } = setup({ streamId: undefined, lastError: 'A target tab is required.' });
  await assert.rejects(capturer.capture(tab), /A target tab is required/);
  assert.equal(log.length, 1);
});

test('a picker without an id and without a reason is reported too', async () => {
  const { capturer } = setup({ streamId: undefined });
  await assert.rejects(capturer.capture(tab), /desktop capture dialog could not be opened/);
});

test('an error of the grab in the page is thrown', async () => {
  const { capturer } = setup({ result: { error: 'Permission denied' } });
  await assert.rejects(capturer.capture(tab), /Permission denied/);
});

test('a page that does not answer the grab is reported', async () => {
  const { capturer } = setup({ result: undefined });
  await assert.rejects(capturer.capture(tab), /the page did not answer/);
});

// grabInPage runs inside the page, so it is tested against fake page globals.
describe('grabInPage', () => {
  const names = ['document', 'navigator', 'devicePixelRatio', 'setTimeout'];
  const saved = {};
  const state = {};

  before(() => {
    for (const name of names) saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    const doc = new FakeDocument();
    const realCreate = doc.createElement.bind(doc);
    doc.createElement = (tag) => {
      const element = realCreate(tag);
      if (tag === 'video') {
        element.videoWidth = 1600;
        element.videoHeight = 900;
        element.play = async () => {
          if (state.failPlay) throw new Error('no stream');
        };
      }
      if (tag === 'canvas') element.toDataURL = (type) => `data:${type};base64,FRAME`;
      return element;
    };
    state.doc = doc;
    const define = (name, value) =>
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    define('document', doc);
    define('navigator', {
      mediaDevices: {
        getUserMedia: async (constraints) => {
          state.requests.push(constraints);
          if (state.denied) throw new Error('denied');
          return { getTracks: () => [{ stop: () => state.stopped.push('video') }] };
        },
      },
    });
    define('devicePixelRatio', 2);
    define('setTimeout', (callback, ms) => {
      state.sleeps.push(ms);
      callback();
      return 0;
    });
  });

  after(() => {
    for (const name of names) {
      if (saved[name]) Object.defineProperty(globalThis, name, saved[name]);
      else delete globalThis[name];
    }
  });

  beforeEach(() => Object.assign(state, { requests: [], stopped: [], sleeps: [], failPlay: false, denied: false }));

  test('takes one frame of the picked window and stops the stream', async () => {
    const frame = await grabInPage('stream-1', 300);
    assert.deepEqual(frame, { dataUrl: 'data:image/png;base64,FRAME', width: 1600, height: 900, ratio: 2 });
    assert.deepEqual(state.requests, [
      { audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: 'stream-1' } } },
    ]);
    const [video, canvas] = state.doc.created.slice(-2);
    assert.equal(video.muted, true);
    assert.deepEqual(state.sleeps, [300], 'waits until the picker is gone from the window');
    assert.deepEqual(canvas.ctx.calls, [['drawImage', video, 0, 0]]);
    assert.deepEqual(state.stopped, ['video']);
  });

  test('stops the stream and answers with the error when the frame cannot be taken', async () => {
    state.failPlay = true;
    assert.deepEqual(await grabInPage('stream-1', 300), { error: 'no stream' });
    assert.deepEqual(state.stopped, ['video']);
  });

  test('answers with the error when the stream is refused', async () => {
    state.denied = true;
    assert.deepEqual(await grabInPage('stream-1', 300), { error: 'denied' });
    assert.deepEqual(state.stopped, []);
  });
});
