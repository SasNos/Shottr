import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { FakeDocument, settle } from './helpers/fakes.js';

const doc = new FakeDocument();
const saved = {};
const closed = [];
const questions = [];

before(async () => {
  for (const name of ['document', 'chrome', 'location', 'Image', 'ClipboardItem', 'confirm', 'window', '__shottr'])
    saved[name] = globalThis[name];
  const job = {
    mode: 'viewport',
    url: 'https://example.com/',
    title: 'Example',
    viewportWidth: 100,
    tiles: [{ dataUrl: 'data:x', y: 0 }],
    crop: null,
    pageHeight: 0,
  };
  doc.getElementById('color-picker').value = '#e5322d';
  doc.getElementById('format').value = 'png';
  globalThis.confirm = (message) => questions.push(message) > 0;
  globalThis.document = doc;
  globalThis.__shottr = { selectArea: async () => null };
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener: () => {} }) };
  globalThis.location = { search: '?job=main' };
  globalThis.chrome = {
    tabs: { getCurrent: async () => ({ id: 7 }), remove: async (id) => closed.push(id) },
    storage: { local: { get: async (key) => ({ [key]: job }), remove: async () => {} } },
  };
  globalThis.Image = class {
    set src(_value) {
      this.width = 100;
      this.height = 50;
      queueMicrotask(() => this.onload());
    }
  };
  await import('../src/editor-main.js');
  await settle();
});

after(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete globalThis[name];
    else globalThis[name] = value;
  }
});

test('the editor page starts itself with the real browser APIs', async () => {
  assert.equal(doc.documentElement.dataset.theme, 'light');
  assert.equal(doc.getElementById('status').textContent, '100 × 50 px');
  await doc.getElementById('save').emit('click');
  assert.equal(doc.getElementById('status').textContent, 'Saved as PNG.');
});

test('cancelling after drawing asks the browser for confirmation and closes the tab', async () => {
  const overlay = doc.created[1];
  await overlay.emit('pointerdown', { clientX: 5, clientY: 5 });
  await overlay.emit('pointerup', { clientX: 5, clientY: 5 });
  await doc.getElementById('cancel').emit('click');
  assert.equal(questions.length, 1);
  assert.deepEqual(closed, [7]);
});
