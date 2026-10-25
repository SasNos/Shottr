import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createCanvas, delay, loadImage } from '../src/dom.js';

const original = globalThis.Image;
afterEach(() => {
  globalThis.Image = original;
});

test('loadImage resolves with the loaded image', async () => {
  globalThis.Image = class {
    set src(value) {
      this.loaded = value;
      queueMicrotask(() => this.onload());
    }
  };
  const image = await loadImage('data:x');
  assert.equal(image.loaded, 'data:x');
});

test('loadImage rejects when the image cannot be decoded', async () => {
  globalThis.Image = class {
    set src(_value) {
      queueMicrotask(() => this.onerror());
    }
  };
  await assert.rejects(loadImage('data:broken'), /Could not load the captured image/);
});

test('createCanvas creates a canvas of the given size', () => {
  const canvas = {};
  const document = { createElement: (tag) => (tag === 'canvas' ? canvas : null) };
  assert.equal(createCanvas(document, 30, 40), canvas);
  assert.equal(canvas.width, 30);
  assert.equal(canvas.height, 40);
});

test('delay resolves after the given time', async () => {
  const start = Date.now();
  await delay(30);
  assert.ok(Date.now() - start >= 25);
});
