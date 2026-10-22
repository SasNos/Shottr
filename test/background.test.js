import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { settle } from './helpers/fakes.js';

const state = {};
let listener;

function reset() {
  Object.assign(state, {
    tabs: [{ id: 1, windowId: 2, index: 4, url: 'https://example.com/', title: 'Example' }],
    selection: { x: 0, y: 0, width: 10, height: 10 },
    stored: {},
    created: [],
    createOptions: [],
    badge: [],
    title: [],
    pageHeight: 600,
    cancelled: false,
    streamId: 'stream-1',
    copied: [],
    copyResult: { ok: true },
  });
}

before(async () => {
  reset();
  globalThis.__shottr = {
    measure: () => ({ viewportWidth: 800, viewportHeight: 600, pageHeight: state.pageHeight }),
    scrollTo: (y) => y,
    isCancelled: () => state.cancelled,
    hideFixed: () => {},
    restore: () => {},
    selectArea: () => state.selection,
  };
  globalThis.chrome = {
    runtime: {
      id: 'self',
      getURL: (path) => `chrome-extension://self/${path}`,
      onMessage: { addListener: (fn) => (listener = fn) },
    },
    desktopCapture: { chooseDesktopMedia: (sources, tab, callback) => callback(state.streamId) },
    action: {
      setBadgeText: async ({ text }) => state.badge.push(text),
      setBadgeBackgroundColor: async () => {},
      setTitle: async ({ title }) => state.title.push(title),
    },
    tabs: {
      query: async () => state.tabs,
      create: async (options) => {
        state.created.push(options.url);
        state.createOptions.push(options);
      },
      captureVisibleTab: async () => 'data:image/png;base64,AAAA',
      getZoom: async () => 1,
    },
    storage: { local: { set: async (items) => Object.assign(state.stored, items) } },
    scripting: {
      executeScript: async (options) => {
        if (options.func?.name === 'copyInPage') {
          state.copied.push(options.args[0]);
          return [{ result: state.copyResult }];
        }
        if (options.func?.name === 'grabInPage')
          return [{ result: { dataUrl: 'data:image/png;base64,WIN', width: 1600, height: 1000, ratio: 1 } }];
        return options.func ? [{ result: await options.func(...options.args) }] : [{}];
      },
    },
  };
  globalThis.createImageBitmap = async () => ({ width: 1600, height: 1200 });
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }

    getContext() {
      return { drawImage: () => {} };
    }

    async convertToBlob() {
      return new Blob([new Uint8Array([1, 2, 3])]);
    }
  };
  await import('../src/background.js');
});

after(() => {
  delete globalThis.chrome;
  delete globalThis.__shottr;
  delete globalThis.createImageBitmap;
  delete globalThis.OffscreenCanvas;
});

beforeEach(reset);

const send = async (message, sender = { id: 'self' }) => {
  listener(message, sender);
  await settle();
};

// Screenshots are spaced by CAPTURE_INTERVAL_MS, so a capture right after another one waits that long.
const sendAfterInterval = async (message) => {
  listener(message, { id: 'self' });
  await new Promise((resolve) => setTimeout(resolve, 700));
  await settle();
};

test('a capture request stores the job and opens the editor', async () => {
  await send({ type: 'capture', mode: 'viewport' });
  const [key] = Object.keys(state.stored);
  assert.match(key, /^job:[0-9a-f-]{36}$/);
  assert.equal(state.stored[key].mode, 'viewport');
  assert.deepEqual(state.created, [`chrome-extension://self/src/editor.html?job=${key.slice(4)}`]);
  assert.deepEqual(state.badge, ['']);
  assert.deepEqual(state.title, ['Shottr']);
  assert.equal(state.createOptions[0].index, 5, 'opens right next to the captured tab');
  assert.equal(state.createOptions[0].openerTabId, 1, 'closing the editor returns to the captured tab');
});

