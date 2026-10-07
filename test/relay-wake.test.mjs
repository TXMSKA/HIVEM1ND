import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fsPromises, { mkdtemp, mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { createRelay } from '../engine/relay/store.mjs';
import { createRelayWakeController } from '../engine/relay/wake.mjs';

async function fixture(context) {
  const scratchRoot = path.join(process.cwd(), '.work');
  await mkdir(scratchRoot, { recursive: true });
  const root = await mkdtemp(path.join(scratchRoot, 'relay-wake-'));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rmdir(scratchRoot).catch(() => {});
  });
  const mind = path.join(root, 'mind');
  await mkdir(path.join(mind, 'user', 'state'), { recursive: true });
  await mkdir(path.join(mind, 'user', 'projects', 'alpha', 'state'), { recursive: true });
  await writeFile(path.join(mind, 'user', 'routes.md'), '## Environments\n- web: alpha\n\n## Projects\n- alpha (web)\n');
  await writeFile(path.join(mind, 'user', 'state', 'manager.md'), 'unit: manager\nstate: in\nmachine: TESTBOX\n\nManager.\n');
  await writeFile(path.join(mind, 'user', 'projects', 'alpha', 'state', 'executor-alpha.md'), 'unit: executor-alpha\nstate: in\nmachine: TESTBOX\n\nExecutor.\n');
  const sender = await createRelay({ mindPath: mind, hostname: 'TESTBOX', sessionId: 'manager-chat', client: 'codex' });
  await sender.register({ unit: 'manager', nativeSessionId: 'manager-native' });
  const receiver = await createRelay({ mindPath: mind, hostname: 'TESTBOX', sessionId: 'executor-chat', client: 'claude' });
  await receiver.register({ unit: 'executor-alpha', nativeSessionId: 'executor-native' });
  return { mind, sender, receiver, binding: { unit: 'executor-alpha', nativeSessionId: 'executor-native', client: 'claude', machine: 'TESTBOX' } };
}

async function until(predicate, message = 'condition did not become true') {
  const deadline = Date.now() + 15000;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last === true) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`${message}: ${JSON.stringify(last)}`);
}

function controller(mind, sink, extra = {}) {
  return createRelayWakeController({ mindPath: mind, hostname: 'TESTBOX', sink, pollIntervalMs: 250,
    retryPolicy: { leaseMs: 10_000, sinkTimeoutMs: 1000, cooldownMs: 1000, baseDelayMs: 100, maxDelayMs: 300 }, ...extra });
}

test('wake requires exact registration and explicit bounds; unlimited requires manual consent', async (context) => {
  const { mind, binding } = await fixture(context);
  const wake = await controller(mind, async () => ({ status: 'submitted' }));
  const absentPolicyDisable = await wake.disable(binding);
  assert.equal(absentPolicyDisable.enabled, false, 'disabling an absent policy is valid and idempotent');
  await assert.rejects(wake.enable({ ...binding, unit: 'manager' }), { code: 'WAKE_REGISTRATION_MISSING' });
  await assert.rejects(wake.enable({ ...binding, windowHours: 12 }), { code: 'WAKE_EXTENDED_CONSENT_REQUIRED' });
  await assert.rejects(wake.enable({ ...binding, unlimited: true }), { code: 'WAKE_MANUAL_CONSENT_REQUIRED' });
  await assert.rejects(wake.enable({ ...binding, maxHandoffs: 101 }), { code: 'WAKE_INVALID_POLICY' });
  const status = await wake.enable({ ...binding, windowHours: 12, extended: true, maxHandoffs: 7 });
  assert.equal(status.enabled, true);
  assert.equal(status.deadlineAt, new Date(Date.parse(status.startedAt) + 12 * 60 * 60 * 1000).toISOString());
  assert.equal(status.wakeBudget, 7);
  await wake.disable(binding);
  const consent = await wake.enable({ ...binding, unlimited: true, manualConsent: true });
  assert.equal(consent.deadlineAt, null);
  assert.equal(consent.wakeBudget, 20);
  await wake.disable(binding);
});

