import { Annotations, drawAnnotations, drawSegment } from './annotations.js';
import { buildFileName, canShareFiles, encode, flatten, triggerDownload } from './export.js';
import { jobKey } from './job.js';
import { composeImage } from './stitch.js';

async function loadJob(chrome, search) {
  const id = new URLSearchParams(search).get('job');
  if (!id) return null;
  const key = jobKey(id);
  const stored = await chrome.storage.local.get(key);
  await chrome.storage.local.remove(key);
  return stored[key] ?? null;
}

/**
 * Wires up the editor page: preview, pen, shapes and comments, undo/redo, and saving, copying and sharing.
 * Sizes the user picks (stroke width, font size) are CSS pixels of the captured page; they are multiplied by
 * `ratio` (image pixels per CSS pixel) for drawing.
 */
export async function initEditor({
  document,
  chrome,
  location,
  loadImage,
  createCanvas,
  urlApi,
  now,
  navigator,
  FileClass,
  ClipboardItemClass,
}) {
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

  document.title = `Shottr: ${job.title}`;
  base.className = 'layer';
  overlay.className = 'layer overlay';
  const wrap = $('wrap');
  wrap.style.maxWidth = `${base.width / ratio}px`;
  wrap.style.aspectRatio = `${base.width} / ${base.height}`;
  wrap.append(base, overlay);
  say(`${base.width} × ${base.height} px`);
  $('share').hidden = !canShareFiles(navigator, FileClass);

  const notes = new Annotations();
  const swatches = document.querySelectorAll('[data-color]');
  let tool = 'pen';
  let color = swatches[0].dataset.color;
  let drag = null;
  let editing = null;
  const text = { bold: false, italic: false };

  const syncButtons = () => {
    $('undo').disabled = !notes.canUndo;
    $('redo').disabled = !notes.canRedo;
    $('clear').disabled = !notes.canUndo && !notes.canRedo;
  };
  const redraw = (extra = []) => {
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    drawAnnotations(ctx, [...notes.items, ...extra]);
    syncButtons();
  };
  const finishEditing = () => {
    if (editing) editing.close(true);
  };

  for (const name of ['pen', 'rect', 'ellipse', 'comment']) {
    $(`tool-${name}`).addEventListener('click', () => {
      finishEditing();
      tool = name;
      for (const other of ['pen', 'rect', 'ellipse', 'comment']) {
        $(`tool-${other}`).setAttribute('aria-pressed', String(other === tool));
      }
    });
  }

  const setColor = (value) => {
    color = value;
    $('color-picker').value = value;
    for (const swatch of swatches) swatch.setAttribute('aria-pressed', String(swatch.dataset.color === value));
  };
  for (const swatch of swatches) swatch.addEventListener('click', () => setColor(swatch.dataset.color));
  $('color-picker').addEventListener('input', () => setColor($('color-picker').value));

  $('stroke-width').addEventListener('input', () => {
    $('stroke-width-value').textContent = `${$('stroke-width').value} px`;
  });

  const restyle = () => {
    if (!editing) return;
    editing.restyle();
    editing.area.focus();
  };
  for (const name of ['bold', 'italic']) {
    $(`format-${name}`).addEventListener('click', () => {
      text[name] = !text[name];
      $(`format-${name}`).setAttribute('aria-pressed', String(text[name]));
      restyle();
    });
  }
  $('font-size').addEventListener('change', restyle);

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
    const fontSize = () => Number($('font-size').value);
    const restyleArea = () => {
      area.style.fontSize = `${fontSize() * ratio * shown}px`;
      area.style.fontWeight = text.bold ? 'bold' : 'normal';
      area.style.fontStyle = text.italic ? 'italic' : 'normal';
    };
    area.className = 'comment-input';
    area.setAttribute('aria-label', 'Comment text');
    area.rows = 1;
    area.style.left = `${(point.x / overlay.width) * 100}%`;
    area.style.top = `${(point.y / overlay.height) * 100}%`;
    restyleArea();
    let closed = false;
    const close = (save) => {
      if (closed) return;
      closed = true;
      editing = null;
      const value = area.value.trim();
      const width = area.getBoundingClientRect().width / shown;
      area.remove();
      if (save && value) {
        notes.add({
          type: 'comment',
          x: point.x,
          y: point.y,
          width,
          text: value,
          fontSize: Math.round(fontSize() * ratio),
          bold: text.bold,
          italic: text.italic,
        });
        redraw();
      }
    };
    area.addEventListener('input', () => {
      area.style.height = 'auto';
      area.style.height = `${area.scrollHeight}px`;
    });
    area.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        close(true);
      } else if (event.key === 'Escape') {
        close(false);
      }
    });
    // Using the toolbar (font size, bold, ...) must not end the comment.
    area.addEventListener('blur', (event) => {
      if (!$('toolbar').contains(event.relatedTarget)) close(true);
    });
    editing = { area, close, restyle: restyleArea };
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
    const width = Number($('stroke-width').value) * ratio;
    if (tool === 'pen') {
      drag = { type: 'stroke', color, width, points: [point] };
      drawSegment(ctx, drag, point, point);
    } else {
      drag = { type: tool, color, width, x1: point.x, y1: point.y, x2: point.x, y2: point.y };
    }
  });

  overlay.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const point = toPoint(event);
    if (drag.type === 'stroke') {
      drawSegment(ctx, drag, drag.points.at(-1), point);
      drag.points.push(point);
    } else {
      drag.x2 = point.x;
      drag.y2 = point.y;
      redraw([drag]);
    }
  });

  const endDrag = () => {
    if (!drag) return;
    const item = drag;
    drag = null;
    if (item.type === 'stroke' || item.x1 !== item.x2 || item.y1 !== item.y2) notes.add(item);
    redraw();
  };
  overlay.addEventListener('pointerup', endDrag);
  overlay.addEventListener('pointercancel', endDrag);

  const render = async (format) => ({
    blob: await encode(flatten(createCanvas, base, notes.items), format, ratio),
    name: buildFileName(job.url, format, now()),
  });
  const onClick = (id, failure, action) => {
    $(id).addEventListener('click', async () => {
      finishEditing();
      try {
        say(await action($('format').value));
      } catch (error) {
        say(error.name === 'AbortError' ? 'Cancelled.' : `${failure}: ${error.message}`);
      }
    });
  };

  onClick('save', 'Could not save', async (format) => {
    const { blob, name } = await render(format);
    triggerDownload(document, urlApi, blob, name);
    return `Saved as ${format.toUpperCase()}.`;
  });

  onClick('copy', 'Could not copy', async () => {
    const { blob } = await render('png');
    await navigator.clipboard.write([new ClipboardItemClass({ 'image/png': blob })]);
    return 'Copied to the clipboard.';
  });

  onClick('share', 'Could not share', async (format) => {
    const { blob, name } = await render(format);
    const file = new FileClass([blob], name, { type: blob.type });
    await navigator.share({ files: [file], title: job.title });
    return 'Shared.';
  });

  syncButtons();
}
