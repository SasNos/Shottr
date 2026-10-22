import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jobToPngBase64, toBase64 } from '../src/clipboard.js';

test('toBase64 encodes bytes, also beyond one chunk', () => {
  assert.equal(toBase64(new Uint8Array([104, 105])), 'aGk=');
  const big = new Uint8Array(0x8000 + 3).fill(65);
  assert.equal(toBase64(big), Buffer.from(big).toString('base64'));
});

test('jobToPngBase64 composes the job and encodes it as PNG', async () => {
  const types = [];
  const job = { tiles: [{ dataUrl: 'a', y: 0 }], viewportWidth: 10, crop: { x: 0, y: 0, width: 5, height: 5 } };
  const base64 = await jobToPngBase64(job, {
    loadImage: async () => ({ width: 20, height: 20 }),
    createCanvas: (width, height) => ({
      width,
      height,
      getContext: () => ({ drawImage: () => {} }),
      convertToBlob: async ({ type }) => {
        types.push([type, width, height]);
        return new Blob([new Uint8Array([1, 2, 3])]);
      },
    }),
  });
  assert.equal(base64, 'AQID');
  assert.deepEqual(types, [['image/png', 10, 10]]);
});
