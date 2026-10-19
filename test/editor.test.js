import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { initEditor } from '../src/editor.js';
import { FakeDocument, FakeElement } from './helpers/fakes.js';

const NOW = new Date('2026-10-19T12:34:56.000Z');
const JOB = {
  mode: 'viewport',
  url: 'https://example.com/page',
  title: 'Example',
  viewportWidth: 100,
  tiles: [{ dataUrl: 'data:x', y: 0 }],
  crop: null,
  pageHeight: 0,
};

let doc;
let canvases;
let downloads;
let removed;
let swatches;

const el = (id) => doc.getElementById(id);
const overlay = () => canvases[1];
const lastCreated = (tag) => doc.created.findLast((element) => element.tagName === tag);
const strokeStyle = () => overlay().ctx.props.strokeStyle;
const names = (canvas) => canvas.ctx.calls.filter(([name]) => name !== 'set').map(([name]) => name);

async function start({ search = '?job=abc', job = JOB } = {}) {
  const urlApi = {
    createObjectURL: (blob) => {
      downloads.push(blob);
      return 'blob:test';
    },
    revokeObjectURL: () => {},
  };
  await initEditor({
    document: doc,
    chrome: {
      storage: {
        local: {
          get: async (key) => (job ? { [key]: job } : {}),
          remove: async (key) => removed.push(key),
        },
      },
    },
    location: { search },
    loadImage: async () => ({ width: 200, height: 100 }),
    createCanvas: (width, height) => {
      const canvas = new FakeElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.rect = { left: 10, top: 20, width: 100, height: 50 };
      canvases.push(canvas);
      return canvas;
    },
    urlApi,
    now: () => NOW,
  });
}

beforeEach(() => {
  doc = new FakeDocument();
  canvases = [];
  downloads = [];
  removed = [];
  swatches = ['#e5322d', '#1a73e8'].map((color) => {
    const swatch = new FakeElement('button');
    swatch.dataset.color = color;
    return swatch;
  });
  doc.selectors['[data-color]'] = swatches;
  el('format').value = 'png';
});

test('shows a hint when no capture id is given', async () => {
  await start({ search: '' });
  assert.match(el('status').textContent, /No capture found/);
  assert.equal(canvases.length, 0);
});

test('shows a hint when the capture is gone', async () => {
  await start({ job: null });
  assert.match(el('status').textContent, /No capture found/);
  assert.deepEqual(removed, ['job:abc']);
});

test('shows the capture and frees its storage', async () => {
  await start();
  assert.deepEqual(removed, ['job:abc']);
  assert.equal(doc.title, 'Shottr: Example');
  assert.equal(el('status').textContent, '200 × 100 px');
  assert.deepEqual(el('wrap').children, canvases);
  assert.equal(el('wrap').style.maxWidth, '100px');
  assert.equal(el('wrap').style.aspectRatio, '200 / 100');
  assert.equal(el('undo').disabled, true);
  assert.equal(el('redo').disabled, true);
  assert.equal(el('clear').disabled, true);
});

async function drawStroke(from = { clientX: 20, clientY: 30 }, to = { clientX: 60, clientY: 45 }) {
  await overlay().emit('pointerdown', from);
  await overlay().emit('pointermove', to);
  await overlay().emit('pointerup', to);
}

test('the pen draws strokes in image coordinates and they can be undone, redone and cleared', async () => {
  await start();
  await overlay().emit('pointermove', { clientX: 1, clientY: 1 });
  await overlay().emit('pointerup', {});
  assert.equal(el('undo').disabled, true);

  await drawStroke();
  assert.equal(overlay().captured, 1);
  const segments = overlay().ctx.calls.filter(([name]) => name === 'moveTo' || name === 'lineTo');
  assert.deepEqual(segments, [
    ['moveTo', 20, 20],
    ['lineTo', 20, 20],
    ['moveTo', 20, 20],
    ['lineTo', 100, 50],
  ]);
  assert.equal(el('undo').disabled, false);
  assert.equal(el('clear').disabled, false);

  await el('undo').emit('click');
  assert.equal(el('undo').disabled, true);
  assert.equal(el('redo').disabled, false);
  assert.equal(el('clear').disabled, false);
  await el('redo').emit('click');
  assert.equal(el('undo').disabled, false);
  await el('clear').emit('click');
  assert.equal(el('undo').disabled, true);
  assert.equal(el('clear').disabled, true);
  assert.ok(names(overlay()).includes('clearRect'));

  await overlay().emit('pointercancel', {});
  assert.equal(el('undo').disabled, true);
});

