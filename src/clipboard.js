import { composeImage } from './stitch.js';

/** Base64 of the bytes, in chunks so large screenshots do not exceed the argument limit of fromCharCode. */
export function toBase64(bytes) {
  let text = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(text);
}

/**
 * Composes a capture job (see stitch.js) into a PNG and returns it as base64, for copying it without the editor.
 * `createCanvas` must return a canvas with `convertToBlob` (OffscreenCanvas in the service worker).
 */
export async function jobToPngBase64(job, { loadImage, createCanvas }) {
  const { canvas } = await composeImage(job, { loadImage, createCanvas });
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return toBase64(new Uint8Array(await blob.arrayBuffer()));
}
