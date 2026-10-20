import './relay-local-state.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fsPromises, { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRelay } from '../engine/relay/store.mjs';
import { createRelayWakeController } from '../engine/relay/wake.mjs';
import { adoptWake } from '../engine/service/service.mjs';
import { initializeNativeEntry } from '../engine/service/bridge.mjs';

const HOST = 'TESTBOX';

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-wake-robust-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const mind = path.join(root, 'mind');
  await mkdir(path.join(mind, 'user', 'state'), { recursive: true });
  await mkdir(path.join(mind, 'user', 'projects', 'alpha', 'state'), { recursive: true });
  await writeFile(path.join(mind, 'user', 'routes.md'), '## Environments\n- web: alpha\n\n## Projects\n- alpha (web)\n');
  await writeFile(path.join(mind, 'user', 'state', 'overseer.md'), `unit: overseer\nstate: in\nmachine: ${HOST}\n\nManager.\n`);
  await writeFile(path.join(mind, 'user', 'projects', 'alpha', 'state', 'executor-alpha.md'), `unit: executor-alpha\nstate: in\nmachine: ${HOST}\n\nExecutor.\n`);
  const sender = await createRelay({ mindPath: mind, hostname: HOST, sessionId: 'overseer-chat', client: 'codex' });
  const overseer = await sender.register({ unit: 'overseer', nativeSessionId: 'overseer-native' });
  const receiver = await createRelay({ mindPath: mind, hostname: HOST, sessionId: 'executor-chat', client: 'claude' });
  const executor = await receiver.register({ unit: 'executor-alpha', nativeSessionId: 'executor-native' });
  return { mind, sender, receiver,
    binding: { unit: 'executor-alpha', unitId: executor.unitId, nativeSessionId: 'executor-native', client: 'claude', machine: HOST },
    overseerBinding: { unit: 'overseer', unitId: overseer.unitId, nativeSessionId: 'overseer-native', client: 'codex', machine: HOST } };
}

function keyOf(binding) {
  return createHash('sha256').update(JSON.stringify([binding.unitId ?? binding.unit, binding.nativeSessionId, binding.client, binding.machine])).digest('hex');
}

function policyFileOf(mind, binding) {
  return path.join(mind, 'user', 'relay', 'wake', 'policies', `${keyOf(binding)}.json`);
}

async function until(predicate, message = 'condition did not become true', ceilingMs = 30000) {
  const deadline = Date.now() + ceilingMs;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last === true) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`${message}: ${JSON.stringify(last)}`);
}

function controller(mind, sink, extra = {}) {
  return createRelayWakeController({ mindPath: mind, hostname: HOST, sink, pollIntervalMs: 250,
    retryPolicy: { leaseMs: 10_000, sinkTimeoutMs: 1000, cooldownMs: 1000, baseDelayMs: 100, maxDelayMs: 300 }, ...extra });
}

// A clock the test moves by hand: a worker polls once per step, after the time of that step has passed.
function steppedClock() {
  let now = Date.now();
  let resume = null;
  let ended = false;
  const clock = {
    now: () => now,
    sleep: (_ms, signal) => new Promise((resolve) => {
      if (signal?.aborted) { resolve(); return; }
      function wake() { resume = null; signal?.removeEventListener('abort', wake); resolve(); }
      resume = wake;
      signal?.addEventListener('abort', wake, { once: true });
    }),
  };
  return Object.assign(clock, {
    follow(handle) { handle.done.then(() => { ended = true; }); },
    get ended() { return ended; },
    async step(milliseconds) {
      await until(() => resume !== null || ended, 'the worker did not reach its sleep');
      if (ended) return;
      now += milliseconds;
      resume();
      await until(() => resume !== null || ended, 'the worker did not finish its poll');
    },
  });
}

async function interceptFs(method, intercept) {
  const original = fsPromises[method];
  fsPromises[method] = (...args) => intercept(original, args);
  syncBuiltinESMExports();
  return () => { fsPromises[method] = original; syncBuiltinESMExports(); };
}

