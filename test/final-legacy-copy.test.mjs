import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { copyLegacyTree } from '../engine/legacy-copy.mjs';

test('legacy copying preserves source bytes and timestamps and refuses an existing target', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-copy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'legacy');
  const destination = path.join(root, 'copy');
  await mkdir(path.join(source, 'user'), { recursive: true });
  const file = path.join(source, 'user', 'record.md');
  await writeFile(file, Buffer.from('unit: user\r\n\r\nKeep these bytes.\r\n'));
  const before = await readFile(file);
  const time = (await stat(file)).mtimeMs;
  assert.deepEqual(await copyLegacyTree(source, destination), { files: 1 });
  assert.deepEqual(await readFile(path.join(destination, 'user', 'record.md')), before);
  assert.deepEqual(await readFile(file), before);
  assert.equal((await stat(file)).mtimeMs, time);
  await assert.rejects(copyLegacyTree(source, destination), { code: 'EEXIST' });
  await assert.rejects(copyLegacyTree(source, path.join(source, 'nested')), { code: 'invalid_path' });
  assert.deepEqual(await readFile(file), before);
});