test('the pen uses the selected color and width', async () => {
  await start();
  await swatches[1].emit('click');
  assert.deepEqual(swatches.map((swatch) => swatch.attrs['aria-pressed']), ['false', 'true']);
  await drawStroke();
  assert.equal(strokeStyle(), '#1a73e8');
  assert.equal(overlay().ctx.props.lineWidth, 6);
});

test('the tool buttons show which tool is active', async () => {
  await start();
  await el('tool-comment').emit('click');
  assert.equal(el('tool-comment').attrs['aria-pressed'], 'true');
  assert.equal(el('tool-pen').attrs['aria-pressed'], 'false');
  await el('tool-pen').emit('click');
  assert.equal(el('tool-pen').attrs['aria-pressed'], 'true');
});

async function openComment(x = 60, y = 45) {
  await el('tool-comment').emit('click');
  await overlay().emit('pointerdown', { clientX: x, clientY: y });
  return lastCreated('textarea');
}

test('a comment is typed into a text box and committed with Enter', async () => {
  await start();
  const area = await openComment();
  assert.equal(area.style.left, '50%');
  assert.equal(area.style.top, '50%');
  assert.equal(area.style.fontSize, '16px');
  assert.equal(area.focused, true);
  assert.ok(el('wrap').children.includes(area));

  area.value = '  Fix this  ';
  await area.emit('keydown', { key: 'a' });
  await area.emit('keydown', { key: 'Enter', shiftKey: true });
  assert.equal(area.removed, false);
  await area.emit('keydown', { key: 'Enter' });
  assert.equal(area.removed, true);
  const text = overlay().ctx.calls.find(([name]) => name === 'fillText');
  assert.deepEqual(text.slice(0, 2), ['fillText', 'Fix this']);
  assert.equal(el('undo').disabled, false);

  await area.emit('blur');
  assert.equal(overlay().ctx.calls.filter(([name]) => name === 'fillText').length, 1);
});

test('Escape discards a comment', async () => {
  await start();
  const area = await openComment();
  area.value = 'never mind';
  await area.emit('keydown', { key: 'Escape' });
  assert.equal(area.removed, true);
  assert.equal(el('undo').disabled, true);
});

test('leaving the text box commits the comment, an empty one is dropped', async () => {
  await start();
  let area = await openComment();
  area.value = 'kept';
  await area.emit('blur');
  assert.equal(el('undo').disabled, false);

  area = await openComment();
  area.value = '   ';
  await area.emit('blur');
  assert.equal(overlay().ctx.calls.filter(([name]) => name === 'fillText').length, 1);
});

test('starting something else commits an open comment', async () => {
  await start();
  let area = await openComment();
  area.value = 'one';
  await overlay().emit('pointerdown', { clientX: 30, clientY: 30 });
  assert.equal(area.removed, true);
  const second = lastCreated('textarea');
  assert.notEqual(second, area);
  second.value = 'two';
  await el('tool-pen').emit('click');
  assert.equal(second.removed, true);

  area = await openComment();
  area.value = 'three';
  await el('undo').emit('click');
  assert.equal(area.removed, true);
  assert.equal(overlay().ctx.calls.filter(([name]) => name === 'fillText').length >= 3, true);
});

for (const [format, type, extension] of [
  ['png', 'image/png', 'png'],
  ['webp', 'image/webp', 'webp'],
  ['pdf', 'application/pdf', 'pdf'],
]) {
  test(`saving as ${format} downloads a ${type} file with the annotations`, async () => {
    await start();
    await drawStroke();
    const area = await openComment();
    area.value = 'note';
    el('format').value = format;
    await el('save').emit('click');
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].type, type);
    const link = lastCreated('a');
    assert.equal(link.download, `example.com-20261019-123456.${extension}`);
    assert.equal(link.clicks, 1);
    assert.equal(el('status').textContent, `Saved as ${format.toUpperCase()}.`);
    const flat = canvases.at(-1);
    assert.ok(names(flat).includes('fillText'), 'the pending comment is part of the export');
    assert.ok(names(flat).includes('stroke'));
  });
}

test('saving reports an error instead of throwing', async () => {
  await start();
  el('format').value = 'gif';
  await el('save').emit('click');
  assert.equal(el('status').textContent, 'Could not save: Unsupported format: gif');
  assert.equal(downloads.length, 0);
});
