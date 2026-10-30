import { randomUUID } from 'node:crypto';
import fs, { mkdir, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { watchLocalChanges } from '../engine/service/local-watch.mjs';
import { listStaged, openSync } from '../engine/sync/store.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

test('local observation reads completed import history once while revisiting an active group', async t => {
  const fixture = await makeCoreFixture();
  let close;
  t.after(async () => { await close?.(); await dispose(fixture); });
  const sync = openSync({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now });
  const directory = path.join(fixture.paths.localDirectory, 'received');
  const groups = path.join(directory, 'groups');
  const applied = path.join(directory, 'OTHER', '1.applied.json');
  await mkdir(groups, { recursive: true });
  await mkdir(path.dirname(applied), { recursive: true });
  const completed = path.join(groups, `${randomUUID()}.json`);
  const active = path.join(groups, `${randomUUID()}.json`);
  const target = { kind: 'mind', path: 'user/held.txt' };
  const group = { ops: [{ kind: 'write', target }], done: 0, emitted: false };
  await writeFile(completed, JSON.stringify({ ops: [], done: 0, emitted: true }));
  await writeFile(active, JSON.stringify(group));
  await writeFile(applied, JSON.stringify({ targets: [] }));
  await writeFile(path.join(fixture.paths.mind, 'user', 'held.txt'), 'pending import');
  const reads = new Map();
  const open = fs.open;
  t.mock.method(fs, 'open', async (file, ...args) => {
    if ([completed, active, applied].includes(String(file))) reads.set(String(file), (reads.get(String(file)) ?? 0) + 1);
    return open(file, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  close = await watchLocalChanges({ sync, paths: fixture.paths, now: sync.now, pulse: { changed: async () => {} } }, () => {});
  assert.equal((await listStaged(sync)).some(change => change.target.path === target.path), false);
  const activeBefore = reads.get(active);
  await writeFile(active, JSON.stringify({ ...group, done: 1, emitted: true }));
  await writeFile(path.join(fixture.paths.mind, 'user', 'trigger.txt'), 'rescan');
  const deadline = Date.now() + 10000;
  while (!(await listStaged(sync)).some(change => change.target.path === target.path) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.ok((await listStaged(sync)).some(change => change.target.path === target.path));
  assert.ok(reads.get(active) > activeBefore, 'The unfinished group must be reconsidered.');
  assert.equal(reads.get(completed), 1);
  assert.equal(reads.get(applied), 1);
});
