// Test doubles for the browser APIs the extension uses. Not part of the application code.

export function fakeCtx() {
  const calls = [];
  const props = {};
  return new Proxy(
    {},
    {
      get: (_, name) => {
        if (name === 'calls') return calls;
        if (name === 'props') return props;
        if (name in props) return props[name];
        return (...args) => {
          calls.push([name, ...args]);
          return name === 'measureText' ? { width: args[0].length * 10 } : undefined;
        };
      },
      set: (_, name, value) => {
        props[name] = value;
        calls.push(['set', name, value]);
        return true;
      },
    },
  );
}

export class FakeStyle {
  constructor() {
    this.map = new Map();
  }

  setProperty(name, value, priority = '') {
    this.map.set(name, { value, priority });
  }

  removeProperty(name) {
    this.map.delete(name);
  }

  getPropertyValue(name) {
    return this.map.has(name) ? this.map.get(name).value : '';
  }

  getPropertyPriority(name) {
    return this.map.has(name) ? this.map.get(name).priority : '';
  }
}

export class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this.style = new FakeStyle();
    this.dataset = {};
    this.attrs = {};
    this.textContent = '';
    this.value = '';
    this.className = '';
    this.disabled = false;
    this.removed = false;
    this.clicks = 0;
    this.width = 0;
    this.height = 0;
    this.position = 'static';
    this.rect = { left: 0, top: 0, width: 100, height: 100 };
    this.ctx = fakeCtx();
  }

  addEventListener(type, listener) {
    (this.listeners[type] ??= []).push(listener);
  }

  removeEventListener(type, listener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((item) => item !== listener);
  }

  async emit(type, event = {}) {
    const full = { preventDefault() {}, stopPropagation() {}, pointerId: 1, ...event };
    for (const listener of this.listeners[type] ?? []) await listener(full);
    return full;
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }

  remove() {
    this.removed = true;
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
  }

  contains(node) {
    for (let current = node; current; current = current.parent) if (current === this) return true;
    return false;
  }

  setAttribute(name, value) {
    this.attrs[name] = value;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  setPointerCapture(id) {
    this.captured = id;
  }

  focus() {
    this.focused = true;
  }

  click() {
    this.clicks += 1;
  }

  getContext() {
    return this.ctx;
  }

  toBlob(callback, type) {
    callback(new Blob([new Uint8Array([1, 2, 3])], { type }));
  }
}

export class FakeDocument extends FakeElement {
  constructor() {
    super('document');
    this.title = '';
    this.byId = new Map();
    this.created = [];
    this.selectors = {};
    this.documentElement = new FakeElement('html');
    this.body = new FakeElement('body');
  }

  getElementById(id) {
    if (!this.byId.has(id)) this.byId.set(id, new FakeElement());
    return this.byId.get(id);
  }

  createElement(tag) {
    const element = new FakeElement(tag);
    this.created.push(element);
    return element;
  }

  querySelectorAll(selector) {
    return this.selectors[selector] ?? [];
  }
}

/** Lets pending promise chains run. */
export async function settle() {
  for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve));
}
