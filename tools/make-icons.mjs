// Generates the toolbar icons (viewfinder corners and a center dot on an orange rounded square). Run once: npm run icons.
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

// Colors of the icon: Mber Flow's warm accent family, deliberately not the browser blue, so the icon stands out in the toolbar.
const BACKGROUND = [212, 84, 31];
const MARK = [255, 255, 255];
const SAMPLES = 4;

// Distance of a coordinate to the nearer edge of the icon.
const near = (v, size) => Math.min(v, size - v);

// Coverage (0..1) of one pixel by the icon, using SAMPLES x SAMPLES sub-samples for smooth edges.
function coverage(size, px, py) {
  const radius = size * 0.24;
  const margin = size * 0.04;
  const arm = size * 0.2;
  const edge = size * 0.2;
  const thick = Math.max(1.5, size * 0.1);
  const dot = size * 0.09;
  let back = 0;
  let mark = 0;
  for (let sy = 0; sy < SAMPLES; sy += 1) {
    for (let sx = 0; sx < SAMPLES; sx += 1) {
      const x = px + (sx + 0.5) / SAMPLES;
      const y = py + (sy + 0.5) / SAMPLES;
      const dx = Math.max(margin + radius - x, x - (size - margin - radius), 0);
      const dy = Math.max(margin + radius - y, y - (size - margin - radius), 0);
      const inside =
        x >= margin && y >= margin && x <= size - margin && y <= size - margin && Math.hypot(dx, dy) <= radius;
      if (!inside) continue;
      back += 1;
      const cx = near(x, size);
      const cy = near(y, size);
      const corner =
        (cx >= edge && cx < edge + thick && cy >= edge && cy < edge + arm) ||
        (cy >= edge && cy < edge + thick && cx >= edge && cx < edge + arm);
      const center = Math.hypot(x - size / 2, y - size / 2) <= dot;
      if (corner || center) mark += 1;
    }
  }
  const total = SAMPLES * SAMPLES;
  return { alpha: back / total, mark: back ? mark / back : 0 };
}

function icon(size) {
  const pixels = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    pixels[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const { alpha, mark } = coverage(size, x, y);
      const rgb = BACKGROUND.map((channel, index) => Math.round(channel + (MARK[index] - channel) * mark));
      pixels.set([...rgb, Math.round(alpha * 255)], y * (size * 4 + 1) + 1 + x * 4);
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
