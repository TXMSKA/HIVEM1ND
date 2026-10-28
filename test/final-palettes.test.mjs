import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('every family look has a local palette and no remote asset requirement', async () => {
  const css = await readFile(new URL('../gui/app/styles.css', import.meta.url), 'utf8');
  for (const look of ['nebula', 'txmska', 'coffee-cat', 'ntk']) {
    const marker = '[data-look="' + look + '"]';
    const block = css.slice(css.indexOf(marker)).split('}')[0];
    assert.ok(block.includes('--accent:'));
    assert.ok(block.includes('--bg:'));
    assert.ok(block.includes('--mute:'));
  }
  // A local SVG data URL may include its XML namespace without requesting it.
  assert.equal(/@import\s+url|url\(\s*["']?https?:\/\//i.test(css), false);
});
