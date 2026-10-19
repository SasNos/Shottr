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

class FakeFile {
  constructor(parts, name, options) {
    this.parts = parts;
    this.name = name;
    this.type = options.type;
  }
}

class FakeClipboardItem {
  constructor(data) {
    this.data = data;
  }
}

let doc;
let canvases;
let downloads;
let removed;
let closed;
let asked;
let shared;
let clipboard;
let behavior;

const el = (id) => doc.getElementById(id);
const overlay = () => canvases[1];
const lastCreated = (tag) => doc.created.findLast((element) => element.tagName === tag);
const names = (canvas) => canvas.ctx.calls.filter(([name]) => name !== 'set').map(([name]) => name);
const count = (canvas, name) => canvas.ctx.calls.filter(([call]) => call === name).length;
const lastCall = (canvas, name) => canvas.ctx.calls.findLast(([call]) => call === name);

async function start({ search = '?job=abc', job = JOB, shareable = true } = {}) {
  const navigator = shareable
    ? {
        share: async (data) => {
          if (behavior.share) throw behavior.share;
          shared.push(data);
        },
        canShare: () => true,
        clipboard: {
          write: async (items) => {
            if (behavior.clipboard) throw behavior.clipboard;
            clipboard.push(items);
          },
        },
      }
    : { clipboard: { write: async () => {} } };
  await initEditor({
    document: doc,
    chrome: {
      tabs: { getCurrent: async () => ({ id: 42 }), remove: async (id) => closed.push(id) },
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
    urlApi: {
      createObjectURL: (blob) => {
        downloads.push(blob);
        return 'blob:test';
      },
      revokeObjectURL: () => {},
    },
    now: () => NOW,
    navigator,
    FileClass: FakeFile,
    ClipboardItemClass: FakeClipboardItem,
    confirmDiscard: (message) => {
      asked.push(message);
      return behavior.keep !== true;
    },
  });
}

beforeEach(() => {
  doc = new FakeDocument();
  canvases = [];
  downloads = [];
  removed = [];
  shared = [];
  clipboard = [];
  behavior = {};
  closed = [];
  asked = [];
  el('color-picker').value = '#e5322d';
  el('format').value = 'png';
  el('stroke-width').value = '3';
  el('font-size').value = '16';
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

test('the share button is only shown when the browser can share files', async () => {
  await start();
  assert.equal(el('share').hidden, false);
  doc = new FakeDocument();
  await start({ shareable: false });
  assert.equal(el('share').hidden, true);
});

async function drag(from = { clientX: 20, clientY: 30 }, to = { clientX: 60, clientY: 45 }) {
  await overlay().emit('pointerdown', from);
  await overlay().emit('pointermove', to);
  await overlay().emit('pointerup', to);
}

test('the pen draws strokes in image coordinates and they can be undone, redone and cleared', async () => {
  await start();
  await overlay().emit('pointermove', { clientX: 1, clientY: 1 });
  await overlay().emit('pointerup', {});
  assert.equal(el('undo').disabled, true);

  await drag();
  assert.equal(overlay().captured, 1);
  const segments = overlay().ctx.calls.filter(([name]) => name === 'moveTo' || name === 'lineTo');
  assert.deepEqual(segments.slice(0, 4), [
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
  assert.ok(count(overlay(), 'clearRect') >= 3);

  await overlay().emit('pointercancel', {});
  assert.equal(el('undo').disabled, true);
});

test('the stroke width slider sets the pen width in page pixels', async () => {
  await start();
  el('stroke-width').value = '5';
  await el('stroke-width').emit('input');
  assert.equal(el('stroke-width-value').textContent, '5 px');
  await drag();
  assert.equal(overlay().ctx.props.lineWidth, 10);
});

test('the color picker sets the drawing color', async () => {
  await start();
  await drag();
  assert.equal(overlay().ctx.props.strokeStyle, '#e5322d');

  el('color-picker').value = '#abcdef';
  await el('color-picker').emit('input');
  await drag();
  assert.equal(overlay().ctx.props.strokeStyle, '#abcdef');
});

test('the tool buttons show which tool is active', async () => {
  await start();
  const pressed = () => ['pen', 'rect', 'ellipse', 'comment'].map((name) => el(`tool-${name}`).attrs['aria-pressed']);
  await el('tool-comment').emit('click');
  assert.deepEqual(pressed(), ['false', 'false', 'false', 'true']);
  await el('tool-ellipse').emit('click');
  assert.deepEqual(pressed(), ['false', 'false', 'true', 'false']);
  await el('tool-rect').emit('click');
  assert.deepEqual(pressed(), ['false', 'true', 'false', 'false']);
  await el('tool-pen').emit('click');
  assert.deepEqual(pressed(), ['true', 'false', 'false', 'false']);
});

test('dragging with the rectangle tool shows a preview and adds a hollow rectangle', async () => {
  await start();
  el('stroke-width').value = '2';
  el('color-picker').value = '#1a73e8';
  await el('color-picker').emit('input');
  await el('tool-rect').emit('click');
  await overlay().emit('pointerdown', { clientX: 20, clientY: 30 });
  await overlay().emit('pointermove', { clientX: 60, clientY: 45 });
  assert.deepEqual(lastCall(overlay(), 'strokeRect'), ['strokeRect', 20, 20, 80, 30]);
  assert.equal(el('undo').disabled, true);
  await overlay().emit('pointerup', { clientX: 60, clientY: 45 });
  assert.equal(el('undo').disabled, false);
  assert.equal(overlay().ctx.props.strokeStyle, '#1a73e8');
  assert.equal(overlay().ctx.props.lineWidth, 4);
  assert.equal(count(overlay(), 'fillRect'), 0);
});

test('dragging with the ellipse tool adds a hollow ellipse', async () => {
  await start();
  await el('tool-ellipse').emit('click');
  await drag();
  assert.deepEqual(lastCall(overlay(), 'ellipse'), ['ellipse', 60, 35, 40, 15, 0, 0, Math.PI * 2]);
  assert.equal(el('undo').disabled, false);
});

test('a shape without size is not added', async () => {
  await start();
  await el('tool-rect').emit('click');
  await overlay().emit('pointerdown', { clientX: 20, clientY: 30 });
  await overlay().emit('pointerup', { clientX: 20, clientY: 30 });
  assert.equal(el('undo').disabled, true);
  await overlay().emit('pointerdown', { clientX: 20, clientY: 30 });
  await overlay().emit('pointermove', { clientX: 20, clientY: 40 });
  await overlay().emit('pointerup', { clientX: 20, clientY: 40 });
  assert.equal(el('undo').disabled, false);
  await el('undo').emit('click');
  await overlay().emit('pointerdown', { clientX: 20, clientY: 30 });
  await overlay().emit('pointermove', { clientX: 30, clientY: 30 });
  await overlay().emit('pointerup', { clientX: 30, clientY: 30 });
  assert.equal(el('undo').disabled, false);
});

async function openComment(x = 60, y = 45) {
  await el('tool-comment').emit('click');
  await overlay().emit('pointerdown', { clientX: x, clientY: y });
  return lastCreated('textarea');
}

test('a comment is typed into a resizable text box and committed with Enter', async () => {
  await start();
  const area = await openComment();
  assert.equal(area.style.left, '50%');
  assert.equal(area.style.top, '50%');
  assert.equal(area.style.fontSize, '16px');
  assert.equal(area.style.fontWeight, 'normal');
  assert.equal(area.style.fontStyle, 'normal');
  assert.equal(area.rows, 1);
  assert.equal(area.focused, true);
  assert.ok(el('wrap').children.includes(area));

  area.scrollHeight = 40;
  await area.emit('input');
  assert.equal(area.style.height, '40px');

  area.value = '  Fix this  ';
  area.rect = { left: 0, top: 0, width: 50, height: 20 };
  await area.emit('keydown', { key: 'a' });
  await area.emit('keydown', { key: 'Enter', shiftKey: true });
  assert.equal(area.removed, false);
  await area.emit('keydown', { key: 'Enter' });
  assert.equal(area.removed, true);
  assert.deepEqual(lastCall(overlay(), 'fillRect').slice(0, 4), ['fillRect', 100, 50, 100]);
  const lines = overlay().ctx.calls.filter(([name]) => name === 'fillText').map(([, line]) => line);
  assert.deepEqual(lines, ['Fix', 'this']);
  assert.equal(overlay().ctx.props.font, '32px sans-serif');
  assert.equal(el('undo').disabled, false);

  await area.emit('blur', { relatedTarget: null });
  assert.equal(count(overlay(), 'fillText'), 2, 'one comment of two lines, not committed twice');
});

test('the text box can be made one character wide', async () => {
  await start();
  const area = await openComment();
  area.value = 'ab';
  area.rect = { left: 0, top: 0, width: 5, height: 20 };
  await area.emit('keydown', { key: 'Enter' });
  assert.equal(lastCall(overlay(), 'fillRect')[3], 10);
  assert.equal(count(overlay(), 'fillText'), 2);
});

test('bold, italic and the font size apply to the open comment and to the saved one', async () => {
  await start();
  await el('format-bold').emit('click');
  assert.equal(el('format-bold').attrs['aria-pressed'], 'true');
  const area = await openComment();
  assert.equal(area.style.fontWeight, 'bold');

  await el('format-italic').emit('click');
  assert.equal(area.style.fontStyle, 'italic');
  assert.equal(area.focused, true);
  area.focused = false;
  el('font-size').value = '24';
  await el('font-size').emit('change');
  assert.equal(area.style.fontSize, '24px');
  assert.equal(area.focused, true);

  await el('format-bold').emit('click');
  assert.equal(el('format-bold').attrs['aria-pressed'], 'false');
  assert.equal(area.style.fontWeight, 'normal');
  await el('format-bold').emit('click');

  area.value = 'styled';
  await area.emit('keydown', { key: 'Enter' });
  assert.equal(overlay().ctx.props.font, 'italic bold 48px sans-serif');
});

test('changing the text style without an open comment only changes the next one', async () => {
  await start();
  el('font-size').value = '10';
  await el('font-size').emit('change');
  await el('format-italic').emit('click');
  const area = await openComment();
  assert.equal(area.style.fontSize, '10px');
  assert.equal(area.style.fontStyle, 'italic');
});

test('using the toolbar while typing keeps the comment open', async () => {
  await start();
  const area = await openComment();
  const inside = new FakeElement('button');
  el('toolbar').append(inside);
  area.value = 'still typing';
  await area.emit('blur', { relatedTarget: inside });
  assert.equal(area.removed, false);
  await area.emit('blur', { relatedTarget: new FakeElement('a') });
  assert.equal(area.removed, true);
  assert.equal(count(overlay(), 'fillText'), 1);
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
  await area.emit('blur', { relatedTarget: null });
  assert.equal(el('undo').disabled, false);

  area = await openComment();
  area.value = '   ';
  await area.emit('blur', { relatedTarget: null });
  assert.equal(count(overlay(), 'fillText'), 1);
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
  assert.equal(count(overlay(), 'fillText') >= 3, true);
});

for (const [format, type, extension] of [
  ['png', 'image/png', 'png'],
  ['webp', 'image/webp', 'webp'],
  ['pdf', 'application/pdf', 'pdf'],
]) {
  test(`downloading as ${format} saves a ${type} file with the annotations`, async () => {
    await start();
    await drag();
    await el('tool-ellipse').emit('click');
    await drag();
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
    assert.ok(names(flat).includes('ellipse'));
  });
}

test('downloading reports an error instead of throwing', async () => {
  await start();
  el('format').value = 'gif';
  await el('save').emit('click');
  assert.equal(el('status').textContent, 'Could not save: Unsupported format: gif');
  assert.equal(downloads.length, 0);
});

test('copy puts the annotated screenshot on the clipboard as png', async () => {
  await start();
  el('format').value = 'pdf';
  await el('copy').emit('click');
  assert.equal(clipboard.length, 1);
  assert.equal(clipboard[0][0].data['image/png'].type, 'image/png');
  assert.equal(el('status').textContent, 'Copied to the clipboard.');
});

test('copy reports an error', async () => {
  await start();
  behavior.clipboard = new Error('denied');
  await el('copy').emit('click');
  assert.equal(el('status').textContent, 'Could not copy: denied');
});

test('share hands the file in the chosen format to the system share sheet', async () => {
  await start();
  el('format').value = 'webp';
  await el('share').emit('click');
  assert.equal(shared.length, 1);
  assert.equal(shared[0].title, 'Example');
  assert.equal(shared[0].files[0].name, 'example.com-20261019-123456.webp');
  assert.equal(shared[0].files[0].type, 'image/webp');
  assert.equal(el('status').textContent, 'Shared.');
});

test('share reports errors and treats closing the share sheet as cancelling', async () => {
  await start();
  behavior.share = new Error('no target');
  await el('share').emit('click');
  assert.equal(el('status').textContent, 'Could not share: no target');
  behavior.share = Object.assign(new Error('closed'), { name: 'AbortError' });
  await el('share').emit('click');
  assert.equal(el('status').textContent, 'Cancelled.');
});

test('Cancel closes the tab right away when nothing was drawn', async () => {
  await start();
  await el('cancel').emit('click');
  assert.deepEqual(closed, [42]);
  assert.deepEqual(asked, []);
});

test('Cancel asks before throwing away annotations', async () => {
  await start();
  await drag();
  behavior.keep = true;
  await el('cancel').emit('click');
  assert.equal(asked.length, 1);
  assert.deepEqual(closed, []);
  behavior.keep = false;
  await el('cancel').emit('click');
  assert.deepEqual(closed, [42]);
});

test('Cancel keeps a comment that is being typed in the confirmation', async () => {
  await start();
  const area = await openComment();
  area.value = 'unsaved';
  await el('cancel').emit('click');
  assert.equal(area.removed, true);
  assert.equal(asked.length, 1);
  assert.deepEqual(closed, [42]);
});

test('Esc closes the editor, other keys do not', async () => {
  await start();
  await doc.emit('keydown', { key: 'a' });
  assert.deepEqual(closed, []);
  await doc.emit('keydown', { key: 'Escape' });
  assert.deepEqual(closed, [42]);
});

test('Esc inside the comment box only discards the comment', async () => {
  await start();
  const area = await openComment();
  let stopped = false;
  area.value = 'oops';
  await area.emit('keydown', { key: 'Escape', stopPropagation: () => (stopped = true) });
  assert.equal(stopped, true);
  assert.equal(area.removed, true);
  assert.deepEqual(closed, []);
});
