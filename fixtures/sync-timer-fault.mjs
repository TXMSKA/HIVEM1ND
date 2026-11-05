import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { createSyncCoordinator } from 'hivem1nd/sync';
import { createConsumer, createOrigin, fixtureClock, fixtureCodec, makeGroup } from './sync-consumer.mjs';

const [fault, root] = process.argv.slice(2);
assert.ok(['failure-record', 'rearm', 'issues-record', 'quarantine-record'].includes(fault));
const permanent = ['issues-record', 'quarantine-record'].includes(fault);
const origin = createOrigin(root);
const original = { rename: fs.rename, lstat: fs.lstat };
const secret = 'private-record-key-and-provider-path';
let unavailable = true;
let inject = false;
let faultEnabled = true;
let faults = 0;
const events = [];
let coordinator;

async function until(condition) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'timer work did not finish before the fixture deadline');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

try {
  const consumer = await createConsumer(root, 'WRITER');
  const group = await consumer.commit(makeGroup([{ target: { collection: 'consumer-table', row: 'retained-timer-group' } }]));
  const clock = fixtureClock();
  const codec = { ...fixtureCodec, async encode(bytes) {
    if (unavailable || permanent) {
      inject = true;
      throw Object.assign(new Error(secret), { code: permanent ? 'invalid_schema' : 'offline', retryable: !permanent });
    }
    return Buffer.from(bytes);
  } };
  coordinator = await createSyncCoordinator({ store: consumer.store, domain: consumer.domain,
    origin: origin.adapter(), codec, clock, events });
  await coordinator.changed([]);
  fs.rename = async (from, to) => {
    const destination = String(to);
    if (inject && faultEnabled && (fault === 'failure-record' && path.basename(destination) === 'failure.json'
      || fault === 'issues-record' && path.basename(destination) === 'issues.json'
      || fault === 'quarantine-record' && path.basename(path.dirname(destination)) === 'quarantine')) {
      faults += 1;
      throw Object.assign(new Error(secret), { code: 'EPERM' });
    }
    return original.rename(from, to);
  };
  fs.lstat = async (...args) => {
    if (fault === 'rearm' && inject && faultEnabled && path.basename(String(args[0])) === 'sync-ledger.json') {
      faults += 1;
      throw Object.assign(new Error(secret), { code: 'EPERM' });
    }
    return original.lstat(...args);
  };
  syncBuiltinESMExports();
  // A real setTimeout ignores the returned Promise. Strict rejection mode must remain alive in that case.
  clock.runNext();
  await until(() => faults > 0 && events.some(event => event.type === 'sync.error' && event.code === 'sync_failed'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(clock.timers > 0, 'a timer rejection must leave a scheduled retry');
  faultEnabled = false;
  inject = false;
  unavailable = false;
  let status = await coordinator.status();
  assert.equal(status.durableLocal, 1);
  assert.equal(status.publishedToOrigin, 0);
  const retained = status.groups.find(item => item.transactionId === group.transactionId);
  if (permanent) assert.ok(['pending', 'quarantined'].includes(retained.state));
  else {
    assert.equal(status.pending, 1);
    assert.equal(status.quarantined, 0);
    assert.equal(retained.state, 'pending');
  }
  await clock.runNext();
  if (!permanent) await until(() => origin.controls.publications.length === 1);
  await coordinator.close();
  status = await coordinator.status();
  assert.equal(status.pending, 0);
  assert.equal(status.publishedToOrigin, permanent ? 0 : 1);
  assert.equal(status.quarantined, permanent ? 1 : 0);
  if (permanent) assert.equal(status.groups[0].state, 'quarantined');
  assert.equal(origin.controls.publications.length, permanent ? 0 : 1);
  assert.equal(JSON.stringify({ status, events }).includes(secret), false);
  for (const event of events.filter(item => item.type === 'sync.error')) {
    assert.deepEqual(Object.keys(event).sort(), ['code', 'machine', 'operation', 'retryable', 'sequence', 'type']);
  }
  process.stdout.write(`${JSON.stringify({ fault, safeErrors: true, retained: true, published: permanent ? 0 : 1 })}\n`);
} finally {
  fs.rename = original.rename;
  fs.lstat = original.lstat;
  syncBuiltinESMExports();
  await coordinator?.close();
}
