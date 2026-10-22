import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const KIT_PATH = path.resolve(import.meta.dirname, '..');

test('the kit ships the two-hexagon mark as its icon and its README logo', async () => {
  const icon = await readFile(path.join(KIT_PATH, 'assets', 'installer.ico'));
  assert.equal(icon.readUInt16LE(0), 0);
  assert.equal(icon.readUInt16LE(2), 1);
  const sizes = Array.from({ length: icon.readUInt16LE(4) }, (_, index) => icon[6 + index * 16] || 256);
  assert.ok(sizes.includes(256), `a 256 px image is present in ${sizes}`);
  const mark = await readFile(path.join(KIT_PATH, 'assets', 'mark.svg'), 'utf8');
  const favicon = await readFile(path.join(KIT_PATH, 'gui', 'app', 'favicon.svg'), 'utf8');
  for (const hexagon of favicon.match(/d="[^"]+"/g)) assert.ok(mark.includes(hexagon), `mark.svg holds ${hexagon}`);
  assert.equal(mark.includes('M72 65'), false, 'the old H is gone');
});
