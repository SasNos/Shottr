import { cropToPixels, fitCanvas } from './layout.js';

function cropImage(image, crop, ratio, createCanvas) {
  const area = cropToPixels(crop, ratio, image);
  const canvas = createCanvas(area.width, area.height);
  canvas.getContext('2d').drawImage(image, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
  return canvas;
}

function stitchTiles(images, job, ratio, createCanvas) {
  const width = images[0].width;
  const height = Math.max(images[0].height, Math.round(job.pageHeight * ratio));
  const fit = fitCanvas(width, height);
  const canvas = createCanvas(fit.width, fit.height);
  const ctx = canvas.getContext('2d');
  images.forEach((image, index) => {
    const top = Math.round(job.tiles[index].y * ratio * fit.scale);
    ctx.drawImage(image, 0, top, fit.width, Math.ceil(image.height * fit.scale));
  });
  return canvas;
}

/**
 * Turns a capture job into one canvas. Tiles are screenshots of the viewport at scroll offset `y` (CSS px);
 * `pageHeight` is 0 unless the job is a full page capture.
 */
export async function composeImage(job, { loadImage, createCanvas }) {
  const images = await Promise.all(job.tiles.map((tile) => loadImage(tile.dataUrl)));
  const ratio = images[0].width / job.viewportWidth;
  if (job.crop) return cropImage(images[0], job.crop, ratio, createCanvas);
  return stitchTiles(images, job, ratio, createCanvas);
}
