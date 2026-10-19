import { createCanvas, loadImage } from './dom.js';
import { initEditor } from './editor.js';
import { applyTheme } from './theme.js';

applyTheme(document, (query) => window.matchMedia(query));

initEditor({
  document,
  chrome,
  location,
  loadImage,
  createCanvas: (width, height) => createCanvas(document, width, height),
  urlApi: URL,
  now: () => new Date(),
  navigator,
  FileClass: File,
  ClipboardItemClass: globalThis.ClipboardItem,
  confirmDiscard: (message) => confirm(message),
});
