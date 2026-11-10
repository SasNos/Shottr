// Tests of the style guide sync (tools/tokens.mjs). The same file exists in every tool that follows Mber Flow.
import { describe, test } from 'node:test';
import { expect } from './helpers/expect.js';
import {
  DEFAULT_SOURCE_DIRS,
  declarations,
  findSource,
  fontFiles,
  parseTheme,
  pickTokens,
  render,
  resolveValue,
  runTokens,
  splitTopLevel,
  topLevelBlocks,
} from '../tools/tokens.mjs';

const THEME = `/* palette */
@import './reset.css';
@font-face { font-family: 'Figtree'; src: url('./fonts/figtree.woff2') format('woff2'); }
@font-face { font-family: 'Open Sans'; src: url("fonts/open-sans.woff2") format('woff2'); }
:root { --color-1: #272c34; --color-2: #f0a35e; }
:root[data-theme="light"] { --color-1: #eeebea; --color-2: #7a6254; }
:root {
  --space-3: 8px;
  --ink: var(--color-1);
  --accent: var(--color-2);
  --font-2: 'Open Sans', system-ui;
  --font: var(--font-2);
  --shade: var(--missing, rgba(0, 0, 0, 0.5));
}
:root[data-theme='dark'] { --ink: #eae2df; }
:root[data-density='compact'] { --space-3: 6px; }
@media (max-width: 760px) { :root { --space-3: 4px; } }
:root[data-theme='dark'] .logo { fill: red; }
body { margin: 0; }
`;

const CONFIG = {
  output: 'src/theme.css',
  prefix: '',
  dark: 'attribute',
  fontDir: 'fonts',
  fontUrl: '../fonts/',
  tokens: ['--space-3', '--ink', '--accent', '--font'],
};
const FLOW_FONTS = 'flow/app/src/fonts';

/** An in-memory disk. Mber Flow lives in `flow` unless `flow: null`. */
function fakeIo({ files = {}, env = {}, flow = 'flow' } = {}) {
  const disk = { 'tokens.config.json': JSON.stringify(CONFIG), ...files };
  if (flow) {
    disk[`${flow}/app/src/theme.css`] = THEME;
    disk[`${flow}/app/package.json`] = JSON.stringify({ version: '1.19.0' });
    disk[`${flow}/app/src/fonts/figtree.woff2`] = 'F1';
    disk[`${flow}/app/src/fonts/open-sans.woff2`] = 'O1';
    disk[`${flow}/app/src/fonts/LICENSE-Figtree.txt`] = 'OFL';
  }
  const logs = [];
  return {
    disk,
    logs,
    env,
    resolve: (dir) => (dir === DEFAULT_SOURCE_DIRS[0] ? 'flow' : dir),
    read: (path) => disk[path] ?? null,
    fileHash: (path) => (path in disk ? `#${disk[path]}` : null),
    list: (dir) =>
      Object.keys(disk)
        .filter((path) => path.startsWith(`${dir}/`))
        .map((path) => path.slice(dir.length + 1)),
    write: (path, text) => {
      disk[path] = text;
    },
    copy: (from, to) => {
      if (!(from in disk)) throw new Error(`no ${from}`);
      disk[to] = disk[from];
    },
    remove: (path) => {
      delete disk[path];
    },
    hash: (text) => `h${text.length}`,
    log: (line) => logs.push(line),
  };
}

describe('reading the theme', () => {
  test('splits at a separator outside quotes and parentheses', () => {
    expect(splitTopLevel('a; url("x;y"); b(c;d); \'e;f\'', ';')).toEqual(['a', ' url("x;y")', ' b(c;d)', " 'e;f'"]);
  });

  test('splits top level blocks, keeps nested ones in their body and skips statements', () => {
    const blocks = topLevelBlocks('@layer base; a { b: 1 } @media x { c { d: 2 } } }');
    expect(blocks).toEqual([
      { prelude: 'a', body: ' b: 1 ' },
      { prelude: '@media x', body: ' c { d: 2 } ' },
    ]);
  });

  test('reads custom properties only, semicolons inside values included', () => {
    expect(declarations(' --a: 1px ; color: red; --b :\n  x   y ; --c: url("data:a;b")')).toEqual({
      '--a': '1px',
      '--b': 'x y',
      '--c': 'url("data:a;b")',
    });
  });

  test('takes the plain, light and dark roots and the font faces, nothing else', () => {
    const theme = parseTheme(THEME);
    expect(theme.base['--space-3']).toBe('8px');
    expect(theme.base['--color-1']).toBe('#272c34');
    expect(theme.light).toEqual({ '--color-1': '#eeebea', '--color-2': '#7a6254' });
    expect(theme.dark).toEqual({ '--ink': '#eae2df' });
    expect(theme.fontFaces).toHaveLength(2);
  });
});

