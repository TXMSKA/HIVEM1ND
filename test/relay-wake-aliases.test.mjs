import './relay-local-state.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createRelayWakeController } from '../engine/relay/wake.mjs';
import { createRelay, relayLocalStatePath } from '../engine/relay/store.mjs';
import { adoptWake } from '../engine/service/service.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

function key(binding, legacy = false) {
  return createHash('sha256').update(JSON.stringify([legacy ? binding.unit : binding.unitId,
    binding.nativeSessionId, binding.client, binding.machine])).digest('hex');
}

async function world(t) {
  const fixture = await makeCoreFixture();
  const { mind } = fixture.paths;
  await mkdir(path.join(mind, 'user', 'state'), { recursive: true });
  await mkdir(path.join(mind, 'user', 'projects', 'shop', 'state'), { recursive: true });
  await writeFile(path.join(mind, 'user', 'routes.md'), '## Environments\n- web: shop\n\n## Projects\n- shop (web)\n');
  await writeFile(path.join(mind, 'user', 'state', 'sender.md'), 'unit: sender\nstate: in\n\nSender.\n');
  await writeFile(path.join(mind, 'user', 'projects', 'shop', 'state', 'worker.md'), 'unit: worker\nstate: in\n\nWorker.\n');
  const sender = await createRelay({ mindPath: mind, hostname: fixture.machine, sessionId: 'sender-session', client: 'codex' });
  await sender.register({ unit: 'sender', nativeSessionId: 'sender-native' });
  const receiver = await createRelay({ mindPath: mind, hostname: fixture.machine, sessionId: 'worker-session', client: 'claude' });
  await receiver.register({ unit: 'worker', nativeSessionId: 'worker-native' });
  const binding = { unit: 'worker', unitId: 'project:shop:worker', nativeSessionId: 'worker-native', client: 'claude', machine: fixture.machine };
  const controllers = [];
  const controller = async (sink = async () => ({ status: 'submitted' })) => {
    const wake = await createRelayWakeController({ mindPath: mind, hostname: fixture.machine, sink,
      clock: { now: () => fixture.clock.now, sleep: (ms, signal) => new Promise(resolve => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
      }) }, pollIntervalMs: 250 });
    controllers.push(wake);
    return wake;
  };
  t.after(async () => { for (const wake of controllers.reverse()) await wake.stopAll(); await dispose(fixture); });
  const directory = path.join(mind, 'user', 'relay', 'wake', 'policies');
  const file = (legacy = false) => path.join(directory, `${key(binding, legacy)}.json`);
  return { ...fixture, mind, sender, receiver, binding, controller, directory, file };
}

async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('The expected isolated wake operation did not finish.');
}

test('new wake consent uses the canonical unit key and lookup preserves that identity', async t => {
  const w = await world(t);
  const wake = await w.controller();
  const { unitId, ...legacy } = w.binding;
  const enabled = await wake.enable(legacy);
  assert.deepEqual(enabled.binding, w.binding);
  assert.deepEqual(await readdir(w.directory), [`${key(w.binding)}.json`]);
  assert.deepEqual(await wake.findEnabledBinding({ nativeSessionId: w.binding.nativeSessionId, client: w.binding.client, machine: w.binding.machine }), w.binding);
  assert.equal((await wake.status(legacy)).deadlineAt, enabled.deadlineAt);
});

