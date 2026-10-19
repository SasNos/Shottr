import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { FakeDocument, FakeElement } from './helpers/fakes.js';

const sent = [];
let closed = 0;
const buttons = ['full', 'area', 'viewport'].map((mode) => {
  const button = new FakeElement('button');
  button.dataset.mode = mode;
  return button;
});

before(async () => {
  const doc = new FakeDocument();
  doc.selectors['[data-mode]'] = buttons;
  globalThis.document = doc;
  globalThis.window = {
    close: () => (closed += 1),
    matchMedia: () => ({ matches: true, addEventListener: () => {} }),
  };
  globalThis.chrome = { runtime: { sendMessage: async (message) => sent.push(message) } };
  await import('../src/popup.js');
});

after(() => {
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.chrome;
});

test('the popup follows the system appearance', () => {
  assert.equal(globalThis.document.documentElement.dataset.theme, 'dark');
});

test('each button asks the background worker for its capture mode and closes the popup', async () => {
  for (const button of buttons) await button.emit('click');
  assert.deepEqual(sent, [
    { type: 'capture', mode: 'full' },
    { type: 'capture', mode: 'area' },
    { type: 'capture', mode: 'viewport' },
  ]);
  assert.equal(closed, 3);
});