test('worker coalesces metadata, persists dedupe across restart, never archives, and honors activity', async (context) => {
  const { mind, sender, receiver, binding } = await fixture(context);
  const notices = [];
  const wake = await controller(mind, async (notice) => { notices.push(notice); return { status: 'submitted' }; });
  context.after(() => wake.stopAll());
  await wake.enable(binding);
  const handle = wake.start(binding);
  assert.deepEqual(await handle.ready, { state: 'running', ownsLease: true });
  await wake.observeActivity(binding, { activity: 'busy' });
  const normal = await sender.send({ to: binding.unit, subject: 'Work', body: 'body' });
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(notices.length, 0, 'known-busy normal arrivals defer');
  await wake.observeActivity(binding, { activity: 'idle' });
  await until(() => notices.length === 1);
  assert.deepEqual(notices[0].messageIds, [normal.id]);
  assert.match(notices[0].text, /Untrusted Relay context/);
  assert.equal(notices[0].text.includes('body'), false);
  assert.equal((await receiver.inbox()).unread, 1, 'wake does not archive or consume the message');
  await handle.stop();
  assert.equal((await handle.done).reason, 'stopped');

  const resumed = await controller(mind, async (notice) => { notices.push(notice); return { status: 'submitted' }; });
  const resumedHandle = resumed.start(binding);
  assert.deepEqual(await resumedHandle.ready, { state: 'running', ownsLease: true });
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(notices.length, 1, 'persisted IDs prevent a duplicate after worker restart');
  await resumedHandle.stop();
  await resumed.stopAll();
});

test('urgent arrivals bypass normal cooldown while busy and handoff budget prevents fresh-ID churn', async (context) => {
  const { mind, sender, binding } = await fixture(context);
  const notices = [];
  const wake = await controller(mind, async (notice) => { notices.push(notice); return { status: 'submitted' }; });
  context.after(() => wake.stopAll());
  await wake.enable({ ...binding, maxHandoffs: 2 });
  await wake.observeActivity(binding, { activity: 'idle' });
  const handle = wake.start(binding);
  assert.equal((await handle.ready).ownsLease, true);
  await sender.send({ to: binding.unit, subject: 'First', body: 'one' });
  await until(() => notices.length === 1);
  await wake.observeActivity(binding, { activity: 'busy' });
  await sender.send({ to: binding.unit, subject: 'Urgent', body: 'two', priority: 'urgent' });
  await until(() => notices.length === 2);
  assert.equal(notices.length, 2, 'urgent messages do not wait behind a normal-message cooldown');
  assert.equal(notices[1].urgent, true);
  await wake.observeActivity(binding, { activity: 'idle' });
  await sender.send({ to: binding.unit, subject: 'Fresh ID', body: 'three' });
  await until(async () => (await wake.status(binding)).pausedReason === 'handoff-budget-exhausted');
  assert.equal((await handle.done).reason, 'budget-exhausted');
});

test('ambiguous sink writes are not retried and arbitrary sink errors are never persisted', async (context) => {
  const { mind, sender, binding } = await fixture(context);
  let sinkCalls = 0;
  const wake = await controller(mind, async () => {
    sinkCalls += 1;
    if (sinkCalls === 1) {
      const error = new Error('TOKEN=must-not-persist');
      error.code = 'RELAYSECRET123CANARY';
      throw error;
    }
    return { status: 'not_submitted', reason: 'RELAYSECRET123CANARY' };
  });
  context.after(() => wake.stopAll());
  await wake.enable(binding);
  await sender.send({ to: binding.unit, subject: 'Question', body: 'secret body' });
  const handle = wake.start(binding);
  assert.equal((await handle.ready).ownsLease, true);
  await until(() => sinkCalls === 1);
  await until(async () => { const state = await wake.status(binding); return state.ambiguousCount === 1 && state.lastError ? true : state; });
  const afterSink = await wake.status(binding);
  assert.equal(afterSink.ambiguousCount, 1, JSON.stringify({ afterSink, sinkCalls }));
  const persisted = await readFile(path.join(mind, 'user', 'relay', 'wake', 'policies', `${(await import('node:crypto')).createHash('sha256').update(JSON.stringify([binding.unit, binding.nativeSessionId, binding.client, binding.machine])).digest('hex')}.json`), 'utf8');
  assert.equal(persisted.includes('TOKEN=must-not-persist'), false);
  assert.equal(persisted.includes('secret body'), false);
  const stored = JSON.parse(persisted);
  assert.equal(Object.values(stored.deliveries).some((entry) => entry.reason === 'SINK_AMBIGUOUS'), true);
  assert.equal(['SINK_AMBIGUOUS', 'EPERM'].includes(afterSink.lastError.code), true);
  await handle.stop();
});