test('R-03: a worker rides out a truncated policy and routes that are empty for a moment, and ends only for a problem that stays', async (context) => {
  const { mind, binding } = await fixture(context);
  const clock = steppedClock();
  const wake = await controller(mind, async () => ({ status: 'submitted' }), { clock });
  const remote = await controller(mind, async () => ({ status: 'submitted' }), { hostname: 'OTHERBOX' });
  context.after(() => wake.stopAll());
  await wake.enable(binding);
  const handle = wake.start(binding);
  clock.follow(handle);
  assert.equal((await handle.ready).ownsLease, true);
  await clock.step(1000);

  // The synced policy is cut short for a few polls, and the worker cannot even record the error in it.
  const policyFile = policyFileOf(mind, binding);
  const original = await readFile(policyFile);
  await writeFile(policyFile, original.subarray(0, 60));
  for (let poll = 0; poll < 3; poll += 1) await clock.step(1500);
  assert.equal(clock.ended, false, 'a policy that is cut short for three polls does not end the worker');
  await writeFile(policyFile, original);
  await clock.step(1500);
  assert.equal(clock.ended, false);

  // Routes that are empty for a moment make the registration look gone.
  const routesFile = path.join(mind, 'user', 'routes.md');
  const routes = await readFile(routesFile);
  await writeFile(routesFile, '');
  for (let poll = 0; poll < 3; poll += 1) await clock.step(1500);
  assert.equal(clock.ended, false, 'routes that are empty for three polls do not end the worker');
  await writeFile(routesFile, routes);
  await clock.step(1500);
  assert.equal(clock.ended, false);
  assert.equal((await wake.status(binding)).worker.state, 'running');

  // A loss that stays ends it, but only after ten polls over at least thirty seconds, and its consent no longer reads as running.
  await writeFile(routesFile, '');
  for (let poll = 0; poll < 9; poll += 1) await clock.step(5000);
  assert.equal(clock.ended, false, 'nine polls are not enough even over forty-five seconds');
  await clock.step(5000);
  assert.deepEqual(await handle.done, { reason: 'registration-lost' });
  await writeFile(routesFile, routes);
  assert.equal((await wake.status(binding)).worker.state, 'idle');
  assert.equal((await remote.status(binding)).worker.state, 'idle', 'the note in the synced policy says stopped');
  assert.equal((await wake.status(binding)).enabled, true, 'the consent itself stays enabled for the service to serve again');
  assert.deepEqual(wake.lapsedWorkers(), [], 'a registration gone past the bound is a closed chat, which the service does not restart');
});

test('R-03: the service starts a worker again when it ended because of a problem, and not when it was stopped on purpose', async (context) => {
  const { mind, binding } = await fixture(context);
  const wake = await controller(mind, async () => ({ status: 'submitted' }));
  await wake.enable(binding);
  const adopted = await adoptWake({ paths: { mind, machine: HOST }, now: () => Date.now(), wakeSink: async () => ({ status: 'submitted' }), wakeRestartMs: 100 }, { nonce: 'test' });
  context.after(() => adopted.controller.close());
  assert.equal(adopted.workersSpawned, 1);
  const served = adopted.controller.wake;
  const running = async () => (await served.status(binding)).worker.state === 'running';
  await until(running, 'the adopted worker did not run');

  await served.stop(binding);
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(await running(), false, 'a worker that was stopped on purpose stays stopped');

  // The synced policy is cut short when the worker starts, so it ends; the file is whole again a moment later.
  const policyFile = policyFileOf(mind, binding);
  const original = await readFile(policyFile);
  await writeFile(policyFile, original.subarray(0, 60));
  const lapsed = served.start(binding);
  assert.equal((await lapsed.ready).state, 'error');
  await writeFile(policyFile, original);
  await until(running, 'the service did not start the worker again', 5000);
  assert.equal((await served.status(binding)).enabled, true);
});

test('R-04: a truncated or locked policy file is skipped and every other consent is adopted', async (context) => {
  const { mind, binding, overseerBinding } = await fixture(context);
  const wake = await controller(mind, async () => ({ status: 'submitted' }));
  await wake.enable(binding);
  await wake.enable(overseerBinding);
  const options = { paths: { mind, machine: HOST }, now: () => Date.now(), wakeSink: async () => ({ status: 'submitted' }), wakeRestartMs: 100 };
  const bad = policyFileOf(mind, binding);
  const original = await readFile(bad);

  await writeFile(bad, original.subarray(0, 40));
  const issues = [];
  const truncated = await adoptWake(options, { nonce: 'truncated', bus: { emit: (event) => issues.push(event) } });
  assert.equal(truncated.workersSpawned, 1, 'the consent that can be read is adopted');
  assert.deepEqual(truncated.skipped.map((item) => item.file), [path.basename(bad)]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].data.issue, 'wake_policy_unreadable');
  await writeFile(bad, original);
  await until(async () => (await truncated.controller.wake.status(binding)).worker.state === 'running', 'the consent of the file that was whole again got no worker', 5000);
  assert.deepEqual(truncated.skipped, [], 'a file that can be read is no longer reported');
  await truncated.controller.close();

  await writeFile(bad, original);
  const restore = await interceptFs('readFile', (readFileOriginal, args) => path.resolve(String(args[0])) === path.resolve(bad)
    ? Promise.reject(Object.assign(new Error('The file is busy.'), { code: 'EBUSY' })) : readFileOriginal(...args));
  context.after(restore);
  const locked = await adoptWake(options, { nonce: 'locked' });
  restore();
  assert.equal(locked.workersSpawned, 1);
  assert.deepEqual(locked.skipped, [{ file: path.basename(bad), code: 'EBUSY' }]);
  await locked.controller.close();
});

