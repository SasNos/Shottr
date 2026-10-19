import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { FakeDocument, FakeElement } from './helpers/fakes.js';

const saved = {};
const scrolls = [];
let doc;
let api;

before(async () => {
  for (const name of ['window', 'document', 'getComputedStyle', 'setTimeout']) saved[name] = globalThis[name];
  globalThis.setTimeout = (callback) => {
    callback();
    return 0;
  };
  globalThis.getComputedStyle = (element) => ({ position: element.position });
  await import('../src/content.js');
  api = globalThis.__shottr;
});

after(() => {
  for (const [name, value] of Object.entries(saved)) globalThis[name] = value;
  delete globalThis.__shottr;
});

beforeEach(() => {
  scrolls.length = 0;
  doc = new FakeDocument();
  doc.documentElement.scrollHeight = 1200;
  doc.body.scrollHeight = 900;
  globalThis.document = doc;
  globalThis.window = {
    scrollX: 4,
    scrollY: 30,
    innerWidth: 1000,
    innerHeight: 700,
    scrollTo: (x, y) => scrolls.push([x, y]),
  };
});

test('measure reports the viewport and the page height', () => {
  assert.deepEqual(api.measure(), { viewportWidth: 1000, viewportHeight: 700, pageHeight: 1200 });
});

test('scrollTo scrolls and reports the position that was reached', async () => {
  window.scrollY = 55;
  assert.equal(await api.scrollTo(60), 55);
  assert.deepEqual(scrolls, [[0, 60]]);
});

test('hideFixed hides fixed and sticky elements once, restore brings everything back', () => {
  const fixed = new FakeElement();
  fixed.position = 'fixed';
  const sticky = new FakeElement();
  sticky.position = 'sticky';
  sticky.style.setProperty('visibility', 'collapse', 'important');
  const normal = new FakeElement();
  doc.selectors['*'] = [fixed, sticky, normal];

  api.measure();
  api.hideFixed();
  api.hideFixed();
  assert.equal(fixed.style.getPropertyValue('visibility'), 'hidden');
  assert.equal(fixed.style.getPropertyPriority('visibility'), 'important');
  assert.equal(sticky.style.getPropertyValue('visibility'), 'hidden');
  assert.equal(normal.style.getPropertyValue('visibility'), '');

  api.restore();
  assert.equal(fixed.style.getPropertyValue('visibility'), '');
  assert.equal(sticky.style.getPropertyValue('visibility'), 'collapse');
  assert.equal(sticky.style.getPropertyPriority('visibility'), 'important');
  assert.deepEqual(scrolls, [[4, 30]]);

  scrolls.length = 0;
  api.restore();
  assert.equal(fixed.style.getPropertyValue('visibility'), '');
});

const overlayOf = () => doc.created.at(-3);
const boxOf = () => doc.created.at(-2);

test('selectArea resolves with the dragged rectangle', async () => {
  const pending = api.selectArea();
  const overlay = overlayOf();
  assert.ok(doc.documentElement.children.includes(overlay));
  await overlay.emit('pointerdown', { clientX: 50, clientY: 80 });
  assert.equal(overlay.captured, 1);
  await overlay.emit('pointermove', { clientX: 20, clientY: 100 });
  assert.equal(boxOf().style.display, 'block');
  assert.equal(boxOf().style.left, '20px');
  assert.equal(boxOf().style.height, '20px');
  await overlay.emit('pointerup', { clientX: 20, clientY: 100 });
  assert.deepEqual(await pending, { x: 20, y: 80, width: 30, height: 20 });
  assert.ok(overlay.removed);
});

test('selectArea ignores moves and releases without a press', async () => {
  const pending = api.selectArea();
  const overlay = overlayOf();
  await overlay.emit('pointermove', { clientX: 5, clientY: 5 });
  await overlay.emit('pointerup', { clientX: 5, clientY: 5 });
  assert.equal(boxOf().style.display, undefined);
  await doc.emit('keydown', { key: 'Escape' });
  assert.equal(await pending, null);
});

test('selectArea cancels on a tiny selection', async () => {
  const pending = api.selectArea();
  const overlay = overlayOf();
  await overlay.emit('pointerdown', { clientX: 10, clientY: 10 });
  await overlay.emit('pointerup', { clientX: 12, clientY: 40 });
  assert.equal(await pending, null);
});

test('selectArea ignores other keys and cancels on Escape', async () => {
  const pending = api.selectArea();
  await doc.emit('keydown', { key: 'a' });
  assert.equal(overlayOf().removed, false);
  await doc.emit('keydown', { key: 'Escape' });
  assert.equal(await pending, null);
  assert.equal(doc.listeners.keydown.length, 0);
});
