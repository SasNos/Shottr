import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { FakeDocument } from './helpers/fakes.js';
import { COPIED_TOAST_MS, copyInPage, createChromePage } from '../src/hosts/chrome-page.js';

const saved = {};
let written;
let timers;
let behavior = {};

before(() => {
  for (const name of ['document', 'navigator', 'ClipboardItem', 'setTimeout']) saved[name] = globalThis[name];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        write: async (items) => {
          if (behavior.deny) throw new Error('Document is not focused.');
          written.push(items);
        },
      },
    },
  });
  globalThis.ClipboardItem = class {
    constructor(data) {
      this.data = data;
    }
  };
  globalThis.setTimeout = (callback, ms) => timers.push([callback, ms]);
});

after(() => {
  for (const [name, value] of Object.entries(saved)) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
});

const reset = () => {
  written = [];
  timers = [];
  behavior = {};
  globalThis.document = new FakeDocument();
};

test('copyInPage puts the PNG on the clipboard and shows a short note', async () => {
  reset();
  assert.deepEqual(await copyInPage('AQID', 'Copied.', 1600), { ok: true });
  const [[item]] = written;
  const blob = item.data['image/png'];
  assert.equal(blob.type, 'image/png');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3]);
  const [toast] = document.documentElement.children;
  assert.equal(toast.textContent, 'Copied.');
  assert.match(toast.style.cssText, /position:fixed/);
  assert.equal(timers[0][1], 1600);
  timers[0][0]();
  assert.equal(toast.removed, true);
});

test('copyInPage hands the PNG to the copy the selection started and waits for it', async () => {
  reset();
  let handed;
  globalThis.__shottr = {
    takeCopy: () => ({ resolve: (blob) => (handed = blob), written: Promise.resolve(null) }),
  };
  try {
    assert.deepEqual(await copyInPage('AQID', 'Copied.', 1600), { ok: true });
    assert.deepEqual(written, [], 'no second write without the user activation');
    assert.equal(handed.type, 'image/png');
    assert.equal(document.documentElement.children[0].textContent, 'Copied.');
  } finally {
    delete globalThis.__shottr;
  }
});

test('copyInPage reports a refused copy of the selection', async () => {
  reset();
  globalThis.__shottr = {
    takeCopy: () => ({ resolve: () => {}, written: Promise.resolve(new Error('Write permission denied.')) }),
  };
  try {
    assert.deepEqual(await copyInPage('AQID', 'Copied.', 1600), { error: 'Write permission denied.' });
    assert.equal(document.documentElement.children.length, 0);
  } finally {
    delete globalThis.__shottr;
  }
});

test('copyInPage reports a refused clipboard instead of throwing', async () => {
  reset();
  behavior.deny = true;
  assert.deepEqual(await copyInPage('AQID', 'Copied.', 1600), { error: 'Document is not focused.' });
  assert.equal(document.documentElement.children.length, 0);
});

test('the page host runs copyInPage in the tab', async () => {
  const calls = [];
  const chrome = {
    scripting: {
      executeScript: async (options) => {
        calls.push(options);
        return [{ result: { ok: true } }];
      },
    },
  };
  const page = createChromePage({ chrome, sleep: async () => {}, now: () => 0 });
  assert.deepEqual(await page.copy({ id: 7 }, 'AQID'), { ok: true });
  assert.deepEqual(calls[0].target, { tabId: 7 });
  assert.equal(calls[0].func, copyInPage);
  assert.deepEqual(calls[0].args, ['AQID', 'Copied to the clipboard.', COPIED_TOAST_MS]);
});
