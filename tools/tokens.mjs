// Style guide sync. Mber Flow (Tools\Mber Web\Mber Flow, app/src/theme.css and app/src/fonts) is the one source of
// the look of every Spark tool; this file is identical in each tool that follows it (Shottr, Site Restyler, Honest
// Ratings), so a fix here is copied to the others. The tool lists the tokens it needs in tokens.config.json.
//
//   npm run tokens         regenerate the token file and the fonts from Mber Flow, report a style guide drift
//   npm run tokens:check   fail when the token file or the fonts are out of date (Mber Flow present) or the token
//                          file was edited by hand (Mber Flow absent)
//
// Mber Flow is looked up in MBER_FLOW_DIR, else next to the Spark folder (../../../Mber Web/Mber Flow).
// All decisions are pure functions over an `io` object, so they are tested without touching the disk.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_SOURCE_DIRS = ['../../../Mber Web/Mber Flow'];
export const STATE_FILE = 'tokens.source.json';
const THEME = 'app/src/theme.css';
const FONTS = 'app/src/fonts';
// A font of Mber Flow: url('./fonts/x.woff2'), url("fonts/x.woff2") or url(fonts/x.woff2).
const FONT_URL = /url\(\s*(['"]?)(?:\.\/)?fonts\/([^'")]+)\1\s*\)/g;
const HEADER =
  "/* Generated from Mber Flow's app/src/theme.css. Do not edit: `npm run tokens` regenerates it (tools/tokens.mjs, " +
  'tokens.config.json). */';

/** Removes CSS comments. */
export const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Splits `text` at `separator`, but not inside quotes or parentheses. */
export function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * Top level blocks of a stylesheet: `[{ prelude, body }]`; nested blocks (media queries) stay in their body, and
 * statements such as `@import ...;` or `@layer x;` before a block do not end up in its prelude.
 */
export function topLevelBlocks(css) {
  const blocks = [];
  let depth = 0;
  let start = 0;
  let open = -1;
  for (let i = 0; i < css.length; i += 1) {
    if (css[i] === '{') {
      if (depth === 0) open = i;
      depth += 1;
    } else if (css[i] === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        blocks.push({ prelude: css.slice(start, open).trim(), body: css.slice(open + 1, i) });
        start = i + 1;
      }
    } else if (css[i] === ';' && depth === 0) start = i + 1;
  }
  return blocks;
}

/** `{ name: value }` for every custom property declared in a block body. */
export function declarations(body) {
  const out = {};
  for (const part of splitTopLevel(body, ';')) {
    const match = part.match(/^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/);
    if (match) out[match[1]] = match[2].replace(/\s+/g, ' ');
  }
  return out;
}

/**
 * Reads Mber Flow's theme.css: the custom properties of the plain `:root` blocks (`base`), of the light and of the
 * dark theme, and the `@font-face` rules. Everything else (media queries, density variants, rules) is left out.
 */
export function parseTheme(css) {
  const theme = { base: {}, light: {}, dark: {}, fontFaces: [] };
  for (const { prelude, body } of topLevelBlocks(stripComments(css))) {
    const selector = prelude.replace(/"/g, "'").replace(/\s+/g, '');
    if (selector === '@font-face') theme.fontFaces.push(body.trim().replace(/\s+/g, ' '));
    else if (selector === ':root') Object.assign(theme.base, declarations(body));
    else if (selector === ":root[data-theme='light']") Object.assign(theme.light, declarations(body));
    else if (selector === ":root[data-theme='dark']") Object.assign(theme.dark, declarations(body));
  }
  return theme;
}

/** Replaces the first `var(--name)` or `var(--name, fallback)` (fallbacks may hold parentheses and other `var()`). */
function replaceFirstVar(value, map) {
  const at = value.indexOf('var(');
  let depth = 0;
  let end = at + 3;
  do {
    if (value[end] === '(') depth += 1;
    else if (value[end] === ')') depth -= 1;
    end += 1;
  } while (depth > 0 && end < value.length);
  if (depth > 0) throw new Error(`unbalanced var(): ${value}`);
  const [name, ...rest] = splitTopLevel(value.slice(at + 4, end - 1), ',');
  const key = name.trim();
  let replacement;
  if (key in map) replacement = map[key];
  else if (rest.length) replacement = rest.join(',').trim();
  else throw new Error(`unknown token ${key}`);
  return value.slice(0, at) + replacement + value.slice(end);
}

/** Replaces every `var()` by its value until only literal values are left. */
export function resolveValue(value, map) {
  let result = value;
  for (let step = 0; result.includes('var('); step += 1) {
    if (step > 64) throw new Error(`token reference too deep: ${value}`);
    result = replaceFirstVar(result, map);
  }
  return result;
}

/** The literal light and dark values of the listed tokens. */
export function pickTokens(theme, names) {
  const light = { ...theme.base, ...theme.light };
  const dark = { ...theme.base, ...theme.dark };
  const missing = names.filter((name) => !(name in light));
  if (missing.length) throw new Error(`not in Mber Flow: ${missing.join(', ')}`);
  return names.map((name) => ({
    name,
    light: resolveValue(light[name], light),
    dark: resolveValue(dark[name], dark),
  }));
}

/** The font files named in the `@font-face` rules, in order, without repeats. Other font URLs are an error. */
export function fontFiles(fontFaces) {
  for (const rule of fontFaces) {
    const other = rule.replace(FONT_URL, '').match(/url\([^)]*\)/);
    if (other) throw new Error(`font outside Mber Flow's fonts folder: ${other[0]}`);
  }
  const files = fontFaces.flatMap((rule) => [...rule.matchAll(FONT_URL)].map((m) => m[2]));
  const unsafe = files.find((file) => /\.\.|[\\/]/.test(file));
  if (unsafe) throw new Error(`unsafe font file name: ${unsafe}`);
  return [...new Set(files)];
}

/**
 * The generated stylesheet: header, font faces (pointing at `config.fontUrl`), light tokens, dark tokens. It depends
 * only on the tokens, not on comments or the version of Mber Flow. With `dark: 'attribute'` the tool owns its page
 * (`data-theme` on <html>), so `color-scheme` is set as in Mber Flow; with `dark: 'media'` the tokens go into someone
 * else's page (a content script) and only custom properties are written.
 */
export function render({ config, theme }) {
  const prefix = config.prefix ?? '';
  const owned = config.dark !== 'media';
  const tokens = pickTokens(theme, config.tokens);
  const rename = (name) => `--${prefix}${name.slice(2)}`;
  const lines = [HEADER];
  for (const rule of theme.fontFaces) {
    lines.push(`@font-face { ${rule.replace(FONT_URL, (whole, quote, file) => `url('${config.fontUrl}${file}')`)} }`);
  }
  const light = tokens.map((t) => `${rename(t.name)}: ${t.light};`);
  const dark = tokens.filter((t) => t.dark !== t.light).map((t) => `${rename(t.name)}: ${t.dark};`);
  if (owned) {
    light.unshift('color-scheme: light;');
    dark.unshift('color-scheme: dark;');
  }
  lines.push(':root {', ...light.map((d) => `  ${d}`), '}');
  if (owned) lines.push(":root[data-theme='dark'] {", ...dark.map((d) => `  ${d}`), '}');
  else lines.push('@media (prefers-color-scheme: dark) {', '  :root {', ...dark.map((d) => `    ${d}`), '  }', '}');
  return `${lines.join('\n')}\n`;
}

/** The first Mber Flow folder that has a theme.css: MBER_FLOW_DIR first, then the default places. */
export function findSource(io) {
  const dirs = [io.env.MBER_FLOW_DIR, ...DEFAULT_SOURCE_DIRS].filter(Boolean);
  return dirs.map((dir) => io.resolve(dir)).find((dir) => io.read(`${dir}/${THEME}`) !== null) ?? null;
}

const readJson = (io, path) => {
  const text = io.read(path);
  return text === null ? null : JSON.parse(text);
};

/** What is wrong with the fonts in `fontDir`: missing or different files, and fonts Mber Flow no longer has. */
function fontProblems(io, source, fontDir, files) {
  const problems = files
    .filter((file) => io.fileHash(`${fontDir}/${file}`) !== io.fileHash(`${source}/${FONTS}/${file}`))
    .map((file) => `${fontDir}/${file} is missing or differs from Mber Flow`);
  const extra = io.list(fontDir).filter((file) => file.endsWith('.woff2') && !files.includes(file));
  return [...problems, ...extra.map((file) => `${fontDir}/${file} is no longer in Mber Flow`)];
}

/** Runs the sync (`[]`) or the check (`['--check']`) and returns the exit code. */
export function runTokens(args, io) {
  const check = args.includes('--check');
  const config = readJson(io, 'tokens.config.json');
  if (!config) {
    io.log('tokens.config.json is missing');
    return 1;
  }
  const state = readJson(io, STATE_FILE);
  const current = io.read(config.output);
  const source = findSource(io);

  if (!source) {
    // Without Mber Flow only hand edits can be found: the file must be exactly what the last sync wrote.
    io.log('Mber Flow not found (set MBER_FLOW_DIR); checking the generated file against its recorded hash only');
    if (current === null || !state || io.hash(current) !== state.output) {
      io.log(`${config.output} was edited by hand or is missing: run \`npm run tokens\` with Mber Flow next to Spark`);
      return 1;
    }
    return 0;
  }

  // Line endings depend on the checkout, so they do not count as a change.
  const css = io.read(`${source}/${THEME}`).replace(/\r\n/g, '\n');
  const sourceHash = io.hash(css);
  const version = readJson(io, `${source}/app/package.json`)?.version ?? 'unknown';
  let text;
  let files;
  try {
    const theme = parseTheme(css);
    text = render({ config, theme });
    files = fontFiles(theme.fontFaces);
  } catch (error) {
    io.log(`cannot generate ${config.output}: ${error.message}`);
    return 1;
  }

  if (check) {
    const problems = fontProblems(io, source, config.fontDir, files);
    if (text !== current) problems.unshift(`${config.output} does not match Mber Flow ${version}`);
    for (const problem of problems) io.log(`STYLE GUIDE DRIFT: ${problem}; run \`npm run tokens\``);
    return problems.length ? 1 : 0;
  }

  if (state && state.source !== sourceHash) io.log(`STYLE GUIDE DRIFT: Mber Flow ${state.version} -> ${version}`);
  try {
    // Fonts first: when a copy fails, the token file and the record stay as they were.
    const licenses = io.list(`${source}/${FONTS}`).filter((file) => /^LICENSE/i.test(file));
    for (const file of [...files, ...licenses]) io.copy(`${source}/${FONTS}/${file}`, `${config.fontDir}/${file}`);
    for (const file of io.list(config.fontDir)) {
      if (file.endsWith('.woff2') && !files.includes(file)) io.remove(`${config.fontDir}/${file}`);
    }
  } catch (error) {
    io.log(`cannot copy the fonts: ${error.message}`);
    return 1;
  }
  io.write(config.output, text);
  io.write(STATE_FILE, `${JSON.stringify({ version, source: sourceHash, output: io.hash(text) }, null, 2)}\n`);
  io.log(`${config.output} written from Mber Flow ${version}`);
  return 0;
}

// Disk binding (not unit tested: real files, real hash). Runs only when the file is started as a script; the ignore
// hints exclude it from the coverage of Vitest (c8) and of `node --test` (node:coverage).
/* c8 ignore start */
/* node:coverage disable */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const at = (path) => resolve(root, path);
  const sha256 = (data) => createHash('sha256').update(data).digest('hex');
  process.exitCode = runTokens(process.argv.slice(2), {
    env: process.env,
    resolve: (dir) => resolve(root, dir).replace(/\\/g, '/'),
    read: (path) => (existsSync(at(path)) ? readFileSync(at(path), 'utf8') : null),
    fileHash: (path) => (existsSync(at(path)) ? sha256(readFileSync(at(path))) : null),
    list: (dir) => (existsSync(at(dir)) ? readdirSync(at(dir)) : []),
    write: (path, text) => {
      mkdirSync(dirname(at(path)), { recursive: true });
      writeFileSync(at(path), text, 'utf8');
    },
    copy: (from, to) => {
      mkdirSync(dirname(at(to)), { recursive: true });
      copyFileSync(at(from), at(to));
    },
    remove: (path) => rmSync(at(path)),
    hash: sha256,
    log: (line) => console.log(`[tokens] ${line}`),
  });
}
/* node:coverage enable */
/* c8 ignore stop */
