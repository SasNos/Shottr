import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFileName, encode, flatten, triggerDownload } from '../src/export.js';
import { FakeElement } from './helpers/fakes.js';

const canvasWith = (toBlob) => {
  const canvas = new FakeElement('canvas');
  canvas.width = 20;
  canvas.height = 10;
  if (toBlob) canvas.toBlob = toBlob;
  return canvas;
};

test('encode creates png and webp blobs', async () => {
  const canvas = canvasWith();
  assert.equal((await encode(canvas, 'png', 1)).type, 'image/png');
  assert.equal((await encode(canvas, 'webp', 1)).type, 'image/webp');
});

test('encode creates a pdf from a jpeg of the canvas', async () => {
  const blob = await encode(canvasWith(), 'pdf', 2);
  assert.equal(blob.type, 'application/pdf');
  const source = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  assert.ok(source.startsWith('%PDF-1.4'));
  assert.ok(source.includes('/MediaBox [0 0 7.50 3.75]'));
  assert.ok(source.includes('/Width 20 /Height 10'));
});

test('encode rejects unsupported formats', async () => {
  for (const format of ['gif', 'constructor', undefined]) {
    await assert.rejects(encode(canvasWith(), format, 1), /Unsupported format/);
  }
});

test('encode rejects when the browser cannot encode the type', async () => {
  const wrongType = canvasWith((callback) => callback(new Blob(['x'], { type: 'image/png' })));
  await assert.rejects(encode(wrongType, 'webp', 1), /cannot encode image\/webp/);
  const noBlob = canvasWith((callback) => callback(null));
  await assert.rejects(encode(noBlob, 'png', 1), /cannot encode image\/png/);
  await assert.rejects(encode(noBlob, 'pdf', 1), /cannot encode image\/jpeg/);
});

test('flatten paints a white background, the base image and the annotations', () => {
  const created = [];
  const createCanvas = (width, height) => {
    const canvas = new FakeElement('canvas');
    canvas.width = width;
    canvas.height = height;
    created.push(canvas);
    return canvas;
  };
  const base = { width: 30, height: 20 };
  const out = flatten(createCanvas, base, [{ type: 'stroke', color: '#000', width: 1, points: [{ x: 1, y: 1 }] }]);
  assert.equal(out, created[0]);
  assert.equal(out.width, 30);
  const names = out.ctx.calls.filter(([name]) => name !== 'set').map(([name]) => name);
  assert.deepEqual(names.slice(0, 2), ['fillRect', 'drawImage']);
  assert.ok(names.includes('stroke'));
  assert.deepEqual(out.ctx.calls.find(([name]) => name === 'fillRect'), ['fillRect', 0, 0, 30, 20]);
});

test('buildFileName uses host name and time stamp', () => {
  const date = new Date('2026-10-19T12:34:56.789Z');
  assert.equal(buildFileName('https://example.com/a?b=1', 'png', date), 'example.com-20261019-123456.png');
  assert.equal(buildFileName('http://exa_mple.com/', 'pdf', date), 'exa-mple.com-20261019-123456.pdf');
});

test('buildFileName falls back to "page" when there is no host', () => {
  const date = new Date('2026-10-19T12:34:56.789Z');
  assert.equal(buildFileName(undefined, 'webp', date), 'page-20261019-123456.webp');
  assert.equal(buildFileName('about:blank', 'webp', date), 'page-20261019-123456.webp');
});

test('triggerDownload clicks a download link and frees the object url', () => {
  const link = new FakeElement('a');
  const document = { createElement: (tag) => (tag === 'a' ? link : null) };
  const revoked = [];
  const urlApi = { createObjectURL: () => 'blob:abc', revokeObjectURL: (url) => revoked.push(url) };
  triggerDownload(document, urlApi, new Blob(['x']), 'file.png');
  assert.equal(link.href, 'blob:abc');
  assert.equal(link.download, 'file.png');
  assert.equal(link.clicks, 1);
  assert.deepEqual(revoked, ['blob:abc']);
});