test('adoption merges alias deadlines, remaining budgets and terminal deliveries without another wake', async t => {
  const w = await world(t);
  const calls = [];
  const wake = await w.controller(async notice => { calls.push(notice); return { status: 'submitted' }; });
  await wake.enable(w.binding);
  const canonical = JSON.parse(await readFile(w.file(), 'utf8'));
  const first = await w.sender.send({ to: w.binding.unit, subject: 'Already uncertain', body: 'one' });
  const second = await w.sender.send({ to: w.binding.unit, subject: 'Already submitted', body: 'two' });
  const delivery = state => ({ state, attempts: 1, lastAttemptAt: canonical.startedAt });
  canonical.wakeCount = 7;
  canonical.maxHandoffs = 10;
  canonical.deliveries = { [first.id]: delivery('not_submitted'), [second.id]: delivery('submitted') };
  const legacy = { ...canonical, key: key(w.binding, true), binding: { ...w.binding }, generation: randomUUID(),
    startedAt: new Date(Date.parse(canonical.startedAt) - 3600000).toISOString(),
    deadlineAt: new Date(Date.parse(canonical.startedAt) + 7 * 3600000).toISOString(), durationHours: 8,
    wakeCount: 19, maxHandoffs: 20, deliveries: { [first.id]: delivery('ambiguous') } };
  delete legacy.binding.unitId;
  await writeFile(w.file(), JSON.stringify(canonical));
  await writeFile(w.file(true), JSON.stringify(legacy));
  const merged = await wake.adopt(w.binding);
  assert.equal(merged.startedAt, legacy.startedAt);
  assert.equal(merged.deadlineAt, canonical.deadlineAt);
  assert.equal(merged.maxHandoffs - merged.wakeCount, 1);
  assert.equal(merged.deliveries[first.id].state, 'ambiguous');
  assert.equal(merged.deliveries[second.id].state, 'submitted');
  assert.deepEqual(await wake.adopt(w.binding), merged, 'repeated adoption is idempotent');
  const { unitId, ...oldBinding } = w.binding;
  const a = wake.start(oldBinding);
  const b = wake.start(w.binding);
  assert.equal((await a.ready).ownsLease, true);
  assert.equal((await b.ready).ownsLease, true);
  assert.equal((await wake.workerStates()).length, 1);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(calls.length, 0, 'terminal IDs from either alias are never replayed');
  const fresh = await w.sender.send({ to: w.binding.unit, subject: 'New', body: 'three' });
  await until(() => calls.length === 1);
  assert.deepEqual(calls[0].messageIds, [fresh.id]);
  await until(async () => (await wake.status(w.binding)).wakeCount === merged.maxHandoffs);
  await a.stop();
  await b.done;
  assert.equal(JSON.parse(await readFile(w.file(true), 'utf8')).wakeCount, merged.maxHandoffs);
  assert.equal((await wake.status(oldBinding)).deadlineAt, canonical.deadlineAt);
});

test('a disabled legacy alias cannot revive and another scope keeps its own canonical policy', async t => {
  const w = await world(t);
  const wake = await w.controller();
  await wake.enable(w.binding);
  const canonical = JSON.parse(await readFile(w.file(), 'utf8'));
  const legacy = { ...canonical, key: key(w.binding, true), enabled: false, disabledAt: canonical.startedAt, disabledReason: 'manual' };
  await writeFile(w.file(true), JSON.stringify(legacy));
  assert.equal((await wake.adopt(w.binding)).enabled, false);
  assert.equal((await wake.start(w.binding).ready).ownsLease, false);
  assert.equal(await wake.findEnabledBinding({ nativeSessionId: w.binding.nativeSessionId, client: w.binding.client, machine: w.binding.machine }), null);
  const otherBinding = { ...w.binding, unitId: 'root:worker' };
  const other = { ...canonical, key: key(otherBinding), binding: otherBinding, generation: randomUUID() };
  await writeFile(path.join(w.directory, `${other.key}.json`), JSON.stringify(other));
  const adopted = await wake.adopt(otherBinding);
  assert.equal(adopted.enabled, true);
  assert.equal(adopted.binding.unitId, 'root:worker');
  assert.equal((await wake.adopt(w.binding)).enabled, false);
});

