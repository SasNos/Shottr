// Injected into the page on demand (classic script, no imports). Exposes globalThis.__shottr.
(() => {
  const SETTLE_MS = 250;
  const OVERLAY_GONE_MS = 120;
  const MIN_SELECTION = 5;
  const saved = { x: 0, y: 0, hidden: new Map(), cancelled: false, copy: null };

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // The clipboard accepts a write only during the user's click or key press, which is long over once the service
  // worker has the picture. So Copy starts the write right away with a promised PNG, and the service worker hands the
  // PNG over later through takeCopy(). `written` resolves with null or the error of the write. Pages without the
  // clipboard API (http) get no write; the service worker then copies in the editor instead.
  function startCopy() {
    if (!navigator.clipboard) return;
    let resolve;
    const png = new Promise((done) => (resolve = done));
    const written = navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(
      () => null,
      (error) => error,
    );
    saved.copy = { resolve, written };
  }

  function takeCopy() {
    const copy = saved.copy;
    saved.copy = null;
    return copy;
  }

  // Esc on the page aborts a running full page capture; capture.js polls isCancelled().
  const onCancelKey = (event) => {
    if (event.key === 'Escape') saved.cancelled = true;
  };

  function measure() {
    saved.x = window.scrollX;
    saved.y = window.scrollY;
    saved.cancelled = false;
    document.removeEventListener('keydown', onCancelKey, true);
    document.addEventListener('keydown', onCancelKey, true);
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      pageHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    };
  }

  async function scrollTo(y) {
    window.scrollTo(0, y);
    await delay(SETTLE_MS);
    return window.scrollY;
  }

  // Fixed and sticky elements (headers, cookie bars) would repeat in every tile, so they are hidden after the first one.
  function hideFixed() {
    for (const element of document.querySelectorAll('*')) {
      const position = getComputedStyle(element).position;
      if ((position === 'fixed' || position === 'sticky') && !saved.hidden.has(element)) {
        saved.hidden.set(element, {
          value: element.style.getPropertyValue('visibility'),
          priority: element.style.getPropertyPriority('visibility'),
        });
        element.style.setProperty('visibility', 'hidden', 'important');
      }
    }
  }

  const isCancelled = () => saved.cancelled;

  function restore() {
    document.removeEventListener('keydown', onCancelKey, true);
    for (const [element, previous] of saved.hidden) {
      if (previous.value) element.style.setProperty('visibility', previous.value, previous.priority);
      else element.style.removeProperty('visibility');
    }
    saved.hidden.clear();
    window.scrollTo(saved.x, saved.y);
  }

  const place = (element, rect) => {
    element.style.left = `${rect.x}px`;
    element.style.top = `${rect.y}px`;
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
  };

  const between = (a, b) => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  });

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  // Moves the edges named by `handle` (n, s, e, w or a corner such as "nw") by dx/dy; dragging past the opposite edge flips.
  function resizeRect(start, handle, dx, dy) {
    let left = start.x;
    let top = start.y;
    let right = start.x + start.width;
    let bottom = start.y + start.height;
    if (handle.includes('w')) left += dx;
    if (handle.includes('e')) right += dx;
    if (handle.includes('n')) top += dy;
    if (handle.includes('s')) bottom += dy;
    const inside = (x, y) => ({ x: clamp(x, 0, window.innerWidth), y: clamp(y, 0, window.innerHeight) });
    return between(inside(left, top), inside(right, bottom));
  }

  const moveRect = (start, dx, dy) => ({
    ...start,
    x: clamp(start.x + dx, 0, window.innerWidth - start.width),
    y: clamp(start.y + dy, 0, window.innerHeight - start.height),
  });

  const HANDLE_POSITIONS = {
    nw: 'left:0;top:0;cursor:nwse-resize;',
    n: 'left:50%;top:0;cursor:ns-resize;',
    ne: 'left:100%;top:0;cursor:nesw-resize;',
    e: 'left:100%;top:50%;cursor:ew-resize;',
    se: 'left:100%;top:100%;cursor:nwse-resize;',
    s: 'left:50%;top:100%;cursor:ns-resize;',
    sw: 'left:0;top:100%;cursor:nesw-resize;',
    w: 'left:0;top:50%;cursor:ew-resize;',
  };
  const DRAW_HINT = 'Drag to select an area. Esc cancels.';
  const ADJUST_HINT = 'Drag the handles to resize, drag inside to move. Enter captures, Ctrl+C copies, Esc cancels.';
  // The selection UI lives in the page, where theme.css is not loaded, so it carries the Mber Flow values itself
  // (--panel, --ink, --on-ink, --line, --sel, --shadow for light and dark; --h-bar 32 px, --radius-ctl 8 px, --fs-md 13 px,
  // 4 px grid). The frame and the handles stay black and white so they are visible on any page.
  const THEMES = {
    light: {
      panel: '#fbf9f6',
      ink: '#3d434f',
      onInk: '#ffffff',
      line: '#dcd5cf',
      sel: '#c8501f',
      shadow: '0 1px 2px rgba(61,67,79,0.08),0 8px 24px rgba(61,67,79,0.12)',
    },
    dark: {
      panel: '#2a2e36',
      ink: '#ede1d8',
      onInk: '#23262d',
      line: '#454a55',
      sel: '#f0a35e',
      shadow: '0 1px 2px rgba(0,0,0,0.3),0 8px 24px rgba(0,0,0,0.35)',
    },
  };
  const theme = () => THEMES[window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'];
  const buttonCss = (border, background, color) =>
    `height:32px;padding:0 12px;border:1px solid ${border};border-radius:8px;background:${background};` +
    `color:${color};font:600 13px/1 system-ui,sans-serif;cursor:pointer;`;
  const BAR_WIDTH = 240;
  const BAR_HEIGHT = 32;

  // Lets the user draw a frame, then adjust it (resize, move, redraw) before confirming with Enter or the Capture button.
  // Resolves with {x, y, width, height} in viewport CSS pixels, or null when cancelled. The Copy button (or Ctrl+C,
  // Cmd+C) resolves with the same rectangle plus `copy: true`: the area goes to the clipboard instead of the editor.
  function selectArea() {
    return new Promise((resolve) => {
      const t = theme();
      const create = (css) => {
        const element = document.createElement('div');
        element.style.cssText = css;
        return element;
      };
      const overlay = create(
        'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:transparent;margin:0;padding:0;',
      );
      const box = create(
        'position:fixed;display:none;box-sizing:border-box;border:1px solid #fff;outline:1px solid #000;' +
          'box-shadow:0 0 0 100vmax rgba(0,0,0,0.45);cursor:move;',
      );
      for (const [name, position] of Object.entries(HANDLE_POSITIONS)) {
        const handle = create(
          'position:absolute;width:12px;height:12px;box-sizing:border-box;background:#fff;border:1px solid #000;' +
            `transform:translate(-50%,-50%);${position}`,
        );
        handle.dataset.handle = name;
        box.append(handle);
      }
      const hint = create(
        'position:fixed;top:12px;left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100vw - 32px);' +
          `padding:4px 12px;background:${t.panel};color:${t.ink};font:13px/1.45 system-ui,sans-serif;` +
          `border:1px solid ${t.line};border-radius:8px;box-shadow:${t.shadow};pointer-events:none;`,
      );
      const bar = create('position:fixed;display:none;gap:8px;');
      const captureButton = document.createElement('button');
      captureButton.textContent = 'Capture';
      captureButton.style.cssText = buttonCss(t.ink, t.ink, t.onInk);
      const copyButton = document.createElement('button');
      copyButton.textContent = 'Copy';
      copyButton.style.cssText = buttonCss(t.line, t.panel, t.ink);
      const cancelButton = document.createElement('button');
      cancelButton.textContent = 'Cancel';
      cancelButton.style.cssText = buttonCss(t.line, t.panel, t.ink);
      // Inline styles cannot express :focus-visible, so the focus ring of the style guide (2 px --sel) comes from a
      // style element that lives in the overlay and leaves the page with it.
      const focusStyle = document.createElement('style');
      focusStyle.textContent =
        '[data-shottr="button"]{outline:none}' +
        `[data-shottr="button"]:focus-visible{outline:2px solid ${t.sel};outline-offset:2px}`;
      for (const button of [captureButton, copyButton, cancelButton]) button.dataset.shottr = 'button';
      bar.append(captureButton, copyButton, cancelButton);
      overlay.append(box, hint, bar, focusStyle);
      document.documentElement.append(overlay);

      let rect = null;
      let mode = null;

      const render = () => {
        box.style.display = rect ? 'block' : 'none';
        bar.style.display = rect && !mode ? 'flex' : 'none';
        hint.textContent = rect ? ADJUST_HINT : DRAW_HINT;
        if (rect) {
          place(box, rect);
          bar.style.left = `${clamp(rect.x, 8, window.innerWidth - BAR_WIDTH)}px`;
          bar.style.top = `${clamp(rect.y + rect.height + 8, 8, window.innerHeight - BAR_HEIGHT - 8)}px`;
        }
      };
      const finish = async (result) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
        await delay(OVERLAY_GONE_MS);
        resolve(result);
      };
      const valid = () => rect && rect.width >= MIN_SELECTION && rect.height >= MIN_SELECTION;
      const confirm = () => {
        if (valid()) finish({ ...rect });
      };
      const copy = () => {
        if (!valid()) return;
        startCopy();
        finish({ ...rect, copy: true });
      };
      const onKey = (event) => {
        if (event.key === 'Escape') finish(null);
        else if (event.key === 'Enter') confirm();
        else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') copy();
        else return;
        event.preventDefault();
        event.stopPropagation();
      };
      document.addEventListener('keydown', onKey, true);
      captureButton.addEventListener('click', () => confirm());
      copyButton.addEventListener('click', copy);
      cancelButton.addEventListener('click', () => finish(null));
      box.addEventListener('dblclick', () => confirm());
      bar.addEventListener('pointerdown', (event) => event.stopPropagation());

      const point = (event) => ({
        x: clamp(event.clientX, 0, window.innerWidth),
        y: clamp(event.clientY, 0, window.innerHeight),
      });
      overlay.addEventListener('pointerdown', (event) => {
        const from = point(event);
        const handle = event.target.dataset.handle;
        if (rect && handle) mode = { kind: 'resize', handle, start: rect, from };
        else if (rect && event.target === box) mode = { kind: 'move', start: rect, from };
        else {
          rect = null;
          mode = { kind: 'new', from };
        }
        overlay.setPointerCapture(event.pointerId);
        event.preventDefault();
        render();
      });
      overlay.addEventListener('pointermove', (event) => {
        if (!mode) return;
        const to = point(event);
        if (mode.kind === 'new') rect = between(mode.from, to);
        else if (mode.kind === 'move') rect = moveRect(mode.start, to.x - mode.from.x, to.y - mode.from.y);
        else rect = resizeRect(mode.start, mode.handle, to.x - mode.from.x, to.y - mode.from.y);
        render();
      });
      overlay.addEventListener('pointerup', () => {
        if (!mode) return;
        if (mode.kind === 'new' && rect && (rect.width < MIN_SELECTION || rect.height < MIN_SELECTION)) rect = null;
        mode = null;
        render();
      });
      render();
    });
  }

  globalThis.__shottr = { measure, scrollTo, hideFixed, isCancelled, restore, selectArea, takeCopy };
})();
