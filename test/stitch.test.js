import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeImage } from '../src/stitch.js';
import { FakeElement } from './helpers/fakes.js';

const setup = (image) => {
  const canvases = [];
  return {
    canvases,
    loadImage: async () => image,
    createCanvas: (width, height) => {
      const canvas = new FakeElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvases.push(canvas);
      return canvas;
    },
  };
};

const draws = (canvas) => canvas.ctx.calls.filter(([name]) => name === 'drawImage').map(([, , ...rest]) => rest);

test('composeImage crops a selected area in image pixels', async () => {
  const image = { width: 200, height: 100 };
  const deps = setup(image);
  const job = { tiles: [{ dataUrl: 'a', y: 0 }], viewportWidth: 100, crop: { x: 10, y: 5, width: 20, height: 10 } };
  const { canvas, ratio } = await composeImage(job, deps);
  assert.equal(canvas.width, 40);
  assert.equal(canvas.height, 20);
  assert.equal(ratio, 2, 'canvas pixels per CSS pixel of the page, not of the crop');
  assert.deepEqual(
    canvas.ctx.calls.find(([name]) => name === 'drawImage'),
    ['drawImage', image, 20, 10, 40, 20, 0, 0, 40, 20],
  );
});

test('composeImage returns the viewport as it is', async () => {
  const deps = setup({ width: 200, height: 100 });
  const job = { tiles: [{ dataUrl: 'a', y: 0 }], viewportWidth: 100, crop: null, pageHeight: 0 };
  const { canvas, ratio } = await composeImage(job, deps);
  assert.equal(canvas.width, 200);
  assert.equal(canvas.height, 100);
  assert.deepEqual(draws(canvas), [[0, 0, 200, 100]]);
  assert.equal(ratio, 2);
});

test('composeImage stitches full page tiles at their scroll offsets', async () => {
  const deps = setup({ width: 200, height: 100 });
  const job = {
    tiles: [
      { dataUrl: 'a', y: 0 },
      { dataUrl: 'b', y: 50 },
      { dataUrl: 'c', y: 75 },
    ],
    viewportWidth: 100,
    crop: null,
    pageHeight: 125,
  };
  const { canvas, ratio } = await composeImage(job, deps);
  assert.equal(canvas.height, 250);
  assert.equal(ratio, 2);
  assert.deepEqual(draws(canvas), [
    [0, 0, 200, 100],
    [0, 100, 200, 100],
    [0, 150, 200, 100],
  ]);
});

test('composeImage scales down pages that exceed the canvas limit', async () => {
  const deps = setup({ width: 1000, height: 1000 });
  const job = {
    tiles: [
      { dataUrl: 'a', y: 0 },
      { dataUrl: 'b', y: 31768 },
    ],
    viewportWidth: 1000,
    crop: null,
    pageHeight: 32768,
  };
  const { canvas, ratio } = await composeImage(job, deps);
  assert.equal(canvas.height, 16384);
  assert.equal(canvas.width, 500);
  assert.equal(ratio, 0.5);
  assert.deepEqual(draws(canvas)[1], [0, 15884, 500, 500]);
});