test('a full page capture of several tiles waits between the screenshots', async () => {
  state.pageHeight = 1200;
  listener({ type: 'capture', mode: 'full' }, { id: 'self' });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await settle();
  const [key] = Object.keys(state.stored);
  assert.equal(state.stored[key].tiles.length, 2);
});

test('Esc during a full page capture opens no editor and resets the button', async () => {
  state.cancelled = true;
  await send({ type: 'capture', mode: 'full' });
  assert.deepEqual(state.created, []);
  assert.deepEqual(state.badge, ['…', '']);
  assert.match(state.title[0], /Esc/);
  assert.equal(state.title[1], 'Shottr');
});

test('a cancelled area selection opens no editor', async () => {
  state.selection = null;
  await send({ type: 'capture', mode: 'area' });
  assert.deepEqual(state.created, []);
  assert.deepEqual(state.stored, {});
  assert.deepEqual(state.badge, ['']);
});

test('an area with DevTools takes the picked window and lets the editor select the area', async () => {
  await send({ type: 'capture', mode: 'window-area' });
  const [job] = Object.values(state.stored);
  assert.equal(job.mode, 'window-area');
  assert.equal(job.select, true);
  assert.deepEqual(job.tiles, [{ dataUrl: 'data:image/png;base64,WIN', y: 0 }]);
  assert.equal(state.created.length, 1);
});

test('a cancelled window picker opens no editor', async () => {
  state.streamId = '';
  await send({ type: 'capture', mode: 'window-area' });
  assert.deepEqual(state.created, []);
  assert.deepEqual(state.badge, ['']);
});

test('a window picker that Chrome refuses is reported on the toolbar button', async () => {
  state.streamId = undefined;
  await send({ type: 'capture', mode: 'window-area' });
  assert.deepEqual(state.created, []);
  assert.deepEqual(state.badge, ['!']);
  assert.match(state.title[0], /desktop capture dialog could not be opened/);
});

test('Copy in the selection bar copies the area on the page and opens no editor', async () => {
  state.selection = { x: 0, y: 0, width: 10, height: 10, copy: true };
  await sendAfterInterval({ type: 'capture', mode: 'area' });
  assert.deepEqual(state.copied, ['AQID']);
  assert.deepEqual(state.created, []);
  assert.deepEqual(state.stored, {});
  assert.deepEqual(state.badge, ['']);
});

test('when the page refuses the copy, the editor opens with the reason', async () => {
  state.selection = { x: 0, y: 0, width: 10, height: 10, copy: true };
  state.copyResult = { error: 'Document is not focused.' };
  await sendAfterInterval({ type: 'capture', mode: 'area' });
  const [job] = Object.values(state.stored);
  assert.equal(job.copy, false);
  assert.equal(job.notice, 'Could not copy on the page (Document is not focused). Use Copy here.');
  assert.equal(state.created.length, 1);
});

test('when the page does not answer the copy, the editor opens', async () => {
  state.selection = { x: 0, y: 0, width: 10, height: 10, copy: true };
  state.copyResult = undefined;
  await sendAfterInterval({ type: 'capture', mode: 'area' });
  const [job] = Object.values(state.stored);
  assert.match(job.notice, /the page did not answer/);
});

test('a failing capture is reported on the toolbar button', async () => {
  state.tabs = [];
  await send({ type: 'capture', mode: 'full' });
  assert.deepEqual(state.created, []);
  assert.deepEqual(state.badge, ['…', '!']);
  assert.match(state.title[1], /^Shottr: /);
});

test('requests from other senders are ignored', async () => {
  await send({ type: 'capture', mode: 'viewport' }, { id: 'someone-else' });
  await send({ type: 'capture', mode: 'viewport' }, {});
  assert.deepEqual(state.created, []);
  assert.deepEqual(state.badge, []);
});

test('malformed requests are ignored', async () => {
  await send(null);
  await send({ type: 'other', mode: 'viewport' });
  await send({ type: 'capture', mode: 'everything' });
  await send({ type: 'capture' });
  assert.deepEqual(state.created, []);
  assert.deepEqual(state.badge, []);
});
