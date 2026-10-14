import './relay-local-state.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { carryHostConversation, hostSessionOf } from '../engine/relay/carry-over.mjs';
import { createRelay, relayLocalStatePath } from '../engine/relay/store.mjs';
import { createRelayWakeController } from '../engine/relay/wake.mjs';
import { serveRelayMcp } from '../engine/relay/mcp.mjs';
import { makeRelayMind } from './relay-test-fixture.mjs';

async function world(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-carry-owner-'));
  const mindPath = await makeRelayMind(root);
  const hostname = 'RELAYTEST';
  const relay = await createRelay({ mindPath, hostname, client: 'claude', sessionId: 'old-process' });
  const old = await relay.register({ unit: 'overseer', nativeSessionId: 'session-a', hostSessionId: 'host-one' });
  const binding = { unit: old.unit, unitId: old.unitId, nativeSessionId: old.nativeSessionId, client: old.client, machine: hostname };
  let now = Date.now();
  const controller = await createRelayWakeController({ mindPath, hostname, clock: { now: () => now, sleep: () => Promise.resolve() }, sink: async () => ({ status: 'not_submitted' }) });
  await controller.enable({ ...binding, windowHours: 8, maxHandoffs: 9, maxDailyHandoffs: 40 });
  // These tests inspect transfers, while the service intersection tests exercise the actual shared worker.
  const owner = { ...controller, start() { return { ready: Promise.resolve({ state: 'running' }) }; } };
  t.after(async () => { await controller.stopAll(); await rm(root, { recursive: true, force: true }); });
  const carry = (next, extra = {}) => carryHostConversation({ mindPath, hostname, binding: next, hostSessionId: 'host-one',
    controller: owner, proveBinding: async proof => proof.unitId === binding.unitId && proof.machine === hostname,
    ...extra });
  const successor = async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
    const registered = await relay.register({ unit: 'overseer', nativeSessionId: 'session-b' });
    return { ...binding, nativeSessionId: registered.nativeSessionId };
  };
  return { root, mindPath, hostname, relay, controller, binding, carry, successor, advance(ms) { now += ms; } };
}

test('a verified host conversation carries its unit and wake to the new native session without renewing consent', async t => {
  const w = await world(t), before = await w.controller.status(w.binding), next = await w.successor();
  const carried = await w.carry(next);
  assert.equal(carried.unitId, w.binding.unitId);
  const moved = await w.controller.status(next);
  assert.deepEqual([moved.deadlineAt, moved.durationHours, moved.wakeBudget, moved.dailyBudget], [before.deadlineAt, 8, 9, 40]);
  assert.equal((await w.controller.status(w.binding)).enabled, false);
  assert.equal((await w.relay.hostRegistration({ hostSessionId: 'host-one' })).nativeSessionId, next.nativeSessionId);
  const directory = path.join(w.mindPath, 'user', 'relay', 'sessions');
  const count = (await readdir(directory)).length;
  await w.carry(next);
  assert.equal((await readdir(directory)).length, count, 'a reconnect keeps the same registration instead of piling up records');
});

test('another host, unit, machine or unproved native binding carries nothing and a caller transcript cannot establish identity', async t => {
  const w = await world(t), next = await w.successor();
  for (const extra of [{ proveBinding: async () => false }, { hostname: 'OTHERBOX' }, { hostSessionId: null, transcriptPath: 'caller.jsonl' },
    { binding: { ...next, unitId: 'project:other:overseer' } }]) assert.equal(await w.carry(next, extra), null);
  const foreign = await w.relay.register({ unit: 'master', nativeSessionId: 'foreign-session', hostSessionId: 'foreign-host' });
  assert.equal(await w.carry(next, { hostSessionId: foreign.hostSessionId }), null);
  assert.equal((await w.controller.status(w.binding)).enabled, true);
});

test('disabled, expired and unanswered-exhausted consent is never revived by host carry-over', async t => {
  for (const reason of ['disabled', 'expired', 'exhausted']) {
    await t.test(reason, async t => {
      const w = await world(t);
      if (reason === 'disabled') await w.controller.disable(w.binding);
      if (reason === 'expired') w.advance(9 * 3600000);
      if (reason === 'exhausted') {
        const directory = path.join(w.mindPath, 'user', 'relay', 'wake', 'policies');
        const file = path.join(directory, (await readdir(directory))[0]);
        const policy = JSON.parse(await readFile(file, 'utf8'));
        await writeFile(file, JSON.stringify({ ...policy, wakeCount: 9, pausedReason: 'handoff-budget-exhausted' }));
      }
      const next = await w.successor();
      const carried = await w.carry(next);
      assert.equal(carried.binding, null);
      assert.equal((await w.controller.status(next)).enabled, false);
    });
  }
});

