import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectChat, readCollection, readDetail, readProjection } from '../engine/service/projection.mjs';
import { atomicWrite, createProjectionCache, noteProjectionChange, withLocalChanges } from '../engine/service/store.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const NOW = Date.parse('2026-10-10T12:00:00.000Z');

function stateFile(fields, body = 'Ready.\n') {
  return `${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('\n')}\n\n${body}`;
}

async function world(t) {
  const fixture = await makeCoreFixture({ now: NOW });
  t.after(() => dispose(fixture));
  const root = fixture.paths.mind;
  for (const folder of ['state', 'inbox/master', 'tasks', 'relay/sessions', 'relay/chats']) await mkdir(path.join(root, 'user', ...folder.split('/')), { recursive: true });
  await writeFile(path.join(root, 'user', 'state', 'one.md'), stateFile({
    unit: 'executor-shop', 'unit-id': 'project:shop:executor-shop', role: 'executor', state: 'in', machine: 'DESKTOP',
  }));
  fixture.store.projectionCache = createProjectionCache();
  const context = { store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, principal: { audience: 'desktop', unitId: 'root:master' } };
  return { fixture, context, cache: fixture.store.projectionCache };
}

test('a service reads the M1ND from the files once and again only after something changed', async (t) => {
  const { fixture, context, cache } = await world(t);
  const first = await readProjection(context);
  assert.equal(first.units.length, 1);
  const second = await readProjection(context);
  const page = await readCollection(context, 'units', { limit: 10 });
  const detail = await readDetail(context, 'units', 'project:shop:executor-shop');
  assert.equal(cache.builds, 1);
  assert.deepEqual(second.units, first.units);
  assert.equal(page.total, 1);
  assert.equal(detail.id, 'project:shop:executor-shop');
  // What a first publication writes by the thousand is not read by the projection and leaves the build alone.
  for (const name of ['staging/changes/one.json', 'staging/objects/two.br', 'outgoing/publication.json', 'sync-ledger.json']) {
    await atomicWrite(fixture.store, path.join(fixture.paths.localDirectory, ...name.split('/')), Buffer.from('{}'));
  }
  await readProjection(context);
  assert.equal(cache.builds, 1);
  // A write through the store, the watcher's note and an ordinary write by the service each throw the build away.
  await atomicWrite(fixture.store, path.join(fixture.paths.mind, 'user', 'state', 'two.md'), stateFile({
    unit: 'executor-shop-2', 'unit-id': 'project:shop:executor-shop-2', role: 'executor', state: 'in', machine: 'DESKTOP',
  }));
  assert.equal((await readProjection(context)).units.length, 2);
  assert.equal(cache.builds, 2);
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'three.md'), stateFile({
    unit: 'executor-shop-3', 'unit-id': 'project:shop:executor-shop-3', role: 'executor', state: 'in', machine: 'DESKTOP',
  }));
  assert.equal((await readProjection(context)).units.length, 2, 'a file written behind the service is not seen until the watcher notes it');
  noteProjectionChange(fixture.store);
  assert.equal((await readProjection(context)).units.length, 3);
  assert.equal(cache.builds, 3);
});

test('a reader cannot change what the next reader gets', async (t) => {
  const { context } = await world(t);
  const first = await readProjection(context);
  first.units[0].alias = 'changed by a caller';
  first.units.push({ id: 'invented' });
  first.counts.units = 99;
  const second = await readProjection(context);
  assert.equal(second.units.length, 1);
  assert.equal(second.units[0].alias, null);
  assert.equal(second.counts.units, 1);
  assert.equal(Object.getOwnPropertyDescriptor(second, 'allUnits')?.value?.length, 1);
});

