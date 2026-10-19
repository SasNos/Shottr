import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Annotations, drawAnnotations, drawSegment } from '../src/annotations.js';
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
  assert.deepEqual(lines, [[5, 5], [9, 1], [9, 1]]);
});

test('drawAnnotations draws a single point stroke as a dot', () => {
  const ctx = fakeCtx();
  drawAnnotations(ctx, [{ type: 'stroke', color: '#00f', width: 2, points: [{ x: 7, y: 8 }] }]);
  assert.deepEqual(
    ctx.calls.filter(([name]) => name === 'moveTo' || name === 'lineTo'),
    [['moveTo', 7, 8], ['lineTo', 7, 8]],
  );
});

test('drawAnnotations draws a comment as black text on a white box', () => {
  const ctx = fakeCtx();
  drawAnnotations(ctx, [{ type: 'comment', x: 10, y: 20, text: 'Hi\nthere!', fontSize: 16 }]);
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
  const box = ctx.calls.find(([name]) => name === 'fillRect');
  assert.deepEqual(box, ['fillRect', 10, 20, 60 + 16, 2 * 16 * 1.3 + 16]);
  const texts = ctx.calls.filter(([name]) => name === 'fillText');
  assert.deepEqual(texts[1], ['fillText', 'there!', 18, 20 + 8 + 16 * 1.3]);
});
