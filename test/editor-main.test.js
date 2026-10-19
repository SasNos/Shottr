import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { FakeDocument, FakeElement, settle } from './helpers/fakes.js';

const doc = new FakeDocument();
const saved = {};

before(async () => {
  for (const name of ['document', 'chrome', 'location', 'Image', 'ClipboardItem']) saved[name] = globalThis[name];
  const job = {
    mode: 'viewport',
    url: 'https://example.com/',
    title: 'Example',
    viewportWidth: 100,
    tiles: [{ dataUrl: 'data:x', y: 0 }],
    crop: null,
    pageHeight: 0,
  };
  const swatch = new FakeElement('button');
  swatch.dataset.color = '#e5322d';
  doc.selectors['[data-color]'] = [swatch];
  doc.getElementById('format').value = 'png';
  globalThis.document = doc;
  globalThis.location = { search: '?job=main' };
  globalThis.chrome = {
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
  assert.equal(doc.getElementById('status').textContent, '100 × 50 px');
  await doc.getElementById('save').emit('click');
  assert.equal(doc.getElementById('status').textContent, 'Saved as PNG.');
});
