import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeDocument } from './helpers/fakes.js';
import { applyTheme } from '../src/theme.js';

function fakeMatchMedia(matches) {
  const listeners = [];
  const query = {
    matches,
    addEventListener: (type, listener) => listeners.push([type, listener]),
  };
  const matchMedia = (text) => {
    query.text = text;
    return query;
  };
  return { query, listeners, matchMedia };
}

test('applyTheme sets light when the system is light', () => {
  const doc = new FakeDocument();
  const { query, matchMedia } = fakeMatchMedia(false);
  applyTheme(doc, matchMedia);
  assert.equal(query.text, '(prefers-color-scheme: dark)');
  assert.equal(doc.documentElement.dataset.theme, 'light');
});

test('applyTheme sets dark when the system is dark and follows later changes', () => {
  const doc = new FakeDocument();
  const { query, listeners, matchMedia } = fakeMatchMedia(true);
  applyTheme(doc, matchMedia);
  assert.equal(doc.documentElement.dataset.theme, 'dark');
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0][0], 'change');
  query.matches = false;
  listeners[0][1]();
  assert.equal(doc.documentElement.dataset.theme, 'light');
});