test('R-06: a wake that failed its fast attempts is tried again later while the worker runs and the consent is enabled', async (context) => {
  const { mind, sender, binding } = await fixture(context);
  const clock = steppedClock();
  let healthy = false;
  const calls = [];
  const wake = await controller(mind, async (delivery) => { calls.push(delivery.messageIds); return healthy ? { status: 'submitted' } : { status: 'not_submitted', reason: 'native_session_inbox_unavailable' }; }, { clock });
  context.after(() => wake.stopAll());
  await wake.enable(binding);
  const sent = await sender.send({ to: binding.unit, subject: 'urgent while the pipe is down', body: 'x', priority: 'urgent' });
  const handle = wake.start(binding);
  clock.follow(handle);
  assert.equal((await handle.ready).ownsLease, true);
  for (let poll = 0; poll < 6 && calls.length < 3; poll += 1) await clock.step(300);
  assert.equal(calls.length, 3, 'the three fast attempts');
  const entry = async () => JSON.parse(await readFile(policyFileOf(mind, binding), 'utf8')).deliveries[sent.id];
  assert.equal((await entry()).state, 'not_submitted', 'it is waiting for a slower retry, not given up');

  healthy = true;
  for (let poll = 0; poll < 5; poll += 1) await clock.step(1000);
  assert.equal(calls.length, 3, 'the slower retry is not due yet');
  await clock.step(30_000);
  assert.equal(calls.length, 4, 'the slower retry reaches the pipe that works again');
  assert.deepEqual(calls[3], [sent.id]);
  assert.equal((await entry()).state, 'submitted');
  assert.equal(clock.ended, false);
});

test('R-07: a superseded consent takes over again when its session registers again and is the newest', async (context) => {
  const { mind, sender, binding } = await fixture(context);
  const calls = [];
  const wake = await controller(mind, async (delivery) => { calls.push(delivery.binding.nativeSessionId); return { status: 'submitted' }; });
  context.after(() => wake.stopAll());
  const registerAs = async (nativeSessionId) => {
    await new Promise((resolve) => setTimeout(resolve, 8));
    const relay = await createRelay({ mindPath: mind, hostname: HOST, sessionId: nativeSessionId, client: 'claude' });
    const registered = await relay.register({ unit: 'executor-alpha', nativeSessionId });
    return { ...binding, unitId: registered.unitId, nativeSessionId };
  };
  const attach = async (nativeSessionId) => {
    const exact = await registerAs(nativeSessionId);
    await wake.enable(exact);
    await wake.takeOver(exact);
    return exact;
  };
  const older = await attach('chat-A');
  const newer = await attach('chat-B');
  assert.equal((await wake.status(older)).enabled, false, 'the older consent is superseded by the newer registration');
  assert.equal((await wake.status(newer)).enabled, true);

  // The older chat registers again and is the newest registration of the unit.
  await registerAs('chat-A');
  const taken = await wake.takeOver(older);
  assert.notEqual(taken, null, 'a disabled superseded consent does not block the takeover');
  assert.equal((await wake.status(older)).enabled, true);
  assert.equal((await wake.status(newer)).enabled, false);
  await until(async () => (await wake.status(older)).worker.state === 'running', 'the worker of the consent did not start');
  await sender.send({ to: binding.unit, subject: 'for the newest registration', body: 'x', priority: 'urgent' });
  await until(() => calls.length > 0, 'nothing was woken');
  assert.deepEqual([...new Set(calls)], ['chat-A']);
});

