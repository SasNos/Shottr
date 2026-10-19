import { Annotations, drawAnnotations, drawSegment } from './annotations.js';
import { buildFileName, encode, flatten, triggerDownload } from './export.js';
import { jobKey } from './job.js';
import { composeImage } from './stitch.js';

const BASE_PEN_WIDTH = 3;
const BASE_FONT_SIZE = 16;

async function loadJob(chrome, search) {
  const id = new URLSearchParams(search).get('job');
  if (!id) return null;
  const key = jobKey(id);
  const stored = await chrome.storage.local.get(key);
  await chrome.storage.local.remove(key);
  return stored[key] ?? null;
}

/** Wires up the editor page: preview, pen and comment tools, undo/redo and saving. */
export async function initEditor({ document, chrome, location, loadImage, createCanvas, urlApi, now }) {
  const $ = (id) => document.getElementById(id);
  const say = (text) => {
    $('status').textContent = text;
  };

  const job = await loadJob(chrome, location.search);
  if (!job) {
    say('No capture found. Start a new capture from the Shottr toolbar button.');
    return;
  }

  const base = await composeImage(job, { loadImage, createCanvas });
  const overlay = createCanvas(base.width, base.height);
  const ctx = overlay.getContext('2d');
  const ratio = base.width / job.viewportWidth;
  const penWidth = Math.max(2, Math.round(BASE_PEN_WIDTH * ratio));
  const fontSize = Math.round(BASE_FONT_SIZE * ratio);

  document.title = `Shottr: ${job.title}`;
  base.className = 'layer';
  overlay.className = 'layer overlay';
  const wrap = $('wrap');
  wrap.style.maxWidth = `${base.width / ratio}px`;
  wrap.style.aspectRatio = `${base.width} / ${base.height}`;
  wrap.append(base, overlay);
  say(`${base.width} × ${base.height} px`);

  const notes = new Annotations();
  let tool = 'pen';
  const swatches = document.querySelectorAll('[data-color]');
  let color = swatches[0].dataset.color;
  let stroke = null;
  let finishComment = null;

  const syncButtons = () => {
    $('undo').disabled = !notes.canUndo;
    $('redo').disabled = !notes.canRedo;
    $('clear').disabled = !notes.canUndo && !notes.canRedo;
  };
  const redraw = () => {
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    drawAnnotations(ctx, notes.items);
    syncButtons();
  };
  const finishEditing = () => {
    if (finishComment) finishComment();
  };

  for (const name of ['pen', 'comment']) {
    $(`tool-${name}`).addEventListener('click', () => {
      finishEditing();
      tool = name;
      $('tool-pen').setAttribute('aria-pressed', String(tool === 'pen'));
      $('tool-comment').setAttribute('aria-pressed', String(tool === 'comment'));
    });
  }

  for (const swatch of swatches) {
    swatch.addEventListener('click', () => {
      color = swatch.dataset.color;
      for (const other of swatches) other.setAttribute('aria-pressed', String(other === swatch));
    });
  }

  for (const action of ['undo', 'redo', 'clear']) {
    $(action).addEventListener('click', () => {
      finishEditing();
      notes[action]();
      redraw();
    });
  }

  const toPoint = (event) => {
    const rect = overlay.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * overlay.width) / rect.width,
      y: ((event.clientY - rect.top) * overlay.height) / rect.height,
    };
  };

  function openComment(point) {
    const area = document.createElement('textarea');
    const shown = overlay.getBoundingClientRect().width / overlay.width;
    area.className = 'comment-input';
    area.setAttribute('aria-label', 'Comment text');
    area.style.left = `${(point.x / overlay.width) * 100}%`;
    area.style.top = `${(point.y / overlay.height) * 100}%`;
    area.style.fontSize = `${fontSize * shown}px`;
    let closed = false;
    const close = (save) => {
      if (closed) return;
      closed = true;
      finishComment = null;
      const text = area.value.trim();
      area.remove();
      if (save && text) {
        notes.add({ type: 'comment', x: point.x, y: point.y, text, fontSize });
        redraw();
      }
    };
    area.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        close(true);
      } else if (event.key === 'Escape') {
        close(false);
      }
    });
    area.addEventListener('blur', () => close(true));
    finishComment = () => close(true);
    wrap.append(area);
    area.focus();
  }

  overlay.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    finishEditing();
    const point = toPoint(event);
    if (tool === 'comment') {
      openComment(point);
      return;
    }
    overlay.setPointerCapture(event.pointerId);
    stroke = { type: 'stroke', color, width: penWidth, points: [point] };
    drawSegment(ctx, stroke, point, point);
  });

  overlay.addEventListener('pointermove', (event) => {
    if (!stroke) return;
    const point = toPoint(event);
    drawSegment(ctx, stroke, stroke.points.at(-1), point);
    stroke.points.push(point);
  });

  const endStroke = () => {
    if (!stroke) return;
    notes.add(stroke);
    stroke = null;
    syncButtons();
  };
  overlay.addEventListener('pointerup', endStroke);
  overlay.addEventListener('pointercancel', endStroke);

  $('save').addEventListener('click', async () => {
    finishEditing();
    const format = $('format').value;
    try {
      const blob = await encode(flatten(createCanvas, base, notes.items), format, ratio);
      triggerDownload(document, urlApi, blob, buildFileName(job.url, format, now()));
      say(`Saved as ${format.toUpperCase()}.`);
    } catch (error) {
      say(`Could not save: ${error.message}`);
    }
  });

  syncButtons();
}
