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

test('Esc on the page marks the capture as cancelled until the next capture', () => {
  api.measure();
  assert.equal(api.isCancelled(), false);
  doc.listeners.keydown[0]({ key: 'a' });
  assert.equal(api.isCancelled(), false);
  doc.listeners.keydown[0]({ key: 'Escape' });
  assert.equal(api.isCancelled(), true);
  api.measure();
  assert.equal(api.isCancelled(), false);
  assert.equal(doc.listeners.keydown.length, 1);
  api.restore();
  assert.equal(doc.listeners.keydown.length, 0);
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

function open() {
  const pending = api.selectArea();
  const overlay = doc.documentElement.children.at(-1);
  const [box, hint, bar] = overlay.children;
  return {
    pending,
    overlay,
    box,
    hint,
    bar,
    handle: (name) => box.children.find((child) => child.dataset.handle === name),
    captureButton: bar.children[0],
    copyButton: bar.children[1],
    cancelButton: bar.children[2],
  };
}

const press = (ui, target, x, y) => ui.overlay.emit('pointerdown', { clientX: x, clientY: y, target });
const move = (ui, x, y) => ui.overlay.emit('pointermove', { clientX: x, clientY: y });
const release = (ui) => ui.overlay.emit('pointerup', {});

async function frame(ui, from = [100, 100], to = [300, 200]) {
  await press(ui, ui.overlay, ...from);
  await move(ui, ...to);
  await release(ui);
}

const boxRect = (ui) => ({
  x: parseFloat(ui.box.style.left),
  y: parseFloat(ui.box.style.top),
  width: parseFloat(ui.box.style.width),
  height: parseFloat(ui.box.style.height),
});

test('selectArea lets the user draw a frame and confirm it with Enter', async () => {
  const ui = open();
  assert.match(ui.hint.textContent, /^Drag to select/);
  assert.equal(ui.box.style.display, 'none');
  await press(ui, ui.overlay, 100, 100);
  assert.equal(ui.overlay.captured, 1);
  await move(ui, 300, 200);
  assert.equal(ui.box.style.display, 'block');
  assert.equal(ui.bar.style.display, 'none');
  await release(ui);
  assert.equal(ui.bar.style.display, 'flex');
  assert.match(ui.hint.textContent, /^Drag the handles/);
  assert.deepEqual(boxRect(ui), { x: 100, y: 100, width: 200, height: 100 });
  await doc.emit('keydown', { key: 'Enter' });
  assert.deepEqual(await ui.pending, { x: 100, y: 100, width: 200, height: 100 });
  assert.ok(ui.overlay.removed);
  assert.equal(doc.listeners.keydown.length, 0);
});

test('the Capture and Cancel buttons confirm and cancel', async () => {
  let ui = open();
  await frame(ui);
  await ui.captureButton.emit('click');
  assert.deepEqual(await ui.pending, { x: 100, y: 100, width: 200, height: 100 });

  ui = open();
  await frame(ui);
  await ui.cancelButton.emit('click');
  assert.equal(await ui.pending, null);
});

test('Copy sits between Capture and Cancel and returns the area marked for the clipboard', async () => {
  let ui = open();
  await frame(ui);
  assert.deepEqual(
    ui.bar.children.map((button) => button.textContent),
    ['Capture', 'Copy', 'Cancel'],
  );
  await ui.copyButton.emit('click');
  assert.deepEqual(await ui.pending, { x: 100, y: 100, width: 200, height: 100, copy: true });

  for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
    ui = open();
    await frame(ui);
    await doc.emit('keydown', { key: 'C', ...modifier });
    assert.deepEqual(await ui.pending, { x: 100, y: 100, width: 200, height: 100, copy: true });
  }
});

test('C without Ctrl or Cmd does not copy', async () => {
  const ui = open();
  await frame(ui);
  await doc.emit('keydown', { key: 'c' });
  assert.equal(ui.overlay.removed, false);
  await ui.cancelButton.emit('click');
  assert.equal(await ui.pending, null);
});

test('a double click inside the frame confirms it', async () => {
  const ui = open();
  await frame(ui);
  await ui.box.emit('dblclick');
  assert.deepEqual(await ui.pending, { x: 100, y: 100, width: 200, height: 100 });
});

const RESIZES = {
  n: { x: 100, y: 120, width: 200, height: 80 },
  s: { x: 100, y: 100, width: 200, height: 120 },
  e: { x: 100, y: 100, width: 210, height: 100 },
  w: { x: 110, y: 100, width: 190, height: 100 },
  ne: { x: 100, y: 120, width: 210, height: 80 },
  nw: { x: 110, y: 120, width: 190, height: 80 },
  se: { x: 100, y: 100, width: 210, height: 120 },
  sw: { x: 110, y: 100, width: 190, height: 120 },
};

for (const [name, expected] of Object.entries(RESIZES)) {
  test(`the ${name} handle resizes the frame`, async () => {
    const ui = open();
    await frame(ui);
    assert.equal(ui.box.children.length, 8);
    await press(ui, ui.handle(name), 200, 150);
    await move(ui, 210, 170);
    assert.equal(ui.bar.style.display, 'none');
    await release(ui);
    assert.deepEqual(boxRect(ui), expected);
    await doc.emit('keydown', { key: 'Enter' });
    assert.deepEqual(await ui.pending, expected);
  });
}

test('resizing past the opposite edge flips the frame and stays inside the viewport', async () => {
  let ui = open();
  await frame(ui);
  await press(ui, ui.handle('e'), 300, 150);
  await move(ui, 0, 150);
  await release(ui);
  assert.deepEqual(boxRect(ui), { x: 0, y: 100, width: 100, height: 100 });
  await doc.emit('keydown', { key: 'Escape' });
  await ui.pending;

  ui = open();
  await frame(ui);
  await press(ui, ui.handle('e'), 300, 150);
  await move(ui, 5000, 150);
  assert.deepEqual(boxRect(ui), { x: 100, y: 100, width: 900, height: 100 });
  await doc.emit('keydown', { key: 'Escape' });
  await ui.pending;
});

test('dragging inside the frame moves it and keeps it inside the viewport', async () => {
  const ui = open();
  await frame(ui);
  await press(ui, ui.box, 200, 150);
  await move(ui, 250, 180);
  assert.deepEqual(boxRect(ui), { x: 150, y: 130, width: 200, height: 100 });
  await move(ui, -5000, -5000);
  assert.deepEqual(boxRect(ui), { x: 0, y: 0, width: 200, height: 100 });
  await move(ui, 5000, 5000);
  assert.deepEqual(boxRect(ui), { x: 800, y: 600, width: 200, height: 100 });
  await release(ui);
  await doc.emit('keydown', { key: 'Escape' });
  await ui.pending;
});

test('pressing outside the frame starts a new one', async () => {
  const ui = open();
  await frame(ui);
  await frame(ui, [400, 400], [500, 450]);
  await doc.emit('keydown', { key: 'Enter' });
  assert.deepEqual(await ui.pending, { x: 400, y: 400, width: 100, height: 50 });
});

test('a tiny frame is dropped and cannot be confirmed', async () => {
  const ui = open();
  await frame(ui, [10, 10], [12, 40]);
  assert.equal(ui.box.style.display, 'none');
  await doc.emit('keydown', { key: 'Enter' });
  assert.equal(ui.overlay.removed, false);
  await press(ui, ui.overlay, 20, 20);
  await release(ui);
  assert.equal(ui.box.style.display, 'none');
  await doc.emit('keydown', { key: 'Escape' });
  assert.equal(await ui.pending, null);
});

test('a frame that is resized to almost nothing cannot be confirmed', async () => {
  const ui = open();
  await frame(ui);
  await press(ui, ui.handle('e'), 300, 150);
  await move(ui, 102, 150);
  await release(ui);
  await ui.captureButton.emit('click');
  assert.equal(ui.overlay.removed, false);
  await ui.cancelButton.emit('click');
  assert.equal(await ui.pending, null);
});

test('moves and releases without a press are ignored', async () => {
  const ui = open();
  await move(ui, 50, 50);
  await release(ui);
  assert.equal(ui.box.style.display, 'none');
  await doc.emit('keydown', { key: 'Escape' });
  assert.equal(await ui.pending, null);
});

test('Escape and Enter are swallowed, other keys are left alone', async () => {
  const ui = open();
  const flags = [];
  const event = (key) => ({
    key,
    preventDefault: () => flags.push(`prevent:${key}`),
    stopPropagation: () => flags.push(`stop:${key}`),
  });
  await doc.emit('keydown', event('a'));
  await doc.emit('keydown', event('Enter'));
  await doc.emit('keydown', event('Escape'));
  assert.deepEqual(flags, ['prevent:Enter', 'stop:Enter', 'prevent:Escape', 'stop:Escape']);
  assert.equal(await ui.pending, null);
});

test('pressing a button of the toolbar does not start a new frame', async () => {
  const ui = open();
  let stopped = false;
  await ui.bar.emit('pointerdown', { stopPropagation: () => (stopped = true) });
  assert.equal(stopped, true);
  await doc.emit('keydown', { key: 'Escape' });
  await ui.pending;
});

test('the Capture bar stays inside the viewport and pointer positions are clamped', async () => {
  const ui = open();
  await frame(ui, [950, 650], [990, 690]);
  assert.equal(ui.bar.style.left, '760px');
  assert.equal(ui.bar.style.top, '660px');
  await press(ui, ui.box, 970, 670);
  await move(ui, -50, -50);
  assert.deepEqual(boxRect(ui), { x: 0, y: 0, width: 40, height: 40 });
  await release(ui);
  await doc.emit('keydown', { key: 'Escape' });
  await ui.pending;
});
