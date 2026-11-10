// The UI Shottr puts into web pages (selection bar in content.js, toast in hosts/chrome-page.js) cannot load
// theme.css, so it carries copies of a few Mber Flow tokens. These tests keep the copies equal to the generated
// theme.css, so `npm run tokens` plus a red test shows every value to update after a style guide change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseTheme, pickTokens } from '../tools/tokens.mjs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const compact = (value) => value.replace(/\s+/g, '');
const NAMES = { panel: '--panel', ink: '--ink', onInk: '--on-ink', line: '--line', sel: '--sel', shadow: '--shadow' };
const tokens = pickTokens(parseTheme(read('src/theme.css')), Object.values(NAMES));
const expected = (mode) => Object.fromEntries(tokens.map((t) => [t.name, compact(t[mode])]));

test('the selection UI in content.js uses the theme.css values for light and dark', () => {
  const source = read('src/content.js');
  const themes = source.slice(source.indexOf('const THEMES = {'), source.indexOf('const theme = ()'));
  for (const mode of ['light', 'dark']) {
    const block = themes.match(new RegExp(`${mode}: \\{([^}]*)\\}`))[1];
    const values = Object.fromEntries(
      [...block.matchAll(/(\w+): '([^']*)'/g)].map((m) => [NAMES[m[1]], compact(m[2])]),
    );
    assert.deepEqual(values, expected(mode));
  }
});

test('the toast in chrome-page.js uses the theme.css values for ink, on-ink and shadow', () => {
  const source = read('src/hosts/chrome-page.js');
  const [, dark, light] = source.match(/\? \[([^\]]*)\]\s*: \[([^\]]*)\]/);
  const values = (list) => [...list.matchAll(/'([^']*)'/g)].map((m) => compact(m[1]));
  for (const [mode, list] of [
    ['dark', dark],
    ['light', light],
  ]) {
    const want = expected(mode);
    assert.deepEqual(values(list), [want['--ink'], want['--on-ink'], want['--shadow']]);
  }
});