test('a live legacy local lease prevents a canonical worker from submitting twice', async t => {
  const w = await world(t);
  let calls = 0;
  const wake = await w.controller(async () => { calls += 1; return { status: 'submitted' }; });
  await wake.enable(w.binding);
  const policy = JSON.parse(await readFile(w.file(), 'utf8'));
  const directory = path.join(relayLocalStatePath(w.mind), 'wake', 'workers');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${key(w.binding, true)}.json`), JSON.stringify({ kind: 'relay-wake-worker', key: key(w.binding, true),
    ownerId: 'previous-owned-service', pid: process.pid, machine: w.machine, generation: policy.generation,
    heartbeatAt: policy.startedAt, expiresAt: w.clock.now + 15000 }));
  await w.sender.send({ to: w.binding.unit, subject: 'Held', body: 'never duplicate' });
  const worker = wake.start(w.binding);
  assert.deepEqual(await worker.ready, { state: 'already-running', ownsLease: false });
  assert.equal((await worker.done).reason, 'already-running');
  assert.equal(calls, 0);
});

test('service adoption deduplicates aliases but preserves different native sessions of one unit', async t => {
  const w = await world(t);
  const wake = await w.controller();
  await wake.enable(w.binding);
  const canonical = JSON.parse(await readFile(w.file(), 'utf8'));
  const legacy = { ...canonical, key: key(w.binding, true), binding: { ...w.binding } };
  delete legacy.binding.unitId;
  await writeFile(w.file(true), JSON.stringify(legacy));
  const otherBinding = { ...w.binding, nativeSessionId: 'another-native-session' };
  const other = { ...canonical, key: key(otherBinding), binding: otherBinding, generation: randomUUID() };
  await writeFile(path.join(w.directory, `${other.key}.json`), JSON.stringify(other));
  const adopted = await adoptWake({ store: w.store, paths: w.paths, now: () => w.clock.now, env: w.env, wakeSink: async () => ({ status: 'not_submitted' }) });
  try {
    assert.equal(adopted.policies.length, 2);
    assert.deepEqual(new Set(adopted.policies.map(policy => policy.binding.nativeSessionId)), new Set([w.binding.nativeSessionId, otherBinding.nativeSessionId]));
    assert.equal(adopted.policies.every(policy => policy.binding.unitId === w.binding.unitId), true);
    assert.equal(adopted.workersSpawned, 2);
    assert.equal((await wake.status(w.binding)).deadlineAt, canonical.deadlineAt);
  } finally { await adopted.controller.close(); }
});

test('a bounded alias constrains an older unlimited consent and immediate stop cancels startup', async t => {
  const w = await world(t);
  const wake = await w.controller();
  await wake.enable(w.binding);
  const canonical = JSON.parse(await readFile(w.file(), 'utf8'));
  const legacy = { ...canonical, key: key(w.binding, true), binding: { ...w.binding },
    startedAt: new Date(Date.parse(canonical.startedAt) - 10 * 86400000).toISOString(),
    deadlineAt: null, durationHours: null, unlimited: true, manualConsent: true };
  await writeFile(w.file(true), JSON.stringify(legacy));
  const merged = await wake.adopt(w.binding);
  assert.equal(merged.startedAt, legacy.startedAt);
  assert.equal(merged.deadlineAt, canonical.deadlineAt);
  assert.equal(merged.unlimited, false);
  assert.equal((await wake.status(w.binding)).enabled, true);
  const handle = wake.start(w.binding);
  assert.equal((await wake.stop(w.binding)).stopped, true);
  assert.equal((await handle.done).reason, 'stopped');
  assert.equal((await wake.workerStates())[0].worker, 'idle');
});

test('daily caps intersect canonical aliases without losing usage or notices and never join equal short names across projects', async t => {
  const w = await world(t), wake = await w.controller();
  await wake.enable({ ...w.binding, maxDailyHandoffs: 40 });
  const canonical = JSON.parse(await readFile(w.file(), 'utf8'));
  const date = new Date(w.clock.now);
  const localDay = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const noticeAt = new Date(w.clock.now).toISOString();
  canonical.day = { date: localDay, count: 17 };
  const legacy = { ...canonical, key: key(w.binding, true), binding: { ...w.binding }, maxDailyHandoffs: 35,
    day: { date: localDay, count: 30, noticeAt } };
  delete legacy.binding.unitId;
  await writeFile(w.file(), JSON.stringify(canonical));
  await writeFile(w.file(true), JSON.stringify(legacy));
  const merged = await wake.adopt(w.binding);
  assert.deepEqual(merged.day, legacy.day);
  assert.equal((await wake.status(w.binding)).dailyBudget, 35);
  await wake.touch(w.binding);
  await wake.enable({ ...w.binding, maxDailyHandoffs: 35 });
  assert.equal((await wake.status(w.binding)).dailyCount, 30);
  assert.equal((await wake.adopt(w.binding)).day.noticeAt, noticeAt);
  await writeFile(path.join(w.mind, 'user', 'state', 'worker.md'), 'unit: worker\nstate: in\n\nAnother canonical scope.\n');
  const rootBinding = { ...w.binding, unitId: 'root:worker', nativeSessionId: 'root-worker-native' };
  const root = await createRelay({ mindPath: w.mind, hostname: w.machine, client: 'claude' });
  await root.register({ unit: 'worker', unitId: 'root:worker', nativeSessionId: rootBinding.nativeSessionId });
  await wake.enable({ ...rootBinding, maxDailyHandoffs: 50 });
  assert.equal((await wake.status(rootBinding)).dailyCount, 0);
  assert.equal(await wake.takeOver(rootBinding), null);
  assert.equal((await wake.status(w.binding)).dailyCount, 30);
});
