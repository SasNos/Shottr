export const MAX_CANVAS_DIMENSION = 16384;
export const MAX_CANVAS_AREA = 268435456;
export const MAX_PDF_POINTS = 14400;
const POINTS_PER_CSS_PIXEL = 0.75;

/** Scroll offsets (CSS px) so that viewport-sized tiles cover the whole page; the last tile ends at the page bottom. */
export function planScrollPositions(pageHeight, viewportHeight) {
  const positions = [];
  let y = 0;
  while (y + viewportHeight < pageHeight) {
    positions.push(y);
    y += viewportHeight;
  }
  positions.push(Math.max(0, pageHeight - viewportHeight));
  return positions;
}

/** Shrinks a canvas size so it stays inside the canvas limits of the browser. */
export function fitCanvas(width, height) {
  const scale = Math.min(
    1,
    MAX_CANVAS_DIMENSION / Math.max(width, height),
    Math.sqrt(MAX_CANVAS_AREA / (width * height)),
  );
  return {
    scale,
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** Converts a crop rectangle in CSS px to image pixels, clamped to the image. */
export function cropToPixels(crop, ratio, bounds) {
  const x = clamp(Math.round(crop.x * ratio), 0, bounds.width - 1);
  const y = clamp(Math.round(crop.y * ratio), 0, bounds.height - 1);
  return {
    x,
    y,
    width: clamp(Math.round(crop.width * ratio), 1, bounds.width - x),
    height: clamp(Math.round(crop.height * ratio), 1, bounds.height - y),
  };
}

/** PDF page size in points for an image of the given pixel size; `ratio` is image pixels per CSS pixel. */
export function pdfPageSize(widthPx, heightPx, ratio) {
  const scale = Math.min(POINTS_PER_CSS_PIXEL / ratio, MAX_PDF_POINTS / Math.max(widthPx, heightPx));
  return { width: widthPx * scale, height: heightPx * scale };
}