test('restarting a verified native connection retains the same consent, debt, daily usage and pointer identity', async t => {
  const w = await world(t);
  const directory = path.join(w.mindPath, 'user', 'relay', 'wake', 'policies');
  const file = path.join(directory, (await readdir(directory))[0]), policy = JSON.parse(await readFile(file, 'utf8'));
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const deliveries = { uncertain: { state: 'ambiguous', attempts: 1, lastAttemptAt: policy.startedAt },
    submitted: { state: 'submitted', attempts: 1, lastAttemptAt: policy.startedAt },
    pending: { state: 'not_submitted', attempts: 1, lastAttemptAt: policy.startedAt, retryAt: policy.startedAt } };
  await writeFile(file, JSON.stringify({ ...policy, wakeCount: 3, day: { date, count: 17 }, deliveries,
    pausedReason: 'error-budget-exhausted', consecutiveErrors: 5 }));
  await w.carry(w.binding);
  const resumed = await w.controller.status(w.binding);
  assert.deepEqual([resumed.enabled, resumed.wakeCount, resumed.dailyCount, resumed.dailyBudget, resumed.deadlineAt], [true, 3, 17, 40, policy.deadlineAt]);
  assert.deepEqual((await w.controller.adopt(w.binding)).deliveries, deliveries);
  const holders = path.join(relayLocalStatePath(w.mindPath), 'wake', 'holders');
  const holder = JSON.parse(await readFile(path.join(holders, (await readdir(holders))[0]), 'utf8'));
  assert.equal(Object.hasOwn(holder, 'pid'), false, 'the shared service PID never holds a chat');
});

test('a restarted MCP process answers for the exact served native session for every client', async t => {
  const w = await world(t);
  for (const client of ['claude', 'codex', 'cursor']) {
    const registered = await (await createRelay({ mindPath: w.mindPath, hostname: w.hostname, client })).register({ unit: 'overseer', nativeSessionId: `${client}-native` });
    for (let restart = 0; restart < 2; restart++) {
      const operations = await createRelay({ mindPath: w.mindPath, hostname: w.hostname, sessionId: `process-${client}-${restart}`, client, nativeSessionId: registered.nativeSessionId });
      const stdout = new PassThrough(), chunks = [];
      stdout.on('data', chunk => chunks.push(chunk));
      const stdin = new PassThrough();
      stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_inbox', arguments: {} } }) + '\n');
      await serveRelayMcp({ mindPath: w.mindPath, client, stdin, stdout, env: {}, operations });
      const result = JSON.parse(Buffer.concat(chunks).toString()).result;
      assert.equal(result.isError, undefined);
      assert.equal(result.structuredContent.unit, registered.unit);
    }
  }
  const foreign = await createRelay({ mindPath: w.mindPath, hostname: w.hostname, sessionId: 'old-process', client: 'claude', nativeSessionId: 'another-native' });
  await assert.rejects(foreign.inbox(), { code: 'NOT_REGISTERED' }, 'a reused correlation ID cannot adopt a different chat');
});

test('host conversation identities are bounded and never taken from a path or last-active chat', () => {
  assert.equal(hostSessionOf({ CLAUDE_CODE_HOST_SESSION_ID: 'host-one' }), 'host-one');
  for (const value of ['', 'bad\nidentity', 'x'.repeat(181)]) assert.equal(hostSessionOf({ CLAUDE_CODE_HOST_SESSION_ID: value }), null);
  assert.equal(hostSessionOf({ transcript_path: 'somewhere.jsonl' }), null);
});

test('a verified explicit registration can continue a legacy conversation without trusting its transcript', async t => {
  const w = await world(t);
  const next = await w.successor();
  const carried = await w.carry(next, { hostSessionId: 'newly-verified-host' });
  assert.equal(carried.unitId, w.binding.unitId);
  assert.equal(carried.binding.nativeSessionId, next.nativeSessionId);
});

test('a host record whose old native session now speaks for another unit cannot transfer its consent', async t => {
  const w = await world(t);
  await w.relay.register({ unit: 'master', nativeSessionId: w.binding.nativeSessionId, activity: 'active' });
  const next = await w.successor();
  assert.equal((await w.carry(next)).binding, null);
  assert.equal((await w.controller.status(next)).enabled, false);
});