test('sink-controlled result reasons are reduced to fixed persisted codes', async (context) => {
  const { mind, sender, receiver, binding } = await fixture(context);
  let sinkCalls = 0;
  const wake = await controller(mind, async () => { sinkCalls += 1; return { status: 'not_submitted', reason: 'RELAYSECRET123CANARY' }; }, {
    retryPolicy: { leaseMs: 10_000, sinkTimeoutMs: 1000, cooldownMs: 1000, baseDelayMs: 1000, maxDelayMs: 1000 },
  });
  context.after(() => wake.stopAll());
  await wake.enable(binding);
  await sender.send({ to: binding.unit, subject: 'Not submitted', body: 'private payload' });
  assert.equal((await receiver.inbox()).unread, 1, 'fixture inbox is readable before worker startup');
  const handle = wake.start(binding);
  assert.equal((await handle.ready).ownsLease, true);
  await until(async () => { const state = await wake.status(binding); return sinkCalls === 1 && state.pendingCount === 1 ? true : state; });
  const status = await wake.status(binding);
  assert.equal(status.lastError.code, 'SINK_NOT_SUBMITTED');
  const policyPath = path.join(mind, 'user', 'relay', 'wake', 'policies', `${createHash('sha256').update(JSON.stringify([binding.unit, binding.nativeSessionId, binding.client, binding.machine])).digest('hex')}.json`);
  const stored = await readFile(policyPath, 'utf8');
  assert.equal(stored.includes('RELAYSECRET123CANARY'), false);
  assert.equal(stored.includes('private payload'), false);
  await handle.stop();
});

test('SessionEnd revokes without needing a live registration and start cannot restart the policy', async (context) => {
  const { mind, binding } = await fixture(context);
  const wake = await controller(mind, async () => ({ status: 'submitted' }));
  await wake.enable(binding);
  await wake.endSession(binding);
  const status = await wake.status(binding);
  assert.equal(status.enabled, false);
  assert.equal(status.worker.state, 'disabled');
  const handle = wake.start(binding);
  assert.deepEqual(await handle.ready, { state: 'disabled', ownsLease: false });
  assert.deepEqual(await handle.done, { reason: 'disabled' });
});

test('expiry is fixed across worker reload and malformed persisted bounds fail closed', async (context) => {
  const { mind, binding } = await fixture(context);
  let now = Date.now();
  const clock = { now: () => now, sleep: async (_ms, signal) => { if (signal?.aborted) return; await new Promise((resolve) => setTimeout(resolve, 2)); } };
  let sinkCalls = 0;
  const wake = await controller(mind, async () => { sinkCalls += 1; return { status: 'submitted' }; }, { clock });
  const enabled = await wake.enable(binding);
  now += 4 * 60 * 60 * 1000 + 1;
  const expiredHandle = wake.start(binding);
  assert.deepEqual(await expiredHandle.ready, { state: 'expired', ownsLease: false });
  assert.deepEqual(await expiredHandle.done, { reason: 'expired' });
  assert.equal((await wake.status(binding)).deadlineAt, enabled.deadlineAt, 'worker restart does not renew the stored deadline');
  assert.equal(sinkCalls, 0);

  now = Date.now();
  await wake.enable(binding);
  const policyHash = createHash('sha256').update(JSON.stringify([binding.unit, binding.nativeSessionId, binding.client, binding.machine])).digest('hex');
  const policyPath = path.join(mind, 'user', 'relay', 'wake', 'policies', `${policyHash}.json`);
  const policy = JSON.parse(await readFile(policyPath, 'utf8'));
  policy.deadlineAt = null;
  await writeFile(policyPath, JSON.stringify(policy));
  await assert.rejects(wake.status(binding), { code: 'WAKE_POLICY_INVALID' });
  const malformedHandle = wake.start(binding);
  assert.equal((await malformedHandle.ready).code, 'WAKE_POLICY_INVALID');
  assert.deepEqual(await malformedHandle.done, { reason: 'WAKE_POLICY_INVALID' });
  assert.equal(sinkCalls, 0);
});