test('R-07: a native entry whose consent a newer session took does not fail as expired when the session is the newest again', async (context) => {
  const { mind, binding } = await fixture(context);
  const wake = await controller(mind, async () => ({ status: 'submitted' }));
  context.after(() => wake.stopAll());
  const registerAs = async (nativeSessionId) => {
    await new Promise((resolve) => setTimeout(resolve, 8));
    const relay = await createRelay({ mindPath: mind, hostname: HOST, sessionId: nativeSessionId, client: 'claude' });
    const registered = await relay.register({ unit: 'executor-alpha', nativeSessionId });
    return { ...binding, unitId: registered.unitId, nativeSessionId };
  };
  const older = await registerAs('chat-A');
  await wake.enable(older);
  const newer = await registerAs('chat-B');
  await wake.enable(newer);
  await wake.takeOver(newer);
  assert.equal((await wake.status(older)).enabled, false);

  await registerAs('chat-A');
  const bridge = { adapters: { claude: { confirm: async () => true } }, paths: { mind, machine: HOST }, now: () => Date.now() };
  const request = { unitId: older.unitId, client: 'claude' };
  const registration = { unitId: older.unitId, unit: older.unit, client: 'claude', machine: HOST, nativeSessionId: 'chat-A' };
  assert.deepEqual(await initializeNativeEntry({ controller: wake, bridge, request, registration }), { attached: true });
  assert.equal((await wake.status(older)).enabled, true);
  assert.equal((await wake.status(newer)).enabled, false);
});

test('R-12: a consent whose chat answers its wakes drops the ids of read messages instead of pausing on the dedupe budget', async (context) => {
  const { mind, sender, binding } = await fixture(context);
  const woken = new Set();
  const wake = await controller(mind, async (delivery) => { for (const id of delivery.messageIds) woken.add(id); return { status: 'submitted' }; });
  context.after(() => wake.stopAll());
  await wake.enable(binding);
  // A long-lived consent: a thousand ids of messages that were woken and read long ago.
  const policyFile = policyFileOf(mind, binding);
  const policy = JSON.parse(await readFile(policyFile, 'utf8'));
  const at = new Date(Date.now() - 3600_000).toISOString();
  for (let index = 0; index < 1000; index += 1) {
    policy.deliveries[randomUUID()] = { state: 'submitted', attempts: 1, lastAttemptAt: at, submittedAt: at, threadId: null, priority: 'normal' };
  }
  await writeFile(policyFile, JSON.stringify(policy));
  const ids = [];
  for (let index = 0; index < 40; index += 1) ids.push((await sender.send({ to: binding.unit, subject: `new ${index}`, body: 'x' })).id);
  const handle = wake.start(binding);
  assert.equal((await handle.ready).ownsLease, true);
  await until(() => ids.every((id) => woken.has(id)), 'the new messages were not woken', 8000);
  const stored = async () => JSON.parse(await readFile(policyFile, 'utf8'));
  await until(async () => (await stored()).wakeCount > 0, 'the wake was not settled', 8000);
  const status = await wake.status(binding);
  assert.equal(status.pausedReason, null);
  assert.equal(status.worker.state, 'running');
  const kept = (await stored()).deliveries;
  assert.ok(Object.keys(kept).length <= 1024, 'the memory stays inside its budget');
  assert.ok(ids.every((id) => kept[id]?.state === 'submitted'), 'the ids that can still matter are all kept');
});

test('R-12: a chat whose wake paused on the dedupe budget is told once, with how to wake it again', async (context) => {
  const { mind, binding } = await fixture(context);
  const wake = await controller(mind, async () => ({ status: 'submitted' }));
  await wake.enable(binding);
  const policyFile = policyFileOf(mind, binding);
  const policy = JSON.parse(await readFile(policyFile, 'utf8'));
  await writeFile(policyFile, JSON.stringify({ ...policy, pausedReason: 'dedupe-budget-exhausted' }));
  const first = await wake.touch(binding);
  assert.match(first.notice, /1024 messages it already pointed to are still unread/);
  assert.match(first.notice, /relay wake attach/);
  assert.equal((await wake.touch(binding)).notice, null, 'the notice is given once');
});

test('R-19: the first liveness note that fails to land is tried again at the next poll, not a minute later', async (context) => {
  const { mind, binding } = await fixture(context);
  const wake = await controller(mind, async () => ({ status: 'submitted' }));
  const remote = await controller(mind, async () => ({ status: 'submitted' }), { hostname: 'OTHERBOX' });
  context.after(() => wake.stopAll());
  await wake.enable(binding);
  const policyFile = policyFileOf(mind, binding);
  let refused = 0;
  const restore = await interceptFs('rename', (renameOriginal, args) => {
    // A reader holds the policy while the worker publishes its first note: the whole write fails once.
    if (refused < 5 && path.resolve(String(args[1])) === path.resolve(policyFile)) {
      refused += 1;
      return Promise.reject(Object.assign(new Error('The file is held.'), { code: 'EPERM' }));
    }
    return renameOriginal(...args);
  });
  context.after(restore);
  const handle = wake.start(binding);
  assert.equal((await handle.ready).ownsLease, true);
  await until(() => refused === 5, 'the first note was not refused', 5000);
  await until(async () => (await remote.status(binding)).worker.state === 'running', 'the other machine did not see the worker', 5000);
  restore();
  await handle.stop();
});
