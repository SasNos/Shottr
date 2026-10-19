import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPdf } from '../src/pdf.js';

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
const build = () => buildPdf({ jpeg, imageWidth: 40, imageHeight: 20, pageWidth: 30, pageHeight: 15 });
const text = (bytes) => Buffer.from(bytes).toString('latin1');

test('buildPdf writes a header, trailer and the embedded image', () => {
  const pdf = build();
  const source = text(pdf);
  assert.ok(source.startsWith('%PDF-1.4\n'));
  assert.ok(source.endsWith('%%EOF\n'));
  assert.ok(source.includes('/MediaBox [0 0 30.00 15.00]'));
  assert.ok(source.includes('/Width 40 /Height 20'));
  assert.ok(source.includes('/Filter /DCTDecode /Length 8'));
  assert.ok(source.includes('q 30.00 0 0 15.00 0 0 cm /Im0 Do Q'));
  assert.ok(source.includes('\xff\xd8\xff\xe0\x00\x10\xff\xd9'));
});

test('buildPdf xref offsets point at the objects', () => {
  const source = text(build());
  const xrefAt = Number(/startxref\n(\d+)\n/.exec(source)[1]);
  assert.ok(source.slice(xrefAt).startsWith('xref\n0 6\n'));
  const entries = source.slice(xrefAt).split('\n').slice(3, 8);
  assert.equal(entries.length, 5);
  entries.forEach((entry, index) => {
    assert.equal(entry.length, 19);
    const offset = Number(entry.slice(0, 10));
    assert.ok(source.slice(offset).startsWith(`${index + 1} 0 obj\n`));
  });
});
