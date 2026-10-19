// Injected into the page on demand (classic script, no imports). Exposes globalThis.__shottr.
(() => {
  const SETTLE_MS = 250;
  const OVERLAY_GONE_MS = 120;
  const MIN_SELECTION = 5;
  const saved = { x: 0, y: 0, hidden: new Map() };

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function measure() {
    saved.x = window.scrollX;
    saved.y = window.scrollY;
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

  function restore() {
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

  // Resolves with {x, y, width, height} in viewport CSS pixels, or null when cancelled (Esc, or a too small drag).
  function selectArea() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:transparent;margin:0;padding:0;';
      const box = document.createElement('div');
      box.style.cssText =
        'position:fixed;display:none;box-sizing:border-box;border:1px solid #fff;outline:1px solid #000;' +
        'box-shadow:0 0 0 100vmax rgba(0,0,0,0.45);pointer-events:none;';
      const hint = document.createElement('div');
      hint.textContent = 'Drag to select an area. Esc cancels.';
      hint.style.cssText =
        'position:fixed;top:12px;left:50%;transform:translateX(-50%);padding:6px 10px;background:#fff;color:#000;' +
        'font:13px sans-serif;border:1px solid #000;pointer-events:none;';
      overlay.append(box, hint);
      document.documentElement.append(overlay);

      let start = null;
      const finish = async (rect) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
        await delay(OVERLAY_GONE_MS);
        resolve(rect);
      };
      const onKey = (event) => {
        if (event.key === 'Escape') finish(null);
      };
      document.addEventListener('keydown', onKey, true);

      const point = (event) => ({ x: event.clientX, y: event.clientY });
      overlay.addEventListener('pointerdown', (event) => {
        start = point(event);
        overlay.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      overlay.addEventListener('pointermove', (event) => {
        if (!start) return;
        box.style.display = 'block';
        place(box, between(start, point(event)));
      });
      overlay.addEventListener('pointerup', (event) => {
        if (!start) return;
        const rect = between(start, point(event));
        finish(rect.width >= MIN_SELECTION && rect.height >= MIN_SELECTION ? rect : null);
      });
    });
  }

  globalThis.__shottr = { measure, scrollTo, hideFixed, restore, selectArea };
})();
