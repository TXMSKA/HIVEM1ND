import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('status shapes remain distinguishable without their colors', async () => {
  const css = await readFile(new URL('../gui/app/styles.css', import.meta.url), 'utf8');
  const block = (selector) => css.slice(css.indexOf(selector)).split('}')[0];
  assert.ok(block('.status-dot {').includes('1.5px'));
  assert.ok(block('.status-dot[data-status="waiting"]').includes('2px'));
  assert.ok(block('.status-dot[data-status="working"]').includes('box-shadow: none'));
  assert.ok(block('.map-status[data-status="idle"]').includes('1.5px'));
  assert.ok(block('.map-status[data-status="working"]').includes('box-shadow: none'));
});
