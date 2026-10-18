import { setImmediate as nextTurn } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBytes, revisionOf, withLocalChanges, withoutLocalChanges } from '../engine/service/store.mjs';
import { createChat, patchChat, postChat } from '../engine/service/chats.mjs';
import { patchSettings } from '../engine/service/units.mjs';
import { openLedger } from '../engine/sync/limits.mjs';
import { listStaged, openSync } from '../engine/sync/store.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

function gate() {
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  return { ready, release };
}

test('local observation waits until a committed service mutation has entered staging', { timeout: 5000 }, async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const sync = openSync({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now });
  const context = { store: fixture.store, paths: fixture.paths, sync, now: () => fixture.clock.now };
  const stageEntered = gate();
  const acquire = fixture.store.locks.acquire;
  const releaseStage = await acquire('sync-stage');
  t.after(releaseStage);
  fixture.store.locks.acquire = (key) => {
    if (key === 'sync-stage') stageEntered.release();
    return acquire(key);
  };
  const mutation = patchSettings(context, { look: 'high-contrast', expectedRevision: null });
  await stageEntered.ready;
  assert.equal(fixture.store.hidden.size, 0);
  assert.equal(fixture.store.writes.includes(path.join(fixture.paths.mind, 'user', 'gui', 'settings.json')), true);
  let observed = false;
  const observation = withLocalChanges(fixture.store, async () => {
    observed = true;
    return listStaged(sync);
  });
  await nextTurn();
  assert.equal(observed, false);
  releaseStage();
  await mutation;
  const staged = await observation;
  assert.equal(staged.length, 1);
  assert.equal(staged[0].target.path, 'user/gui/settings.json');
  assert.equal(typeof staged[0].transactionId, 'string');
});

test('nested local mutations stay reentrant and a failure releases observation', { timeout: 5000 }, async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const order = [];
  await assert.rejects(() => withLocalChanges(fixture.store, async () => {
    order.push('outer');
    await nextTurn();
    await withLocalChanges(fixture.store, async () => { order.push('inner'); });
    throw new Error('mutation failed');
  }), /mutation failed/);
  await withLocalChanges(fixture.store, async () => { order.push('next'); });
  assert.deepEqual(order, ['outer', 'inner', 'next']);
});

test('a detached descendant cannot reuse a released observation lease', { timeout: 5000 }, async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const descendantReady = gate();
  const holderReady = gate();
  const releaseHolder = gate();
  t.after(() => { descendantReady.release(); releaseHolder.release(); });
  let descendant;
  let entered = false;
  await withLocalChanges(fixture.store, async () => {
    descendant = (async () => {
      await descendantReady.ready;
      await withLocalChanges(fixture.store, async () => { entered = true; });
    })();
  });
  const holder = withLocalChanges(fixture.store, async () => {
    holderReady.release();
    await releaseHolder.ready;
  });
  await holderReady.ready;
  descendantReady.release();
  await nextTurn();
  assert.equal(entered, false);
  releaseHolder.release();
  await holder;
  await descendant;
  assert.equal(entered, true);
});

test('same-clock unit and chat rewrites keep distinct changes and atomic message groups', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const now = () => fixture.clock.now;
  const sync = openSync({ store: fixture.store, paths: fixture.paths, now });
  const context = {
    store: fixture.store, paths: fixture.paths, sync, now,
    ledger: openLedger({ store: fixture.store, paths: fixture.paths, now, machine: fixture.machine }),
    principal: { stableId: 'desktop', audience: 'desktop', unitId: 'root:master' },
  };
  await patchSettings(context, { look: 'modern', expectedRevision: null });
  const settings = path.join(fixture.paths.mind, 'user', 'gui', 'settings.json');
  await patchSettings(context, { look: 'modern', expectedRevision: revisionOf(await readBytes(fixture.store, settings)) });
  await mkdir(path.join(fixture.paths.mind, 'user', 'state'), { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'master.md'), 'unit: master\nunit-id: root:master\nrole: master\nstate: in\nmachine: DESKTOP\n\nReady.\n');
  const first = await createChat(context, { members: ['root:master'] });
  await patchChat(context, first.chat.id, { pinned: false, expectedRevision: first.chat.revision });
  const posted = await postChat(context, first.chat.id, { body: 'Hello' });
  const staged = await listStaged(sync);
  const settingsChanges = staged.filter(change => change.target.path === 'user/gui/settings.json');
  const chatChanges = staged.filter(change => change.target.path === `user/relay/chats/${first.chat.id}/chat.md`);
  assert.equal(settingsChanges.length, 2);
  assert.equal(chatChanges.length, 2);
  for (const changes of [settingsChanges, chatChanges]) {
    assert.equal(new Set(changes.map(change => change.id)).size, 2);
    assert.equal(new Set(changes.map(change => change.transactionId)).size, 2);
  }
  const message = staged.find(change => change.target.path === `user/relay/chats/${first.chat.id}/${posted.message.id}.md`);
  const fanout = staged.find(change => change.target.path === `user/relay/fanout/${posted.message.id}.json`);
  assert.equal(typeof message.transactionId, 'string');
  assert.equal(message.transactionId, fanout.transactionId);
});

test('work a timer starts inside a local observation waits for it instead of sharing its lease', { timeout: 5000 }, async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const order = [];
  let scheduled;
  await withLocalChanges(fixture.store, async () => {
    scheduled = new Promise((resolve) => setTimeout(() => resolve(withoutLocalChanges(() => withLocalChanges(fixture.store, async () => { order.push('timer'); }))), 0));
    await new Promise((resolve) => setTimeout(resolve, 50));
    order.push('first');
  });
  await scheduled;
  assert.deepEqual(order, ['first', 'timer']);
});
