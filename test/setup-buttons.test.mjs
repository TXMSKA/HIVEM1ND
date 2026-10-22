import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = (await readFile(new URL('../gui/styles.css', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const rule = selector => css.split('\n').find(line => line.startsWith(`${selector} {`)) ?? '';

test('every wizard button that acts is the accent color with hover and pressed shades', () => {
  const base = rule('.button');
  assert.match(base, /background: var\(--accent\)/);
  assert.match(base, /color: var\(--accent-ink\)/);
  assert.doesNotMatch(base, /card2|var\(--card\)/, 'no grey chip');
  assert.match(rule('.button:hover:not(:disabled)'), /var\(--accent-hover\)/);
  assert.match(rule('.button:active:not(:disabled)'), /var\(--accent-press\)/);
  assert.match(css, /--accent-hover: #[0-9a-f]{6}/);
  assert.match(css, /--accent-press: #[0-9a-f]{6}/);
});

test('Back and Cancel are quieter but keep a border', () => {
  const quiet = rule('.button.secondary, .button.ghost');
  assert.match(quiet, /background: transparent/);
  assert.match(quiet, /border-color: var\(--line2\)/);
  assert.match(rule('.button.secondary:hover:not(:disabled), .button.ghost:hover:not(:disabled)'), /border-color: var\(--accent\)/);
});
