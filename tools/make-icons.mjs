// Generates the toolbar icons (viewfinder corners on a blue rounded square). Run once: npm run icons.
// Build tool, not application code: excluded from coverage.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};

function icon(size) {
  const pixels = Buffer.alloc(size * (size * 4 + 1));
  const radius = size * 0.22;
  const arm = size * 0.28;
  const edge = size * 0.2;
  const thick = Math.max(1, size * 0.09);
  for (let y = 0; y < size; y += 1) {
    pixels[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const dx = Math.max(radius - x - 0.5, x + 0.5 - (size - radius), 0);
      const dy = Math.max(radius - y - 0.5, y + 0.5 - (size - radius), 0);
      const inside = Math.hypot(dx, dy) <= radius;
      const near = (v) => Math.min(v, size - v);
      const cornerX = near(x + 0.5);
      const cornerY = near(y + 0.5);
      const mark =
        (cornerX >= edge && cornerX < edge + thick && cornerY >= edge && cornerY < edge + arm) ||
        (cornerY >= edge && cornerY < edge + thick && cornerX >= edge && cornerX < edge + arm);
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      const rgba = !inside ? [0, 0, 0, 0] : mark ? [255, 255, 255, 255] : [26, 115, 232, 255];
      pixels.set(rgba, offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('icons', { recursive: true });
for (const size of [16, 48, 128]) writeFileSync(`icons/icon${size}.png`, icon(size));
