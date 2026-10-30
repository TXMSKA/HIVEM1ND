import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { createSettingsOwner, publishMachineSettings } from '../engine/service/settings.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { readBytes, recoverTransactions } from '../engine/service/store.mjs';
import { startService, stopService } from '../engine/service/service.mjs';
import { applyPack } from '../engine/sync/apply.mjs';
import { encodePack, packFileName } from '../engine/sync/pack.mjs';
import { openSync } from '../engine/sync/store.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

test('unchanged service reports do not accumulate transactions across heartbeat intervals', async t => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const owner = createSettingsOwner({ ...fixture, paths: fixture.paths, now: () => fixture.clock.now,
    startedAt: new Date(fixture.clock.now).toISOString(), projects: [], probeAgents: async () => ({}) });
  const first = await publishMachineSettings(owner);
  const transactions = path.join(fixture.paths.localDirectory, 'transactions');
  const before = await readdir(transactions);
  for (const interval of [60000, 10 * 60000]) {
    fixture.clock.now += interval;
    assert.deepEqual(await publishMachineSettings(owner, 'service'), first);
  }
  assert.deepEqual(await readdir(transactions), before);
  const file = path.join(fixture.paths.mind, 'user', 'machines', fixture.machine, 'settings.json');
  assert.equal(JSON.parse(await readFile(file)).reportedAt, first.reportedAt);
  owner.active = false;
  assert.equal((await publishMachineSettings(owner, 'service')).service.state, 'stopped');
});

test('restart recovery reads completed transaction history once in bounded batches', async t => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const directory = path.join(fixture.paths.localDirectory, 'transactions');
  await mkdir(directory);
  const files = new Set();
  await Promise.all(Array.from({ length: 96 }, async () => {
    const id = randomUUID(), file = path.join(directory, `${id}.json`);
    files.add(file);
    await writeFile(file, JSON.stringify({ id, phase: 'committed', emitted: true, entries: [] }));
  }));
  let reads = 0, active = 0, maximum = 0;
  const open = fs.open;
  t.mock.method(fs, 'open', async (file, ...args) => {
    if (!files.has(String(file))) return open(file, ...args);
    reads += 1;
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active -= 1;
    return open(file, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const started = performance.now();
  await recoverTransactions(fixture.store);
  await readBytes(fixture.store, path.join(fixture.paths.mind, 'user', 'missing.txt'));
  const elapsed = performance.now() - started;
  t.diagnostic(`completed history recovery: ${Math.round(elapsed)} ms, ${reads} opens, concurrency ${maximum}`);
  assert.equal(reads, files.size);
  assert.ok(maximum > 1 && maximum <= 32);
  assert.ok(elapsed < 1500);
});

test('incoming publication bypasses the already applied immutable history', async t => {
  const fixture = await makeCoreFixture();
  let handle;
  t.after(async () => { if (handle) await stopService(handle, { force: true }); await dispose(fixture); });
  const origin = path.join(fixture.root, 'mirror');
  const directory = path.join(origin, 'machines', 'SCOUT');
  await mkdir(path.join(directory, 'packs'), { recursive: true });
  const makePack = (sequence, name) => {
    const bytes = Buffer.from(name), hash = hashBytes(bytes);
    const change = { format: 'hivem1nd-change-v1', id: randomUUID(), machine: 'SCOUT',
      at: new Date(fixture.clock.now).toISOString(), target: { kind: 'mind', path: `user/${name}.txt` },
      operation: 'put', hash, size: bytes.length, baseHash: null, messageId: null, transactionId: null };
    return encodePack({ machine: 'SCOUT', sequence, changes: [change], objects: [{ hash, raw: bytes }], transactions: [] });
  };
  const first = makePack(1, 'previous');
  const head = { format: 'hivem1nd-head-v1', machine: 'SCOUT', sequence: 1,
    updatedAt: new Date(fixture.clock.now).toISOString(),
    packs: [{ sequence: 1, file: packFileName(1), hash: hashBytes(first), bytes: first.length }] };
  const oldFile = path.join(directory, 'packs', packFileName(1));
  await writeFile(oldFile, first);
  await writeFile(path.join(directory, 'head.json'), JSON.stringify(head));
  const sync = openSync({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now });
  assert.equal((await applyPack(sync, first)).status, 'applied');
  handle = await startService({ store: fixture.store, paths: { ...fixture.paths, origin },
    now: () => fixture.clock.now, clients: [], projects: [], env: fixture.env, userKey: randomUUID(), guardPort: 0 });
  let oldReads = 0;
  const open = fs.open;
  t.mock.method(fs, 'open', async (file, ...args) => {
    if (String(file) === oldFile) {
      oldReads += 1;
      await new Promise(resolve => setTimeout(resolve, 2500));
    }
    return open(file, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const second = makePack(2, 'reconnected');
  head.sequence = 2;
  head.packs.push({ sequence: 2, file: packFileName(2), hash: hashBytes(second), bytes: second.length });
  await writeFile(path.join(directory, 'packs', packFileName(2)), second);
  await writeFile(path.join(directory, 'head.json'), JSON.stringify(head));
  const destination = path.join(fixture.paths.mind, 'user', 'reconnected.txt');
  const deadline = Date.now() + 1500;
  while (await readFile(destination, 'utf8').catch(() => null) !== 'reconnected' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(await readFile(destination, 'utf8'), 'reconnected');
  assert.equal(oldReads, 0);
  head.packs[0].hash = '0'.repeat(64);
  await writeFile(path.join(directory, 'head.json'), JSON.stringify(head));
  const rejected = Date.now() + 5000;
  while (handle.runtime.lastError?.code !== 'corrupt_resource' && Date.now() < rejected) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(handle.runtime.lastError?.code, 'corrupt_resource');
});
