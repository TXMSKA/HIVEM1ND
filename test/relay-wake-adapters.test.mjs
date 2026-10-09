import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { WAKE_ADAPTERS, getWakeAdapter } from '../engine/relay/wake-adapters.mjs';
import { createRelayWakeController } from '../engine/relay/wake.mjs';
import { createRelay } from '../engine/relay/store.mjs';
import { helpText, runCli } from '../cli/index.mjs';
import { makeRelayMind } from './relay-test-fixture.mjs';

test('every registered wake module exposes the same interface and supplies CLI help', () => {
  for (const [client, adapter] of Object.entries(WAKE_ADAPTERS)) {
    for (const method of ['capability', 'attachIdentity', 'validateRuntime', 'sendPointer', 'spawnWorker']) {
      assert.equal(typeof adapter[method], 'function', client + '.' + method);
    }
    assert.equal(typeof adapter.workerDependency, 'string'); assert.equal(typeof adapter.label, 'string');
    assert.ok(Array.isArray(adapter.helpLines));
    assert.ok(helpText().includes(client));
    for (const line of adapter.helpLines) assert.ok(helpText().includes(line));
  }
  assert.equal(getWakeAdapter('__proto__'), null); assert.equal(getWakeAdapter('toString'), null); assert.equal(getWakeAdapter('unknown'), null);
});

test('existing adapter metadata preserves native attachment, timing, loop caps and deferral behavior', () => {
  const env = { CLAUDE_CODE_SESSION_ID: 'native-claude', CODEX_THREAD_ID: 'caller-codex' };
  assert.throws(() => WAKE_ADAPTERS.claude.attachIdentity({ nativeSessionId: 'another-session', env }), /runs inside the target session/);
  const { warning, ...claudeIdentity } = WAKE_ADAPTERS.claude.attachIdentity({ nativeSessionId: 'native-claude', env });
  assert.deepEqual(claudeIdentity, {
    nativeSessionId: 'native-claude', sessionId: 'native-claude', requireRegistration: false, activity: null,
  });
  assert.match(warning, /relay configure --client claude/);
  assert.deepEqual(WAKE_ADAPTERS.codex.attachIdentity({ nativeSessionId: 'target', env }), {
    nativeSessionId: 'target', sessionId: 'caller-codex', requireRegistration: true,
  });
  for (const client of ['codex', 'cursor', 'opencode', 'host', 'antigravity', 'copilot']) {
    assert.throws(() => WAKE_ADAPTERS[client].attachIdentity({ env }), /explicit --native-session-id/);
  }
  assert.equal(WAKE_ADAPTERS.cursor.stopLoopLimit, 5);
  assert.deepEqual(WAKE_ADAPTERS.cursor.controllerOptions, { retryPolicy: { sinkTimeoutMs: 15_000, leaseMs: 30_000 } });
  for (const client of ['claude', 'codex', 'cursor', 'copilot']) assert.notEqual(WAKE_ADAPTERS[client].acceptsDeferred, true);
  for (const client of ['opencode', 'host']) assert.equal(WAKE_ADAPTERS[client].acceptsDeferred, true);
});

test('a new table entry supplies the entire CLI attach and sink path without client-specific controller code', async () => {
  const calls = [], env = {};
  const adapter = { label: 'fixture', capability: () => { calls.push('capability'); return { available: true }; },
    attachIdentity: ({ nativeSessionId }) => ({ nativeSessionId, sessionId: 'fixture-instance', requireRegistration: true }),
    validateRuntime: async () => { calls.push('runtime'); }, sendPointer: (delivery) => { calls.push(['pointer', delivery]); return { status: 'submitted' }; },
    spawnWorker: () => { calls.push('worker'); return { ready: Promise.resolve({ state: 'running', ownsLease: true }) }; },
    workerDependency: 'fixtureWorker', controllerOptions: { retryPolicy: { sinkTimeoutMs: 8000, leaseMs: 20000 } }, helpLines: [] };
  let setup;
  const stdout = new PassThrough(), stderr = new PassThrough();
  const code = await runCli(['relay', 'wake', 'attach', '--mind-path', 'fixture-mind', '--unit', 'overseer',
    '--native-session-id', 'fixture-native', '--client', 'fixture'], {
    env, stdout, stderr, wakeAdapters: { fixture: adapter },
    createRelayWakeController: async (options) => { setup = options; return { enable: async () => ({ enabled: true }) }; },
    createRelay: async (options) => {
      assert.equal(options.sessionId, 'fixture-instance');
      return { reminder: async () => ({ registered: true, unit: 'overseer' }), register: () => assert.fail('cannot create registration') };
    },
  });
  assert.equal(code, 0); assert.deepEqual(calls, ['capability', 'runtime', 'worker']);
  assert.deepEqual(setup.retryPolicy, adapter.controllerOptions.retryPolicy);
  assert.equal((await setup.sink({ text: 'fixture-pointer' })).status, 'submitted');
  assert.equal(calls.at(-1)[1].text, 'fixture-pointer'); assert.equal(calls.at(-1)[1].env, env);
});

test('controller honors a new adapter table entry busy deferral without consuming retry or handoff budgets', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-table-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const mind = await makeRelayMind(root);
  const binding = { unit: 'overseer', nativeSessionId: 'fixture-native', client: 'fixture', machine: os.hostname() };
  const relay = await createRelay({ mindPath: mind, client: 'fixture', sessionId: 'fixture-instance' });
  await relay.register({ unit: binding.unit, nativeSessionId: binding.nativeSessionId, client: binding.client });
  await relay.send({ to: 'overseer', subject: 's', body: 'private' });
  let attempts = 0, idle = false;
  const wake = await createRelayWakeController({ mindPath: mind, pollIntervalMs: 250, adapters: { fixture: { acceptsDeferred: true } },
    sink: async () => { attempts++; return idle ? { status: 'submitted' } : { status: 'not_submitted', deferred: true }; } });
  context.after(() => wake.stopAll());
  await wake.enable(binding); const worker = wake.start(binding); await worker.ready;
  async function until(predicate) {
    const deadline = Date.now() + 60000;
    while (!await predicate()) { assert.ok(Date.now() < deadline, 'fixture worker timed out'); await new Promise((resolve) => setTimeout(resolve, 30)); }
  }
  await until(() => attempts >= 4); assert.equal((await wake.status(binding)).wakeCount, 0);
  idle = true; await until(async () => (await wake.status(binding)).wakeCount === 1);
  assert.equal((await relay.inbox()).unread, 1); await worker.stop();
});
