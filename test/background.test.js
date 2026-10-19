import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { settle } from './helpers/fakes.js';

const state = {};
let listener;

function reset() {
  Object.assign(state, {
    tabs: [{ id: 1, windowId: 2, url: 'https://example.com/', title: 'Example' }],
    selection: { x: 0, y: 0, width: 10, height: 10 },
    stored: {},
    created: [],
    badge: [],
    title: [],
    pageHeight: 600,
  });
}

before(async () => {
  reset();
  globalThis.__shottr = {
    measure: () => ({ viewportWidth: 800, viewportHeight: 600, pageHeight: state.pageHeight }),
    scrollTo: (y) => y,
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
    action: {
      setBadgeText: async ({ text }) => state.badge.push(text),
      setBadgeBackgroundColor: async () => {},
      setTitle: async ({ title }) => state.title.push(title),
    },
    tabs: {
      query: async () => state.tabs,
      create: async (options) => state.created.push(options.url),
      captureVisibleTab: async () => 'data:image/png;base64,AAAA',
    },
    storage: { local: { set: async (items) => Object.assign(state.stored, items) } },
    scripting: {
      executeScript: async (options) => (options.func ? [{ result: await options.func(...options.args) }] : [{}]),
    },
  };
  await import('../src/background.js');
});

after(() => {
  delete globalThis.chrome;
  delete globalThis.__shottr;
});

beforeEach(reset);

const send = async (message, sender = { id: 'self' }) => {
  listener(message, sender);
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
});

test('a full page capture of several tiles waits between the screenshots', async () => {
  state.pageHeight = 1200;
  listener({ type: 'capture', mode: 'full' }, { id: 'self' });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await settle();
  const [key] = Object.keys(state.stored);
  assert.equal(state.stored[key].tiles.length, 2);
});

test('a cancelled area selection opens no editor', async () => {
  state.selection = null;
  await send({ type: 'capture', mode: 'area' });
  assert.deepEqual(state.created, []);
  assert.deepEqual(state.stored, {});
  assert.deepEqual(state.badge, ['']);
});

test('a failing capture is reported on the toolbar button', async () => {
  state.tabs = [];
  await send({ type: 'capture', mode: 'full' });
  assert.deepEqual(state.created, []);
  assert.deepEqual(state.badge, ['!']);
  assert.match(state.title[0], /^Shottr: /);
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
