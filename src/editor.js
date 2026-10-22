import { Annotations, drawAnnotations, drawSegment } from './annotations.js';
import { buildFileName, canShareFiles, encode, flatten, triggerDownload } from './export.js';
import { composeImage } from './stitch.js';

/**
 * Shows the captured window fitted into the view (never enlarged), lets the user select an area on it and returns
 * that area in CSS px of the capture, clipped to the image, or null when cancelled or outside the image. Copy in the
 * selection bar adds `copy: true`.
 */
async function pickArea(job, { document, loadImage, selectArea, view }) {
  const { dataUrl } = job.tiles[0];
  const image = await loadImage(dataUrl);
  const width = job.viewportWidth;
  const height = image.height / (image.width / width);
  const scale = Math.min(1, view.innerWidth / width, view.innerHeight / height);
  const left = (view.innerWidth - width * scale) / 2;
  const top = (view.innerHeight - height * scale) / 2;
  const picture = document.createElement('img');
  picture.className = 'pick';
  picture.alt = '';
  picture.src = dataUrl;
  Object.assign(picture.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width * scale}px`,
    height: `${height * scale}px`,
  });
  document.body.append(picture);
  const rect = await selectArea();
  picture.remove();
  if (!rect) return null;
  const copy = rect.copy ? { copy: true } : {};
  const x = Math.max(0, (rect.x - left) / scale);
  const y = Math.max(0, (rect.y - top) / scale);
  const right = Math.min(width, (rect.x + rect.width - left) / scale);
  const bottom = Math.min(height, (rect.y + rect.height - top) / scale);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y, ...copy };
}

/**
 * Wires up the editor page: preview, pen, shapes and comments, undo/redo, and saving, copying and sharing.
 * Sizes the user picks (stroke width, font size) are CSS pixels of the captured page; they are multiplied by
 * `ratio` (image pixels per CSS pixel) for drawing.
 *
 * `host` connects the editor to where it runs (hosts/chrome-editor.js in the extension, Spark's own host there):
 * `loadJob()` returns the capture job or null, `confirmDiscard(message)` resolves to true when the user agrees to
 * throw the annotations away, `close()` closes the editor.
 *
 * A job with `select` (a whole window, "Selected area with DevTools") is shown first fitted into `view`
 * (`innerWidth`, `innerHeight`), and `selectArea()` (content.js) picks the part that goes into the editor.
 */
export async function initEditor({
  document,
  host,
  loadImage,
  createCanvas,
  urlApi,
  now,
  navigator,
  FileClass,
  ClipboardItemClass,
  selectArea,
  view,
}) {
  const $ = (id) => document.getElementById(id);
  const say = (text) => {
    $('status').textContent = text;
  };

  let job = await host.loadJob();
  if (!job) {
    say('No capture found. Start a new capture from the Shottr toolbar button.');
    return;
  }
  let copyNow = false;
  if (job.select) {
    const picked = await pickArea(job, { document, loadImage, selectArea, view });
    if (!picked) {
      await host.close();
      return;
    }
    const { copy, ...crop } = picked;
    copyNow = Boolean(copy);
    job = { ...job, crop, select: false };
  }

  const { canvas: base, ratio } = await composeImage(job, { loadImage, createCanvas });
  const overlay = createCanvas(base.width, base.height);
  const ctx = overlay.getContext('2d');

  document.title = `Shottr: ${job.title}`;
  base.className = 'layer';
  overlay.className = 'layer overlay';
  const wrap = $('wrap');
  // Shown at the size of the original page: one CSS pixel of the page is one CSS pixel here.
  wrap.style.width = `${base.width / ratio}px`;
  wrap.style.height = `${base.height / ratio}px`;
  wrap.append(base, overlay);
  say(job.notice ?? `${base.width} × ${base.height} px`);
  $('share').hidden = !canShareFiles(navigator, FileClass);

  const notes = new Annotations();
  let tool = 'pen';
  let color = $('color-picker').value;
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

  $('color-picker').addEventListener('input', () => {
    color = $('color-picker').value;
  });

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
        event.stopPropagation();
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

  const copyToClipboard = async () => {
    const { blob } = await render('png');
    await navigator.clipboard.write([new ClipboardItemClass({ 'image/png': blob })]);
    return 'Copied to the clipboard.';
  };
  onClick('copy', 'Could not copy', copyToClipboard);

  onClick('share', 'Could not share', async (format) => {
    const { blob, name } = await render(format);
    const file = new FileClass([blob], name, { type: blob.type });
    await navigator.share({ files: [file], title: job.title });
    return 'Shared.';
  });

  // Cancel closes the editor; annotations are only discarded after the user confirms.
  const cancel = async () => {
    finishEditing();
    if (notes.canUndo && !(await host.confirmDiscard('Discard this screenshot and your annotations?'))) return;
    await host.close();
  };
  $('cancel').addEventListener('click', cancel);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') cancel();
  });

  syncButtons();

  // Copy in the selection bar on a window capture: copy the area and close, like Copy on the page.
  if (copyNow) {
    try {
      await copyToClipboard();
      await host.close();
    } catch (error) {
      say(`Could not copy: ${error.message}`);
    }
  }
}
