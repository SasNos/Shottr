import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cropToPixels, fitCanvas, pdfPageSize, planScrollPositions } from '../src/layout.js';

test('planScrollPositions covers a page that is shorter than the viewport', () => {
  assert.deepEqual(planScrollPositions(500, 800), [0]);
});

test('planScrollPositions covers an exact multiple of the viewport without a duplicate', () => {
  assert.deepEqual(planScrollPositions(1600, 800), [0, 800]);
});

test('planScrollPositions ends the last tile at the page bottom', () => {
  assert.deepEqual(planScrollPositions(2000, 800), [0, 800, 1200]);
});

test('fitCanvas keeps small canvases unchanged', () => {
  assert.deepEqual(fitCanvas(1000, 2000), { scale: 1, width: 1000, height: 2000 });
});

test('fitCanvas shrinks canvases that exceed the dimension limit', () => {
  const fit = fitCanvas(1000, 32768);
  assert.equal(fit.scale, 0.5);
  assert.equal(fit.height, 16384);
  assert.equal(fit.width, 500);
});

test('fitCanvas never returns a zero size', () => {
  const fit = fitCanvas(1, 1000000);
  assert.equal(fit.width, 1);
});

test('cropToPixels scales the crop to image pixels', () => {
  assert.deepEqual(cropToPixels({ x: 10, y: 20, width: 30, height: 40 }, 2, { width: 1000, height: 1000 }), {
    x: 20,
    y: 40,
    width: 60,
    height: 80,
  });
});

test('cropToPixels clamps a crop that leaves the image', () => {
  const area = cropToPixels({ x: -5, y: 90, width: 500, height: 500 }, 1, { width: 100, height: 100 });
  assert.deepEqual(area, { x: 0, y: 90, width: 100, height: 10 });
});

test('cropToPixels keeps at least one pixel', () => {
  const area = cropToPixels({ x: 500, y: 500, width: 0, height: 0 }, 1, { width: 100, height: 100 });
  assert.deepEqual(area, { x: 99, y: 99, width: 1, height: 1 });
});

test('pdfPageSize converts image pixels to points', () => {
  assert.deepEqual(pdfPageSize(2000, 1000, 2), { width: 750, height: 375 });
});

test('pdfPageSize limits very large pages', () => {
  const size = pdfPageSize(2000, 40000, 1);
  assert.equal(size.height, 14400);
  assert.equal(size.width, 720);
});