test('old in-flight sink completion cannot settle a replacement policy generation', async (context) => {
  const { mind, sender, binding } = await fixture(context);
  let firstEntered;
  const firstStarted = new Promise((resolve) => { firstEntered = resolve; });
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let throwOnNextClockRead = false;
  const clock = {
    now: () => {
      if (throwOnNextClockRead) { throwOnNextClockRead = false; const error = new Error('test clock failure'); error.code = 'WAKE_CLOCK_INVALID'; throw error; }
      return Date.now();
    },
    sleep: async (_ms, signal) => { if (!signal?.aborted) await new Promise((resolve) => setTimeout(resolve, 2)); },
  };
  const oldController = await controller(mind, async () => { firstEntered(); await firstGate; return { status: 'submitted' }; }, {
    clock,
    retryPolicy: { leaseMs: 20_000, sinkTimeoutMs: 15_000, cooldownMs: 1000, baseDelayMs: 100, maxDelayMs: 300 },
  });
  const newController = await controller(mind, async () => ({ status: 'submitted' }));
  context.after(async () => { releaseFirst(); await oldController.stopAll(); await newController.stopAll(); });
  await oldController.enable(binding);
  const handle = oldController.start(binding);
  assert.equal((await handle.ready).ownsLease, true);
  await sender.send({ to: binding.unit, subject: 'In flight', body: 'question' });
  await firstStarted;
  await newController.disable(binding);
  const replacement = await newController.enable(binding);
  const replacementGeneration = JSON.parse(await readFile(path.join(mind, 'user', 'relay', 'wake', 'policies', `${createHash('sha256').update(JSON.stringify([binding.unit, binding.nativeSessionId, binding.client, binding.machine])).digest('hex')}.json`), 'utf8')).generation;
  assert.equal(replacement.startedAt !== null, true);
  throwOnNextClockRead = true;
  releaseFirst();
  assert.equal((await handle.done).reason, 'WAKE_WORKER_ERROR');
  const final = await newController.status(binding);
  assert.equal(final.wakeCount, 0, 'the replacement remains free of the old generation result');
  assert.equal(final.submittedCount, 0);
  const replacementPolicy = JSON.parse(await readFile(path.join(mind, 'user', 'relay', 'wake', 'policies', `${createHash('sha256').update(JSON.stringify([binding.unit, binding.nativeSessionId, binding.client, binding.machine])).digest('hex')}.json`), 'utf8'));
  assert.equal(replacementPolicy.generation, replacementGeneration);
  assert.equal(replacementPolicy.lastError, null, 'a stale worker catch cannot write its error into a replacement grant');
});

test('repeated attach waits for an old generation to release its lease before reporting ready', async (context) => {
  const { mind, binding } = await fixture(context);
  const first = await controller(mind, async () => ({ status: 'submitted' }));
  const second = await controller(mind, async () => ({ status: 'submitted' }));
  context.after(async () => { await first.stopAll(); await second.stopAll(); });
  await first.enable(binding);
  const oldWorker = first.start(binding);
  assert.equal((await oldWorker.ready).ownsLease, true);
  const duplicate = second.start(binding);
  assert.deepEqual(await duplicate.ready, { state: 'already-running', ownsLease: false });
  assert.deepEqual(await duplicate.done, { reason: 'already-running' });

  await second.enable(binding);
  const replacementWorker = second.start(binding);
  assert.deepEqual(await replacementWorker.ready, { state: 'running', ownsLease: true });
  assert.equal((await oldWorker.done).reason, 'policy-replaced');
  await replacementWorker.stop();
  assert.equal((await second.status(binding)).enabled, true);
});

test('atomic store locks serialize overlapping writers and recover a stale partial lock', async (context) => {
  const { mind } = await fixture(context);
  const relay = await createRelay({ mindPath: mind, hostname: 'TESTBOX', sessionId: 'lock-probe' });
  const persistence = relay.wakePersistence;
  const lockHash = createHash('sha256').update('barrier-lock').digest('hex');
  const lockPath = path.join(mind, 'user', 'relay', 'wake', 'locks', `${lockHash}.json`);
  let enteredWrite;
  const writeEntered = new Promise((resolve) => { enteredWrite = resolve; });
  let releaseWrite;
  const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
  const originalOpen = fsPromises.open;
  let intercepted = false;
  fsPromises.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (!intercepted && path.resolve(String(args[0])) === path.resolve(lockPath) && args[1] === 'wx') {
      intercepted = true;
      return {
        writeFile: async (...writeArgs) => { enteredWrite(); await writeGate; return handle.writeFile(...writeArgs); },
        sync: (...syncArgs) => handle.sync(...syncArgs),
        close: (...closeArgs) => handle.close(...closeArgs),
      };
    }
    return handle;
  };
  syncBuiltinESMExports();
  context.after(() => { releaseWrite(); fsPromises.open = originalOpen; syncBuiltinESMExports(); });
  const order = [];
  const first = persistence.withLock('barrier-lock', async () => { order.push('first-enter'); await new Promise((resolve) => setTimeout(resolve, 30)); order.push('first-exit'); });
  await writeEntered;
  const second = persistence.withLock('barrier-lock', async () => { order.push('second-enter'); });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(order, [], 'the partial exclusive lock blocks a competing writer');
  releaseWrite();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first-enter', 'first-exit', 'second-enter']);
  fsPromises.open = originalOpen;
  syncBuiltinESMExports();

  await mkdir(path.dirname(lockPath), { recursive: true });
  await writeFile(lockPath, '{partial');
  const past = new Date(Date.now() - 10_000);
  const { utimes } = await import('node:fs/promises');
  await utimes(lockPath, past, past);
  let recovered = false;
  await persistence.withLock('barrier-lock', async () => { recovered = true; });
  assert.equal(recovered, true, 'an old malformed lock from a crashed writer is reclaimed');
});