describe('resolving values', () => {
  test('follows nested references and fallbacks, also fallbacks with parentheses', () => {
    const map = { '--a': 'var(--b)', '--b': '1px', '--c': 'red' };
    expect(resolveValue('0 var(--a) var(--x, 2px)', map)).toBe('0 1px 2px');
    expect(resolveValue('var(--x, rgba(0, 0, 0, 0.1))', map)).toBe('rgba(0, 0, 0, 0.1)');
    expect(resolveValue('var(--x, var(--c))', map)).toBe('red');
  });

  test('rejects unknown tokens, endless references and broken var()', () => {
    expect(() => resolveValue('var(--nope)', {})).toThrow('unknown token --nope');
    expect(() => resolveValue('var(--a)', { '--a': 'var(--a)' })).toThrow('too deep');
    expect(() => resolveValue('var(--a', {})).toThrow('unbalanced var()');
  });

  test('picks light and dark values of the listed tokens', () => {
    const tokens = pickTokens(parseTheme(THEME), ['--ink', '--accent', '--shade']);
    expect(tokens).toEqual([
      { name: '--ink', light: '#eeebea', dark: '#eae2df' },
      { name: '--accent', light: '#7a6254', dark: '#f0a35e' },
      { name: '--shade', light: 'rgba(0, 0, 0, 0.5)', dark: 'rgba(0, 0, 0, 0.5)' },
    ]);
  });

  test('names every token that Mber Flow does not have', () => {
    expect(() => pickTokens(parseTheme(THEME), ['--ink', '--gone', '--old'])).toThrow(
      'not in Mber Flow: --gone, --old',
    );
  });

  test('lists each font file once and rejects fonts from elsewhere', () => {
    expect(fontFiles(["src: url('./fonts/a.woff2')", 'src: url(fonts/b.woff2), url("./fonts/a.woff2")'])).toEqual([
      'a.woff2',
      'b.woff2',
    ]);
    expect(() => fontFiles(["src: url('/static/a.woff2')"])).toThrow("font outside Mber Flow's fonts folder");
  });
});

