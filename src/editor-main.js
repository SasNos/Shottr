import { createCanvas, loadImage } from './dom.js';
import { initEditor } from './editor.js';

initEditor({
  document,
  chrome,
  location,
  loadImage,
  createCanvas: (width, height) => createCanvas(document, width, height),
  urlApi: URL,
  now: () => new Date(),
});
