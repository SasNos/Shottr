import { drawAnnotations } from './annotations.js';
import { pdfPageSize } from './layout.js';
import { buildPdf } from './pdf.js';

const MIME = { png: 'image/png', webp: 'image/webp' };

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob && blob.type === type) resolve(blob);
        else reject(new Error(`This browser cannot encode ${type}`));
      },
      type,
      quality,
    );
  });
}

/** Encodes a canvas as png, webp or pdf. `ratio` is image pixels per CSS pixel (sets the PDF page size). */
export async function encode(canvas, format, ratio) {
  if (format === 'pdf') {
    const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
    const page = pdfPageSize(canvas.width, canvas.height, ratio);
    const bytes = buildPdf({
      jpeg,
      imageWidth: canvas.width,
      imageHeight: canvas.height,
      pageWidth: page.width,
      pageHeight: page.height,
    });
    return new Blob([bytes], { type: 'application/pdf' });
  }
  if (!Object.hasOwn(MIME, format)) throw new Error(`Unsupported format: ${format}`);
  return toBlob(canvas, MIME[format], 0.95);
}

/** Draws the base image and all annotations onto a fresh opaque canvas. */
export function flatten(createCanvas, base, items) {
  const canvas = createCanvas(base.width, base.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, base.width, base.height);
  ctx.drawImage(base, 0, 0);
  drawAnnotations(ctx, items);
  return canvas;
}

export function buildFileName(pageUrl, format, date) {
  const host = URL.canParse(pageUrl) ? new URL(pageUrl).hostname.replace(/[^a-z0-9.-]/gi, '-') : '';
  const stamp = date.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  return `${host || 'page'}-${stamp}.${format}`;
}

export function triggerDownload(document, urlApi, blob, name) {
  const link = document.createElement('a');
  link.href = urlApi.createObjectURL(blob);
  link.download = name;
  link.click();
  urlApi.revokeObjectURL(link.href);
}
