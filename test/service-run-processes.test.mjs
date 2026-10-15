import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { closeRunProcesses, cleanupRunAttempt, drainRunProcesses, ownRunProcess, stopRunStep, verifiedProcessWitness } from '../engine/service/run-processes.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

test('parent exit is independent of child-held stdout and an owned hung test closes without a timeout', async t => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const context = { store: fixture.store, paths: fixture.paths }, parent = new EventEmitter(), stdout = new EventEmitter();
  const binding = { runId: randomUUID(), attemptId: randomUUID(), sessionId: randomUUID() }, evidence = [];
  let hung = true, closedPipe = false; stdout.on('end', () => { closedPipe = true; });
  const handle = { identity: 'owned-job-creation-1', verify: async () => true,
    onExit: listener => { parent.on('exit', listener); return () => parent.off('exit', listener); },
    cleanup: async () => { hung = false; return { closed: true, identity: 'owned-job-creation-1' }; },
    stop: async () => { parent.emit('exit'); return { acknowledged: true }; } };
  await ownRunProcess(context, binding, handle, async witness => { assert.equal(verifiedProcessWitness(witness), true); evidence.push(witness.kind); });
  parent.emit('exit'); await drainRunProcesses(context);
  assert.deepEqual(evidence, ['exit', 'cleanup']); assert.equal(hung, false); assert.equal(closedPipe, false);
  assert.equal(verifiedProcessWitness({ ...binding, kind: 'exit' }), false);
  await closeRunProcesses(context);
});
test('recycled persisted PIDs, foreign/manual/service work and unsupported current-step stops never signal anything', async t => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture)); const context = { store: fixture.store, paths: fixture.paths };
  const binding = { runId: randomUUID(), attemptId: randomUUID(), sessionId: randomUUID() };
  await assert.rejects(ownRunProcess(context, binding, { pid: process.pid }, () => {}), { code: 'cleanup_unavailable' });
  await assert.rejects(cleanupRunAttempt(context, binding.runId, binding.attemptId, { stop: true }), { code: 'cleanup_unavailable' });
  let current = true, signals = 0;
  await ownRunProcess(context, binding, { identity: 'creation-1', verify: async () => current, onExit: () => () => {},
    cleanup: async () => { signals++; return { closed: true, identity: 'creation-1' }; } }, async () => {});
  await assert.rejects(stopRunStep(context, binding.runId, binding.attemptId), { code: 'cleanup_unavailable' });
  current = false;
  await assert.rejects(cleanupRunAttempt(context, binding.runId, binding.attemptId), { code: 'cleanup_unavailable' });
  assert.equal(signals, 0);
});