test('readers that ask at the same time share one build, and a build older than a write is not shared', async (t) => {
  const { fixture, context, cache } = await world(t);
  const views = await Promise.all([readProjection(context), readProjection(context), readCollection(context, 'units', {}), projectChat({ ...context }, 'none').catch((error) => error)]);
  assert.equal(views[0].units.length, 1);
  assert.equal(cache.builds, 1);
  assert.equal(views[3].code, 'chat_not_found');
  // A write lands while a build is running: the build is not offered to a reader that arrives after the write.
  noteProjectionChange(fixture.store);
  const slow = readProjection(context);
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'two.md'), stateFile({
    unit: 'executor-shop-2', 'unit-id': 'project:shop:executor-shop-2', role: 'executor', state: 'in', machine: 'DESKTOP',
  }));
  noteProjectionChange(fixture.store);
  const after = await readProjection(context);
  await slow;
  assert.equal(after.units.length, 2);
});

test('different readers, a moved clock and a long wait each get a build of their own', async (t) => {
  const { fixture, context, cache } = await world(t);
  await readProjection(context);
  await readProjection({ ...context, principal: { audience: 'agent', unitId: 'project:shop:executor-shop' } });
  assert.equal(cache.builds, 2);
  await readProjection(context);
  assert.equal(cache.builds, 2);
  fixture.clock.now += 6000;
  await readProjection(context);
  assert.equal(cache.builds, 3, 'a build is not reused once the service clock has moved past its freshness windows');
  const { entries } = cache;
  for (let index = 0; index < 8; index += 1) await readProjection({ ...context, principal: { audience: 'agent', unitId: `project:shop:agent-${index}` } });
  assert.ok(entries.size <= 4, 'the cache keeps a few builds, not one per agent');
});

test('a store without a cache builds on every read, as before', async (t) => {
  const { fixture, context } = await world(t);
  delete fixture.store.projectionCache;
  await readProjection(context);
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'two.md'), stateFile({
    unit: 'executor-shop-2', 'unit-id': 'project:shop:executor-shop-2', role: 'executor', state: 'in', machine: 'DESKTOP',
  }));
  assert.equal((await readProjection(context)).units.length, 2);
});

test('an old build is answered at once while a new one is built behind it, and a build past its limit is not answered', async (t) => {
  const { fixture, context, cache } = await world(t);
  const unit = (name) => stateFile({ unit: name, 'unit-id': `project:shop:${name}`, role: 'executor', state: 'in', machine: 'DESKTOP' });
  cache.refreshAfterMs = 0;
  assert.equal((await readProjection(context)).units.length, 1);
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'two.md'), unit('executor-shop-2'));
  assert.equal((await readProjection(context)).units.length, 1, 'the old build answers while the next is built');
  for (let wait = 0; wait < 50 && cache.builds < 2; wait += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(cache.builds, 2);
  cache.refreshAfterMs = 60000;
  for (let wait = 0; wait < 50 && (await readProjection(context)).units.length < 2; wait += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await readProjection(context)).units.length, 2);
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'three.md'), unit('executor-shop-3'));
  cache.maxAgeMs = -1;
  assert.equal((await readProjection(context)).units.length, 3, 'a build past its limit is built again before it is answered');
});

test('work that holds the local changes lock reads the M1ND while another reader waits for that lock', async (t) => {
  const { context } = await world(t);
  let holding, release;
  const held = new Promise(resolve => { holding = resolve; });
  // A deletion takes the lock, and meanwhile the app asks for the view, which queues a shared build behind the lock.
  const deletion = withLocalChanges(context.store, async () => {
    holding();
    await new Promise(resolve => { release = resolve; });
    return readProjection(context);
  });
  await held;
  const reader = readProjection(context);
  await new Promise(resolve => setTimeout(resolve, 20));
  release();
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('the lock holder waited on a build queued behind its own lock')), 5000));
  const view = await Promise.race([deletion, timeout]);
  assert.equal(view.units.some(unit => unit.id === 'project:shop:executor-shop'), true);
  assert.equal((await Promise.race([reader, timeout])).units.length, view.units.length);
});
