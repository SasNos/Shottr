import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Annotations, drawAnnotations, drawSegment, wrapLines } from '../src/annotations.js';
import { fakeCtx } from './helpers/fakes.js';

test('Annotations supports undo, redo and clear', () => {
  const notes = new Annotations();
  notes.undo();
  notes.redo();
  assert.equal(notes.canUndo, false);
  notes.add({ n: 1 });
  notes.add({ n: 2 });
  notes.undo();
  assert.deepEqual(notes.items, [{ n: 1 }]);
  assert.equal(notes.canRedo, true);
  notes.redo();
  assert.deepEqual(notes.items, [{ n: 1 }, { n: 2 }]);
  notes.undo();
  notes.add({ n: 3 });
  assert.equal(notes.canRedo, false);
  notes.undo();
  notes.clear();
  assert.deepEqual(notes.items, []);
  assert.equal(notes.canRedo, false);
});

test('drawSegment draws a round line', () => {
  const ctx = fakeCtx();
  drawSegment(ctx, { color: '#f00', width: 4 }, { x: 1, y: 2 }, { x: 3, y: 4 });
  assert.equal(ctx.props.strokeStyle, '#f00');
  assert.equal(ctx.props.lineWidth, 4);
  assert.equal(ctx.props.lineCap, 'round');
  assert.deepEqual(
    ctx.calls.filter(([name]) => name !== 'set').map(([name, ...args]) => [name, ...args]),
    [['beginPath'], ['moveTo', 1, 2], ['lineTo', 3, 4], ['stroke']],
  );
});

test('drawAnnotations draws a stroke through all its points', () => {
  const ctx = fakeCtx();
  const points = [
    { x: 0, y: 0 },
    { x: 5, y: 5 },
    { x: 9, y: 1 },
  ];
  drawAnnotations(ctx, [{ type: 'stroke', color: '#00f', width: 2, points }]);
  const lines = ctx.calls.filter(([name]) => name === 'lineTo').map(([, x, y]) => [x, y]);
  assert.deepEqual(lines, [
    [5, 5],
    [9, 1],
    [9, 1],
  ]);
});

test('drawAnnotations draws a single point stroke as a dot', () => {
  const ctx = fakeCtx();
  drawAnnotations(ctx, [{ type: 'stroke', color: '#00f', width: 2, points: [{ x: 7, y: 8 }] }]);
  assert.deepEqual(
    ctx.calls.filter(([name]) => name === 'moveTo' || name === 'lineTo'),
    [
      ['moveTo', 7, 8],
      ['lineTo', 7, 8],
    ],
  );
});

const commentOf = (extra = {}) => ({
  type: 'comment',
  x: 10,
  y: 20,
  width: 100,
  text: 'Hi\nthere!',
  fontSize: 16,
  bold: false,
  italic: false,
  ...extra,
});
const fontOf = (ctx) => ctx.props.font;

test('drawAnnotations draws a comment as black text on a white box of the given width', () => {
  const ctx = fakeCtx();
  drawAnnotations(ctx, [commentOf()]);
  const names = ctx.calls.filter(([name]) => name !== 'set' && name !== 'measureText').map(([name]) => name);
  assert.deepEqual(names, ['fillRect', 'strokeRect', 'fillText', 'fillText']);
  const sets = ctx.calls.filter(([name]) => name === 'set');
  assert.deepEqual(
    sets.map(([, name, value]) => [name, value]),
    [
      ['font', '16px sans-serif'],
      ['textBaseline', 'top'],
      ['fillStyle', '#ffffff'],
      ['strokeStyle', '#000000'],
      ['lineWidth', 1],
      ['fillStyle', '#000000'],
    ],
  );
  assert.deepEqual(
    ctx.calls.find(([name]) => name === 'fillRect'),
    ['fillRect', 10, 20, 100, 2 * 16 * 1.3 + 16],
  );
  const texts = ctx.calls.filter(([name]) => name === 'fillText');
  assert.deepEqual(texts[1], ['fillText', 'there!', 18, 20 + 8 + 16 * 1.3]);
});

test('drawAnnotations wraps comment text at the box width', () => {
  const ctx = fakeCtx();
  drawAnnotations(ctx, [commentOf({ width: 50, text: 'aaa bbb' })]);
  const texts = ctx.calls.filter(([name]) => name === 'fillText').map(([, text]) => text);
  assert.deepEqual(texts, ['aaa', 'bbb']);
});

test('drawAnnotations applies bold and italic to comments', () => {
  const plain = fakeCtx();
  const both = fakeCtx();
  const bold = fakeCtx();
  const italic = fakeCtx();
  drawAnnotations(plain, [commentOf()]);
  drawAnnotations(both, [commentOf({ bold: true, italic: true })]);
  drawAnnotations(bold, [commentOf({ bold: true })]);
  drawAnnotations(italic, [commentOf({ italic: true })]);
  assert.equal(fontOf(plain), '16px sans-serif');
  assert.equal(fontOf(both), 'italic bold 16px sans-serif');
  assert.equal(fontOf(bold), 'bold 16px sans-serif');
  assert.equal(fontOf(italic), 'italic 16px sans-serif');
});

test('drawAnnotations draws a rectangle from any two corners with the pen color', () => {
  const ctx = fakeCtx();
  drawAnnotations(ctx, [{ type: 'rect', color: '#123456', width: 3, x1: 50, y1: 40, x2: 10, y2: 30 }]);
  assert.equal(ctx.props.strokeStyle, '#123456');
  assert.equal(ctx.props.lineWidth, 3);
  assert.deepEqual(
    ctx.calls.find(([name]) => name === 'strokeRect'),
    ['strokeRect', 10, 30, 40, 10],
  );
  assert.equal(
    ctx.calls.some(([name]) => name === 'fillRect'),
    false,
  );
});

test('drawAnnotations draws an ellipse inside the dragged box without filling it', () => {
  const ctx = fakeCtx();
  drawAnnotations(ctx, [{ type: 'ellipse', color: '#123456', width: 2, x1: 10, y1: 40, x2: 50, y2: 20 }]);
  assert.deepEqual(
    ctx.calls.find(([name]) => name === 'ellipse'),
    ['ellipse', 30, 30, 20, 10, 0, 0, Math.PI * 2],
  );
  assert.equal(
    ctx.calls.some(([name]) => name === 'fill'),
    false,
  );
  assert.equal(ctx.calls.at(-1)[0], 'stroke');
});

const measure = (text) => text.length * 10;

test('wrapLines breaks at spaces', () => {
  assert.deepEqual(wrapLines('aaa bbb ccc', 70, measure), ['aaa bbb', 'ccc']);
});

test('wrapLines keeps newlines and blank lines', () => {
  assert.deepEqual(wrapLines('a\n\nb', 100, measure), ['a', '', 'b']);
});

test('wrapLines breaks words that are wider than the box', () => {
  assert.deepEqual(wrapLines('abcdefgh', 30, measure), ['abc', 'def', 'gh']);
  assert.deepEqual(wrapLines('ab cdefgh', 40, measure), ['ab', 'cdef', 'gh']);
});

test('wrapLines never loses characters in a box narrower than one character', () => {
  assert.deepEqual(wrapLines('ab', 5, measure), ['a', 'b']);
});