describe('rendering', () => {
  const theme = parseTheme(THEME);

  test('writes light tokens, dark differences and fonts at the configured place', () => {
    const css = render({ config: CONFIG, theme });
    expect(css).toMatch(/^\/\* Generated from Mber Flow's app\/src\/theme.css\. Do not edit/);
    expect(css).toContain("url('../fonts/figtree.woff2')");
    expect(css).toContain("url('../fonts/open-sans.woff2')");
    expect(css).toContain(
      ":root {\n  color-scheme: light;\n  --space-3: 8px;\n  --ink: #eeebea;\n  --accent: #7a6254;\n  --font: 'Open Sans', system-ui;\n}",
    );
    expect(css).toContain(
      ":root[data-theme='dark'] {\n  color-scheme: dark;\n  --ink: #eae2df;\n  --accent: #f0a35e;\n}\n",
    );
  });

  test('can prefix the names and use the system setting for dark, leaving the color scheme of the page alone', () => {
    const config = { ...CONFIG, prefix: 'hr-', dark: 'media', tokens: ['--ink'] };
    const css = render({ config, theme });
    expect(css).toContain(':root {\n  --hr-ink: #eeebea;\n}');
    expect(css).toContain('@media (prefers-color-scheme: dark) {\n  :root {\n    --hr-ink: #eae2df;\n  }\n}\n');
  });

  test('has no prefix when none is configured', () => {
    const { prefix, ...config } = CONFIG;
    expect(prefix).toBe('');
    expect(render({ config, theme })).toContain('\n  --ink: #eeebea;\n');
  });

  test('does not change when only comments or line endings of Mber Flow change', () => {
    const io = fakeIo();
    runTokens([], io);
    const first = io.disk['src/theme.css'];
    io.disk['flow/app/src/theme.css'] = `/* new comment */\r\n${THEME.replace(/\n/g, '\r\n')}`;
    expect(runTokens(['--check'], io)).toBe(0);
    expect(io.disk['src/theme.css']).toBe(first);
  });
});

describe('finding Mber Flow', () => {
  test('falls back to the default place when MBER_FLOW_DIR points nowhere', () => {
    expect(findSource(fakeIo({ env: { MBER_FLOW_DIR: 'nowhere' } }))).toBe('flow');
  });

  test('rejects font file names that would leave the fonts folder', () => {
    expect(() => fontFiles(["src: url('./fonts/../x.woff2')"])).toThrow('unsafe font file name');
    expect(() => fontFiles(["src: url('./fonts/a/b.woff2')"])).toThrow('unsafe font file name');
  });

  test('uses MBER_FLOW_DIR first', () => {
    const io = fakeIo({ flow: 'elsewhere', env: { MBER_FLOW_DIR: 'elsewhere' } });
    expect(findSource(io)).toBe('elsewhere');
  });

  test('looks next to the Spark folder by default', () => {
    expect(findSource(fakeIo())).toBe('flow');
  });

  test('is null when there is no theme', () => {
    expect(findSource(fakeIo({ flow: null }))).toBeNull();
  });
});

describe('running', () => {
  test('needs tokens.config.json', () => {
    const io = fakeIo();
    delete io.disk['tokens.config.json'];
    expect(runTokens([], io)).toBe(1);
    expect(io.logs).toEqual(['tokens.config.json is missing']);
  });

  test('writes the tokens, copies fonts and licenses, drops old fonts and records the hashes', () => {
    const io = fakeIo({ files: { 'fonts/old.woff2': 'X', 'fonts/README.txt': 'keep' } });
    expect(runTokens([], io)).toBe(0);
    const css = io.disk['src/theme.css'];
    expect(css).toContain('--accent: #7a6254;');
    expect(io.disk['fonts/figtree.woff2']).toBe('F1');
    expect(io.disk['fonts/open-sans.woff2']).toBe('O1');
    expect(io.disk['fonts/LICENSE-Figtree.txt']).toBe('OFL');
    expect(io.disk['fonts/old.woff2']).toBeUndefined();
    expect(io.disk['fonts/README.txt']).toBe('keep');
    expect(JSON.parse(io.disk['tokens.source.json'])).toEqual({
      version: '1.19.0',
      source: `h${THEME.length}`,
      output: `h${css.length}`,
    });
    expect(io.logs.some((line) => line.includes('DRIFT'))).toBe(false);
  });

  test('reports a drift when Mber Flow changed since the last sync', () => {
    const state = JSON.stringify({ version: '1.16.3', source: 'old', output: 'x' });
    const io = fakeIo({ files: { 'tokens.source.json': state } });
    expect(runTokens([], io)).toBe(0);
    expect(io.logs).toContain('STYLE GUIDE DRIFT: Mber Flow 1.16.3 -> 1.19.0');
  });

  test('changes nothing when a font cannot be copied', () => {
    const io = fakeIo();
    delete io.disk[`${FLOW_FONTS}/open-sans.woff2`];
    expect(runTokens([], io)).toBe(1);
    expect(io.logs.at(-1)).toBe(`cannot copy the fonts: no ${FLOW_FONTS}/open-sans.woff2`);
    expect(io.disk['src/theme.css']).toBeUndefined();
    expect(io.disk['tokens.source.json']).toBeUndefined();
  });

  test('passes the check when the file and the fonts are current', () => {
    const io = fakeIo();
    runTokens([], io);
    io.logs.length = 0;
    expect(runTokens(['--check'], io)).toBe(0);
    expect(io.logs).toEqual([]);
  });

  test('fails the check on a stale file, a missing, changed or extra font', () => {
    const io = fakeIo();
    runTokens([], io);
    io.disk['src/theme.css'] += '/* edited */';
    io.disk['fonts/figtree.woff2'] = 'F0';
    delete io.disk['fonts/open-sans.woff2'];
    io.disk['fonts/old.woff2'] = 'X';
    io.logs.length = 0;
    expect(runTokens(['--check'], io)).toBe(1);
    expect(io.logs).toEqual([
      'STYLE GUIDE DRIFT: src/theme.css does not match Mber Flow 1.19.0; run `npm run tokens`',
      'STYLE GUIDE DRIFT: fonts/figtree.woff2 is missing or differs from Mber Flow; run `npm run tokens`',
      'STYLE GUIDE DRIFT: fonts/open-sans.woff2 is missing or differs from Mber Flow; run `npm run tokens`',
      'STYLE GUIDE DRIFT: fonts/old.woff2 is no longer in Mber Flow; run `npm run tokens`',
    ]);
  });

  test('fails when a listed token is gone from Mber Flow', () => {
    const io = fakeIo();
    io.disk['tokens.config.json'] = JSON.stringify({ ...CONFIG, tokens: ['--gone'] });
    expect(runTokens([], io)).toBe(1);
    expect(io.logs).toEqual(['cannot generate src/theme.css: not in Mber Flow: --gone']);
  });

  test('records "unknown" when Mber Flow has no package.json', () => {
    const io = fakeIo();
    delete io.disk['flow/app/package.json'];
    runTokens([], io);
    expect(JSON.parse(io.disk['tokens.source.json']).version).toBe('unknown');
  });

  describe('without Mber Flow', () => {
    function synced() {
      const io = fakeIo();
      runTokens([], io);
      delete io.disk['flow/app/src/theme.css'];
      io.logs.length = 0;
      return io;
    }

    test('accepts the file the last sync wrote', () => {
      const io = synced();
      expect(runTokens(['--check'], io)).toBe(0);
      expect(runTokens([], io)).toBe(0);
      expect(io.logs[0]).toMatch(/^Mber Flow not found/);
    });

    test('rejects a hand-edited or missing file and a missing record', () => {
      const io = synced();
      io.disk['src/theme.css'] += ' ';
      expect(runTokens(['--check'], io)).toBe(1);
      expect(io.logs.at(-1)).toMatch(/edited by hand or is missing/);
      delete io.disk['src/theme.css'];
      expect(runTokens(['--check'], io)).toBe(1);
      const fresh = fakeIo({ flow: null, files: { 'src/theme.css': 'x' } });
      expect(runTokens(['--check'], fresh)).toBe(1);
    });
  });
});
