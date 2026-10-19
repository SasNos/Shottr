import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { CAPTURE_INTERVAL_MS, MAX_PAGE_HEIGHT, callContent, createCapturer } from '../src/capture.js';

afterEach(() => {
  delete globalThis.__shottr;
});

const tab = { id: 7, windowId: 3, url: 'https://example.com/', title: 'Example' };

function setup({ metrics, selection = { x: 1, y: 2, width: 3, height: 4 }, failOn, cancelAfter = Infinity } = {}) {
  const log = [];
  const clock = { t: 10000 };
  const scrollPositions = [];
  let polls = 0;
  globalThis.__shottr = {
    measure: () => metrics ?? { viewportWidth: 1000, viewportHeight: 800, pageHeight: 800 },
    scrollTo: (y) => {
      scrollPositions.push(y);
      return y;
    },
    hideFixed: () => log.push('hideFixed'),
    isCancelled: () => polls++ >= cancelAfter,
    restore: () => log.push('restore'),
    selectArea: () => selection,
  };
  const chrome = {
    scripting: {
      executeScript: async (options) => {
        log.push(options.func ? `call:${options.args[0]}` : `inject:${options.files[0]}`);
        if (options.func) return [{ result: await options.func(...options.args) }];
        return [{}];
      },
    },
    tabs: {
      captureVisibleTab: async (windowId, options) => {
        log.push(`capture:${windowId}:${options.format}`);
        if (failOn === 'capture') throw new Error('capture failed');
        return `data:image/png;base64,${log.length}`;
      },
    },
  };
  const sleeps = [];
  const capturer = createCapturer({
    chrome,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.t += ms;
    },
    now: () => clock.t,
  });
  return { capturer, log, sleeps, clock, scrollPositions: () => scrollPositions };
}

test('callContent runs a function of the injected content script', () => {
  globalThis.__shottr = { echo: (a, b) => a + b };
  assert.equal(callContent('echo', [1, 2]), 3);
});

test('capture of the viewport takes one screenshot without cropping', async () => {
  const { capturer, log } = setup();
  const job = await capturer.capture(tab, 'viewport');
  assert.deepEqual(job, {
    mode: 'viewport',
    url: tab.url,
    title: tab.title,
    viewportWidth: 1000,
    tiles: [{ dataUrl: job.tiles[0].dataUrl, y: 0 }],
    crop: null,
    pageHeight: 0,
  });
  assert.deepEqual(
    log.filter((entry) => !entry.startsWith('call:measure')),
    ['inject:src/content.js', 'capture:3:png', 'call:restore', 'restore'],
  );
});

test('capture of an area stores the selection as crop', async () => {
  const { capturer } = setup();
  const job = await capturer.capture(tab, 'area');
  assert.deepEqual(job.crop, { x: 1, y: 2, width: 3, height: 4 });
  assert.equal(job.tiles.length, 1);
});

test('capture of an area returns null when the selection is cancelled and still restores the page', async () => {
  const { capturer, log } = setup({ selection: null });
  assert.equal(await capturer.capture(tab, 'area'), null);
  assert.ok(!log.some((entry) => entry.startsWith('capture:')));
  assert.ok(log.includes('restore'));
});

test('full page capture scrolls through the page and hides fixed elements after each tile', async () => {
  const { capturer, log, scrollPositions } = setup({
    metrics: { viewportWidth: 1000, viewportHeight: 800, pageHeight: 2000 },
  });
  const job = await capturer.capture(tab, 'full');
  assert.deepEqual(scrollPositions(), [0, 800, 1200]);
  assert.deepEqual(
    job.tiles.map((tile) => tile.y),
    [0, 800, 1200],
  );
  assert.equal(job.pageHeight, 2000);
  assert.equal(job.crop, null);
  assert.equal(log.filter((entry) => entry === 'hideFixed').length, 3);
  assert.equal(log.at(-1), 'restore');
});

test('Esc during a full page capture stops it, returns nothing and restores the page', async () => {
  const { capturer, log, scrollPositions } = setup({
    metrics: { viewportWidth: 1000, viewportHeight: 800, pageHeight: 3000 },
    cancelAfter: 1,
  });
  assert.equal(await capturer.capture(tab, 'full'), null);
  assert.deepEqual(scrollPositions(), [0]);
  assert.equal(log.filter((entry) => entry.startsWith('capture:')).length, 1);
  assert.equal(log.at(-1), 'restore');
});

test('full page capture limits very tall pages', async () => {
  const { capturer } = setup({ metrics: { viewportWidth: 1000, viewportHeight: 1000, pageHeight: 500000 } });
  const job = await capturer.capture(tab, 'full');
  assert.equal(job.pageHeight, MAX_PAGE_HEIGHT);
  assert.equal(job.tiles.length, MAX_PAGE_HEIGHT / 1000);
});

test('screenshots are spaced to stay below the capture rate limit', async () => {
  const { capturer, sleeps } = setup({ metrics: { viewportWidth: 1000, viewportHeight: 800, pageHeight: 1600 } });
  await capturer.capture(tab, 'full');
  assert.deepEqual(sleeps, [CAPTURE_INTERVAL_MS]);
});

test('capture restores the page when a screenshot fails', async () => {
  const { capturer, log } = setup({ failOn: 'capture' });
  await assert.rejects(capturer.capture(tab, 'viewport'), /capture failed/);
  assert.equal(log.at(-1), 'restore');
});
