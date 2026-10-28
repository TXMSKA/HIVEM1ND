import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { SYNC_API_VERSION, createSyncCoordinator } from 'hivem1nd/sync';
import { createFixture, filesBelow, fixtureClock, fixtureCodec, makeGroup, readJson } from '../fixtures/sync-consumer.mjs';

const execute = promisify(execFile);
const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = row => ({ collection: 'consumer-table', row });

async function setup(t) {
  const fixture = await createFixture();
  t.after(() => fixture.dispose());
  return fixture;
}

async function staged(consumer) {
  const files = (await filesBelow(consumer.store.localDirectory)).filter(file => path.basename(path.dirname(file)) === 'transactions' && file.endsWith('.json'));
  return (await Promise.all(files.map(file => readJson(file)))).filter(group => group.phase === 'staged').flatMap(group => group.changes);
}

async function journal(consumer) {
  const file = (await filesBelow(consumer.store.localDirectory)).find(file => path.basename(file) === 'publication.json');
  return file ? readJson(file) : null;
}

function safeError(error) {
  assert.deepEqual(Object.keys(error).sort(), ['code', 'machine', 'operation', 'retryable', 'sequence']);
  assert.equal(typeof error.code, 'string');
  assert.equal(typeof error.operation, 'string');
  assert.equal(typeof error.retryable, 'boolean');
  assert.ok(error.machine === null || typeof error.machine === 'string');
  assert.ok(error.sequence === null || Number.isSafeInteger(error.sequence));
  return true;
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('the supported package subpath exports only the v1 API and importing it owns no runtime', async (t) => {
  const fixture = await setup(t);
  assert.equal(SYNC_API_VERSION, 1);
  assert.equal(typeof createSyncCoordinator, 'function');
  const result = await execute(process.execPath, ['--input-type=module', '-e',
    "import assert from 'node:assert/strict'; import * as api from 'hivem1nd/sync'; assert.deepEqual(Object.keys(api).sort(), ['SYNC_API_VERSION','createSyncCoordinator']); assert.equal(api.SYNC_API_VERSION,1);"],
  { cwd: checkout, windowsHide: true, timeout: 5000, env: { ...process.env, TMP: fixture.root, TEMP: fixture.root } });
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, '');
});

test('a standalone Node consumer recovers a lost notification, applies once and retains work on close', async (t) => {
  const fixture = await setup(t);
  const result = await execute(process.execPath, ['fixtures/sync-consumer.mjs'], {
    cwd: checkout, windowsHide: true, timeout: 15000, env: { ...process.env, TMP: fixture.root, TEMP: fixture.root },
  });
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    apiVersion: 1, appliedTransactions: 2, lostNotificationRecovered: true, pendingCloseRecovered: true,
  });
});

test('retry after durable staging but before outbox acknowledgment preserves IDs, time and one publication', async (t) => {
  const fixture = await setup(t);
  const consumer = await fixture.consumer('WRITER');
  const group = await consumer.commit(makeGroup([{ target: target('first'), bytes: 'first' }, { target: target('second'), bytes: 'second' }]));
  let snapshot;
  consumer.control.beforeAck = async (transactionId, changeIds) => {
    assert.equal(transactionId, group.transactionId);
    snapshot = await staged(consumer);
    assert.equal(snapshot.length, 2, 'every group entry is durable before ackStaged');
    assert.deepEqual(snapshot.map(change => change.id).sort(), [...changeIds].sort());
    throw Object.assign(new Error('consumer outbox temporarily unavailable'), { code: 'offline', retryable: true });
  };
  let coordinator = await fixture.coordinator(consumer);
  assert.deepEqual(Object.keys(coordinator).sort(), ['changed', 'close', 'flush', 'resume', 'status']);
  await assert.rejects(coordinator.changed(group.entries.map(entry => entry.id)), error => safeError(error) && error.code === 'offline');
  assert.equal((await consumer.state()).outbox.length, 1);
  await coordinator.close();
  const restarted = await fixture.consumer('WRITER');
  const listCommitted = restarted.store.outbox.listCommitted;
  restarted.store.outbox.listCommitted = async () => (await listCommitted()).map(item => ({ ...item, entries: [...item.entries].reverse() }));
  restarted.control.beforeAck = async (_transactionId, changeIds) => assert.deepEqual(changeIds, snapshot.map(change => change.id));
  restarted.control.serialize = () => { throw new Error('a staged transaction must never be serialized again'); };
  coordinator = await fixture.coordinator(restarted);
  await coordinator.resume();
  assert.deepEqual(await staged(restarted), snapshot);
  assert.ok(snapshot.every(change => change.at === group.at && change.transactionId === group.transactionId));
  assert.equal((await restarted.state()).acknowledgments.length, 1);
  assert.deepEqual((await restarted.state()).acknowledgments[0].changeIds, snapshot.map(change => change.id));
  assert.equal((await coordinator.status()).quarantined, 0);
  const first = coordinator.flush();
  const second = coordinator.flush();
  assert.equal(first, second, 'flush callers share the in-flight Promise');
  await first;
  await coordinator.flush();
  assert.equal(fixture.origin.controls.publications.length, 1);
  assert.equal((await coordinator.status()).groups[0].state, 'published-to-origin');
});

test('domain rejection in one entry quarantines the entire group without staging, ack or publication', async (t) => {
  const fixture = await setup(t);
  const consumer = await fixture.consumer('WRITER');
  const group = await consumer.commit(makeGroup([{ target: target('approved') }, { target: target('rejected') }]));
  consumer.control.validate = entry => entry.target.row !== 'rejected';
  const coordinator = await fixture.coordinator(consumer);
  await coordinator.changed([group.entries[0].id]);
  await coordinator.flush();
  assert.deepEqual(await staged(consumer), []);
  assert.equal((await consumer.state()).outbox.length, 1);
  assert.equal((await consumer.state()).acknowledgments.length, 0);
  assert.equal(fixture.origin.controls.publications.length, 0);
  const status = await coordinator.status();
  assert.equal(status.quarantined, 1);
  assert.equal(status.groups[0].state, 'quarantined');
  const validations = consumer.control.validations;
  await coordinator.resume();
  assert.equal(consumer.control.validations, validations, 'a permanently rejected group is not retried');
});

test('null head and null pack remain pending without domain apply or checkpoint advancement', async (t) => {
  const fixture = await setup(t);
  const writer = await fixture.consumer('WRITER');
  await writer.commit(makeGroup([{ target: target('remote'), bytes: 'remote' }]));
  const first = await fixture.coordinator(writer);
  await first.flush();
  await first.close();
  fixture.origin.controls.hiddenHeads.add('WRITER');
  const receiver = await fixture.consumer('RECEIVER');
  const second = await fixture.coordinator(receiver);
  await second.resume();
  let status = await second.status();
  assert.equal(status.state, 'pending');
  assert.ok(status.incomingPending.some(item => item.code === 'head_missing'));
  assert.equal(receiver.control.applyCalls, 0);
  assert.equal((await filesBelow(receiver.store.localDirectory)).some(file => path.basename(file) === 'head.json'), false);
  fixture.origin.controls.hiddenHeads.clear();
  fixture.origin.controls.hiddenPacks.add('WRITER:1');
  await second.resume();
  status = await second.status();
  assert.ok(status.incomingPending.some(item => item.code === 'pack_missing'));
  assert.equal(receiver.control.applyCalls, 0);
  assert.equal((await filesBelow(receiver.store.localDirectory)).some(file => path.basename(file) === 'head.json'), false);
  fixture.origin.controls.hiddenPacks.clear();
  await second.resume();
  await second.resume();
  assert.equal((await receiver.state()).applied.length, 1);
  assert.equal((await second.status()).incomingPending.length, 0);
});

test('bad wire input is quarantined and errors contain no record content or encryption key', async (t) => {
  const fixture = await setup(t);
  const writer = await fixture.consumer('WRITER');
  const secret = 'private-record-and-secret-key-never-in-errors';
  await writer.commit(makeGroup([{ target: target('secret'), bytes: secret }]));
  const first = await fixture.coordinator(writer);
  await first.flush();
  await first.close();
  await fixture.origin.replacePack('WRITER', 1, Buffer.from(`malformed framing ${secret}`));
  const events = [];
  const receiver = await fixture.consumer('RECEIVER');
  const second = await fixture.coordinator(receiver, { events });
  await second.resume();
  let status = await second.status();
  assert.equal(status.quarantined, 1);
  assert.equal(status.lastError.retryable, false);
  assert.equal(status.lastError.code, 'invalid_pack');
  assert.equal(status.lastError.machine, 'WRITER');
  assert.equal(status.lastError.sequence, 1);
  assert.deepEqual(Object.keys(status.lastError).sort(), ['code', 'machine', 'operation', 'retryable', 'sequence']);
  assert.equal(receiver.control.applyCalls, 0);
  await second.resume();
  status = await second.status();
  assert.equal(status.quarantined, 1);
  assert.equal(events.filter(event => event.type === 'sync.error').length, 1, 'the same input is not repeatedly reported');
  assert.equal(JSON.stringify(events).includes(secret), false);
  const quarantine = (await filesBelow(receiver.store.localDirectory)).filter(file => path.basename(path.dirname(file)) === 'quarantine');
  assert.equal(quarantine.length, 1);
  assert.equal((await readFile(quarantine[0], 'utf8')).includes(secret), false);
});

test('an origin deadline aborts the callback and restart replays its unchanged durable publication', async (t) => {
  const fixture = await setup(t);
  const consumer = await fixture.consumer('WRITER');
  await consumer.commit(makeGroup([{ target: target('deadline'), bytes: 'retained after timeout' }]));
  let signal;
  fixture.origin.controls.publish = (_packet, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('provider stopped')), { once: true }));
  };
  let coordinator = await fixture.coordinator(consumer, { clock: {}, limits: { operationTimeoutMs: 500, retryDelayMs: 1000 } });
  await coordinator.flush();
  assert.equal(signal.aborted, true);
  const before = await journal(consumer);
  assert.equal(before.phase, 'prepared');
  assert.equal((await coordinator.status()).pending, 1);
  assert.equal((await coordinator.status()).lastError.code, 'deadline_exceeded');
  await coordinator.close();
  fixture.origin.controls.publish = null;
  coordinator = await fixture.coordinator(await fixture.consumer('WRITER'));
  await coordinator.resume();
  const after = await journal(consumer);
  assert.equal(after.phase, 'committed');
  assert.equal(after.packHash, before.packHash);
  assert.equal(after.sequence, before.sequence);
  assert.equal(fixture.origin.controls.publications.length, 1);
  assert.equal((await coordinator.status()).pending, 0);
});

test('close cancels an in-flight origin call, stops timers and notifications, and retains unfinished journals', async (t) => {
  const fixture = await setup(t);
  const consumer = await fixture.consumer('WRITER');
  await consumer.commit(makeGroup([{ target: target('close'), bytes: 'unfinished work' }]));
  const clock = fixtureClock();
  const entered = deferred();
  let signal;
  fixture.origin.controls.publish = (_packet, options) => {
    signal = options.signal;
    entered.resolve();
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled provider operation')), { once: true }));
  };
  const events = [];
  const coordinator = await fixture.coordinator(consumer, { clock, events });
  await coordinator.resume();
  assert.ok(clock.timers > 0);
  const flushing = coordinator.flush();
  await entered.promise;
  const closing = coordinator.close();
  assert.equal(closing, coordinator.close(), 'close is idempotent');
  await closing;
  await flushing;
  assert.equal(signal.aborted, true);
  assert.equal(clock.timers, 0);
  assert.equal(fixture.origin.controls.closes, 1);
  assert.equal(fixture.origin.controls.watchers.size, 0);
  assert.equal(fixture.origin.controls.unwatches, 1);
  const count = events.length;
  const calls = fixture.origin.controls.calls.length;
  fixture.origin.notify();
  await coordinator.changed(['missed-after-close']);
  await coordinator.resume();
  assert.equal(events.length, count);
  assert.equal(fixture.origin.controls.calls.length, calls);
  assert.equal((await journal(consumer)).phase, 'prepared');
  assert.equal((await staged(consumer)).length, 1);
  assert.equal((await coordinator.status()).closed, true);
  fixture.origin.controls.publish = null;
  const restarted = await fixture.coordinator(await fixture.consumer('WRITER'));
  await restarted.resume();
  assert.equal((await restarted.status()).pending, 0);
  assert.equal(fixture.origin.controls.publications.length, 1);
});

test('status distinguishes durable local, staged pending, filesystem publication and provider confirmation', async (t) => {
  const fixture = await setup(t);
  const consumer = await fixture.consumer('WRITER');
  const firstGroup = await consumer.commit(makeGroup([{ target: target('filesystem') }]));
  const coordinator = await fixture.coordinator(consumer);
  let status = await coordinator.status();
  assert.equal(status.groups[0].state, 'durable-local');
  assert.equal(status.durableLocal, 1);
  assert.equal(status.publishedToOrigin, 0);
  assert.equal(status.providerConfirmed, 0);
  await coordinator.changed([]);
  status = await coordinator.status();
  assert.equal(status.groups[0].state, 'pending');
  assert.equal(status.pending, 1);
  await coordinator.flush();
  status = await coordinator.status();
  assert.equal(status.state, 'published-to-origin');
  assert.equal(status.groups.find(group => group.transactionId === firstGroup.transactionId).state, 'published-to-origin');
  assert.equal(status.publishedToOrigin, 1);
  assert.equal(status.providerConfirmed, 0);
  fixture.origin.controls.ackScope = 'provider-confirmed';
  const secondGroup = await consumer.commit(makeGroup([{ target: target('provider') }]));
  await coordinator.flush();
  status = await coordinator.status();
  assert.equal(status.state, 'provider-confirmed');
  assert.equal(status.groups.find(group => group.transactionId === secondGroup.transactionId).state, 'provider-confirmed');
  assert.equal(status.publishedToOrigin, 2);
  assert.equal(status.providerConfirmed, 1);
  assert.equal(status.pending, 0);
});

test('origin change and watch errors enter the same incoming reconciliation path', async (t) => {
  const fixture = await setup(t);
  const writer = await fixture.consumer('WRITER');
  const receiver = await fixture.consumer('RECEIVER');
  const first = await fixture.coordinator(writer);
  const second = await fixture.coordinator(receiver);
  await second.resume();
  await writer.commit(makeGroup([{ target: target('watched') }]));
  await first.flush();
  const before = fixture.origin.controls.calls.filter(call => call.operation === 'reconcile').length;
  fixture.origin.notify();
  await second.resume();
  assert.equal((await receiver.state()).applied.length, 1);
  fixture.origin.notify(Object.assign(new Error('watch disconnected'), { code: 'offline', retryable: true }));
  await second.resume();
  assert.equal((await receiver.state()).applied.length, 1);
  assert.ok(fixture.origin.controls.calls.filter(call => call.operation === 'reconcile').length >= before + 4);
});

test('the domain idempotency transaction recovers an interrupted incoming journal without duplicate effects', async (t) => {
  const fixture = await setup(t);
  const writer = await fixture.consumer('WRITER');
  const group = await writer.commit(makeGroup([{ target: target('journal'), bytes: 'atomic effect' }]));
  const first = await fixture.coordinator(writer);
  await first.flush();
  const receiver = await fixture.consumer('RECEIVER');
  const apply = receiver.domain.applyAtomic;
  let crash = true;
  receiver.domain.applyAtomic = async (...args) => {
    const result = await apply(...args);
    if (crash) { crash = false; throw Object.assign(new Error('crash after consumer commit'), { code: 'offline', retryable: true }); }
    return result;
  };
  let second = await fixture.coordinator(receiver);
  await second.resume();
  assert.equal((await receiver.state()).applied.length, 1);
  assert.equal((await receiver.state()).applied[0].transactionId, group.transactionId);
  assert.ok((await second.status()).incomingPending.length > 0);
  await second.close();
  second = await fixture.coordinator(await fixture.consumer('RECEIVER'));
  await second.resume();
  await second.resume();
  assert.equal((await receiver.state()).applied.length, 1);
  assert.equal((await second.status()).incomingPending.length, 0);
});

test('a retained publication after an acknowledgment loss reuses immutable packet bytes through origin callbacks', async (t) => {
  const fixture = await setup(t);
  const consumer = await fixture.consumer('WRITER');
  await consumer.commit(makeGroup([{ target: target('ack-lost') }]));
  let once = true;
  fixture.origin.controls.publish = async (packet, options, publish) => {
    const ack = await publish(packet, options);
    if (once) { once = false; throw Object.assign(new Error('acknowledgment lost'), { code: 'offline', retryable: true }); }
    return ack;
  };
  let coordinator = await fixture.coordinator(consumer);
  await coordinator.flush();
  const before = await journal(consumer);
  assert.equal(before.phase, 'prepared');
  await coordinator.close();
  coordinator = await fixture.coordinator(await fixture.consumer('WRITER'));
  await coordinator.resume();
  const packets = fixture.origin.controls.publications;
  assert.equal(packets.length, 2);
  assert.equal(packets[0].sequence, packets[1].sequence);
  assert.equal(packets[0].digest, packets[1].digest);
  assert.deepEqual(packets[0].bytes, packets[1].bytes);
  assert.equal((await journal(consumer)).phase, 'committed');
  assert.equal((await coordinator.status()).publishedToOrigin, 1);
  assert.ok(fixture.origin.controls.calls.some(call => call.operation === 'readHead'));
});

test('a timer publication and simultaneous changed notification share the same in-flight journal recovery', async (t) => {
  const fixture = await setup(t);
  const consumer = await fixture.consumer('WRITER');
  await consumer.commit(makeGroup([{ target: target('timer-overlap') }]));
  const entered = deferred();
  const release = deferred();
  const clock = fixtureClock();
  let calls = 0;
  let active = 0;
  let maximum = 0;
  fixture.origin.controls.publish = async (packet, options, publish) => {
    calls += 1;
    active += 1;
    maximum = Math.max(maximum, active);
    entered.resolve();
    await release.promise;
    try { return await publish(packet, options); } finally { active -= 1; }
  };
  const coordinator = await fixture.coordinator(consumer, { clock });
  await coordinator.changed([]);
  const timerFlush = clock.runNext();
  await entered.promise;
  const changed = coordinator.changed([]);
  try {
    // Let callback I/O settle while the original provider acknowledgment is deliberately held.
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(calls, 1, 'notification recovery cannot publish a journal already in flight');
  } finally { release.resolve(); }
  await Promise.all([timerFlush, changed]);
  assert.equal(maximum, 1);
  assert.equal(fixture.origin.controls.publications.length, 1);
  assert.equal((await coordinator.status()).pending, 0);
});

test('non-retryable codec rejection durably quarantines the whole group across flush, resume and restart', async (t) => {
  const fixture = await setup(t);
  const consumer = await fixture.consumer('WRITER');
  const group = await consumer.commit(makeGroup([{ target: target('codec-first') }, { target: target('codec-second') }]));
  let encodes = 0;
  const codec = { ...fixtureCodec,
    async encode() {
      encodes += 1;
      throw Object.assign(new Error('sensitive body and encryption key'), { code: 'invalid_schema', retryable: false });
    },
  };
  let coordinator = await fixture.coordinator(consumer, { codec });
  await coordinator.flush();
  const attempted = encodes;
  assert.ok(attempted > 0);
  let status = await coordinator.status();
  assert.equal(status.groups[0].state, 'quarantined');
  assert.equal(status.quarantined, 1);
  assert.equal(status.pending, 0);
  assert.equal(status.lastError.retryable, false);
  assert.deepEqual((await staged(consumer)).map(change => change.id).sort(), group.entries.map(entry => entry.id).sort());
  await coordinator.flush();
  await coordinator.resume();
  await coordinator.close();
  coordinator = await fixture.coordinator(await fixture.consumer('WRITER'), { codec });
  await coordinator.resume();
  await coordinator.flush();
  status = await coordinator.status();
  assert.equal(status.groups[0].state, 'quarantined');
  assert.equal(status.quarantined, 1);
  assert.equal((await staged(consumer)).length, 2);
  assert.equal(encodes, attempted, 'a permanently rejected staged group cannot call the codec again');
  assert.equal(fixture.origin.controls.publications.length, 0);
  assert.equal(JSON.stringify(status).includes('sensitive body and encryption key'), false);
});

test('malformed committed bytes quarantine the complete group before any domain validation', async (t) => {
  const fixture = await setup(t);
  const consumer = await fixture.consumer('WRITER');
  const group = await consumer.commit(makeGroup([{ target: target('valid-shape') }, { target: target('invalid-bytes') }]));
  const malformed = { ...group, entries: group.entries.map((entry, index) => index === 1 ? { ...entry, bytes: 42 } : entry) };
  consumer.store.outbox.listCommitted = async () => [malformed];
  const coordinator = await fixture.coordinator(consumer);
  await coordinator.changed(group.entries.map(entry => entry.id));
  await coordinator.flush();
  assert.equal(consumer.control.validations, 0);
  assert.deepEqual(await staged(consumer), []);
  assert.equal((await consumer.state()).acknowledgments.length, 0);
  assert.equal(fixture.origin.controls.publications.length, 0);
  const status = await coordinator.status();
  assert.equal(status.groups[0].state, 'quarantined');
  assert.equal(status.quarantined, 1);
  assert.equal(status.lastError.code, 'invalid_body');
  assert.equal(status.lastError.retryable, false);
  await coordinator.resume();
  assert.equal(consumer.control.validations, 0);
});

test('a provider cannot expose its arbitrary error operation in rejections, notifications or status', async (t) => {
  const fixture = await setup(t);
  const consumer = await fixture.consumer('WRITER');
  const events = [];
  const origin = fixture.origin.adapter();
  origin.reconcile = async ({ signal }) => {
    assert.ok(signal instanceof AbortSignal);
    throw Object.assign(new Error('CryptoSecretKey'), { code: 'offline', retryable: true, operation: 'CryptoSecretKey' });
  };
  const coordinator = await fixture.coordinator(consumer, { origin, events });
  await assert.rejects(coordinator.resume(), error => {
    safeError(error);
    assert.equal(error.operation, 'reconcile');
    assert.equal(error.message.includes('CryptoSecretKey'), false);
    return true;
  });
  assert.equal(events.filter(event => event.type === 'sync.error').length, 1);
  assert.equal(events.find(event => event.type === 'sync.error').operation, 'reconcile');
  assert.equal((await coordinator.status()).lastError.operation, 'reconcile');
  assert.equal(JSON.stringify({ events, status: await coordinator.status() }).includes('CryptoSecretKey'), false);
});

for (const failure of ['permanent-rejection', 'invalid-acknowledgment']) {
  test(`${failure} quarantines a prepared publication without retrying its packet after restart`, async (t) => {
    const fixture = await setup(t);
    const consumer = await fixture.consumer('WRITER');
    const group = await consumer.commit(makeGroup([{ target: target('rejected-first') }, { target: target('rejected-second') }]));
    let attempts = 0;
    fixture.origin.controls.publish = async (packet, options, publish) => {
      attempts += 1;
      if (failure === 'permanent-rejection') {
        throw Object.assign(new Error('provider permanently refuses this packet'), { code: 'invalid_schema', retryable: false });
      }
      const acknowledgment = await publish(packet, options);
      return { ...acknowledgment, sequence: packet.sequence + 1 };
    };
    let coordinator = await fixture.coordinator(consumer);
    await coordinator.flush();
    assert.equal(attempts, 1);
    const before = await journal(consumer);
    assert.equal(before.phase, 'quarantined');
    let status = await coordinator.status();
    assert.equal(status.groups[0].state, 'quarantined');
    assert.equal(status.pending, 0);
    assert.equal(status.publishedToOrigin, 0);
    const blockedGroup = await consumer.commit(makeGroup([{ target: target('blocked-next') }]));
    await coordinator.resume();
    const blocked = await coordinator.flush();
    assert.equal(blocked.publicationBlocked, true);
    assert.equal(blocked.pending, 1, 'flush reports the valid group waiting behind a permanently blocked journal');
    assert.equal(blocked.published, false);
    await coordinator.close();
    coordinator = await fixture.coordinator(await fixture.consumer('WRITER'));
    await coordinator.resume();
    assert.equal((await coordinator.flush()).pending, 1);
    status = await coordinator.status();
    assert.equal(status.groups.find(item => item.transactionId === group.transactionId).state, 'quarantined');
    assert.equal(status.groups.find(item => item.transactionId === blockedGroup.transactionId).state, 'pending');
    assert.deepEqual((await staged(consumer)).map(change => change.id).sort(), [...group.entries, ...blockedGroup.entries].map(entry => entry.id).sort());
    assert.equal((await journal(consumer)).packHash, before.packHash);
    assert.equal((await journal(consumer)).phase, 'quarantined');
    assert.equal(attempts, 1, 'a rejected immutable packet must remain retained without automatic republication');
  });
}

test('a bad peer codec input discovered during deduplication cannot quarantine a valid local transaction', async (t) => {
  const fixture = await setup(t);
  const peer = await fixture.consumer('PEER');
  await peer.commit(makeGroup([{ target: target('peer-record'), bytes: 'shared bytes' }]));
  let peerBytes;
  const peerCodec = { ...fixtureCodec, async encode(bytes) { peerBytes = Buffer.from(bytes); return bytes; } };
  const first = await fixture.coordinator(peer, { codec: peerCodec });
  await first.flush();
  await first.close();
  const local = await fixture.consumer('LOCAL');
  const group = await local.commit(makeGroup([{ target: target('local-record'), bytes: 'shared bytes' }]));
  let rejectedPeers = 0;
  const codec = { ...fixtureCodec,
    async decode(bytes) {
      if (Buffer.from(bytes).equals(peerBytes)) {
        rejectedPeers += 1;
        throw Object.assign(new Error('unusable peer key'), { code: 'authentication_failed', retryable: false });
      }
      return Buffer.from(bytes);
    },
  };
  const events = [];
  const second = await fixture.coordinator(local, { codec, events });
  await second.flush();
  assert.ok(rejectedPeers > 0, 'the local publication inspected and rejected the peer dependency candidate');
  const status = await second.status();
  assert.equal(status.groups.find(item => item.transactionId === group.transactionId).state, 'published-to-origin');
  assert.equal(status.pending, 0);
  assert.equal(status.publishedToOrigin, 1);
  assert.ok(status.quarantined > 0, 'the rejected peer input is retained separately');
  assert.ok(events.some(event => event.type === 'sync.error' && event.machine === 'PEER'));
  assert.equal(events.some(event => event.type === 'sync.error' && event.machine === 'LOCAL'), false);
  assert.equal(fixture.origin.controls.publications.filter(packet => packet.machine === 'LOCAL').length, 1);
});

test('multiple entries of one logical message share the one-megabyte transaction limit', async (t) => {
  const fixture = await setup(t);
  const consumer = await fixture.consumer('WRITER');
  const group = await consumer.commit(makeGroup([
    { target: target('message-part-one'), bytes: Buffer.alloc(600000, 'a'), messageId: 'one-logical-message' },
    { target: target('message-part-two'), bytes: Buffer.alloc(600000, 'b'), messageId: 'one-logical-message' },
  ]));
  const coordinator = await fixture.coordinator(consumer);
  await coordinator.changed(group.entries.map(entry => entry.id));
  await coordinator.flush();
  const status = await coordinator.status();
  assert.equal(status.groups[0].state, 'quarantined');
  assert.equal(status.lastError.code, 'message_too_large');
  assert.equal(status.lastError.retryable, false);
  assert.deepEqual(await staged(consumer), []);
  assert.equal((await consumer.state()).outbox.length, 1);
  assert.equal((await consumer.state()).acknowledgments.length, 0);
  assert.equal(fixture.origin.controls.publications.length, 0);
});

for (const mismatch of ['machine', 'sequence']) {
  test(`a pack with the wrong ${mismatch} for its listing is rejected before domain application`, async (t) => {
    const fixture = await setup(t);
    const writer = await fixture.consumer('WRITER');
    await writer.commit(makeGroup([{ target: target('first-source'), bytes: 'first source payload' }]));
    const first = await fixture.coordinator(writer);
    await first.flush();
    if (mismatch === 'sequence') {
      await writer.commit(makeGroup([{ target: target('second-source'), bytes: 'different second source payload' }]));
      await first.flush();
    }
    await first.close();
    const packet = fixture.origin.controls.publications.at(-1);
    const sourceHead = await fixture.origin.head('WRITER');
    const listedMachine = mismatch === 'machine' ? 'DIFFERENT-WRITER' : 'WRITER';
    const forgedHead = { ...sourceHead, machine: listedMachine, sequence: 1,
      packs: [{ ...sourceHead.packs.at(-1), sequence: 1, file: '000000000001.pack' }] };
    const origin = fixture.origin.adapter();
    origin.listMachines = async ({ signal }) => { assert.ok(signal instanceof AbortSignal); return [listedMachine]; };
    origin.readHead = async (machine, { signal }) => {
      assert.ok(signal instanceof AbortSignal);
      assert.equal(machine, listedMachine);
      return forgedHead;
    };
    origin.readPack = async (machine, sequence, { signal }) => {
      assert.ok(signal instanceof AbortSignal);
      assert.equal(machine, listedMachine);
      assert.equal(sequence, 1);
      return packet.bytes;
    };
    const receiver = await fixture.consumer('RECEIVER');
    const second = await fixture.coordinator(receiver, { origin });
    await second.resume();
    const status = await second.status();
    assert.equal(status.quarantined, 1);
    assert.equal(status.lastError.code, 'invalid_record_owner');
    assert.equal(status.lastError.retryable, false);
    assert.equal(status.lastError.machine, listedMachine);
    assert.equal(status.lastError.sequence, 1);
    assert.equal(receiver.control.validations, 0);
    assert.equal(receiver.control.applyCalls, 0);
    assert.equal((await receiver.state()).applied.length, 0);
    assert.equal((await filesBelow(receiver.store.localDirectory)).some(file => path.basename(file) === 'head.json'), false);
  });
}

test('a crashed process leaves durable pending work and concurrent restarts still admit only one owner', async (t) => {
  const fixture = await createFixture();
  const children = [];
  async function stop(child) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
  t.after(async () => {
    await Promise.all(children.map(stop));
    await fixture.dispose();
  });
  const consumer = await fixture.consumer('WRITER');
  const group = await consumer.commit(makeGroup([{ target: target('cross-process') }]));
  async function contender() {
    const child = spawn(process.execPath, ['fixtures/sync-owner-child.mjs', fixture.root, 'WRITER'], {
      cwd: checkout, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, TMP: fixture.root, TEMP: fixture.root },
    });
    children.push(child);
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const waiting = await once(child, 'message');
    assert.equal(waiting[0].type, 'waiting', stderr);
    return child;
  }
  async function start(child) {
    const response = once(child, 'message');
    child.send({ type: 'acquire' });
    return (await response)[0];
  }
  const original = await contender();
  const started = await start(original);
  assert.equal(started.type, 'acquired');
  assert.equal(started.status.pending, 1);
  const duplicate = await contender();
  const rejected = await start(duplicate);
  assert.equal(rejected.type, 'rejected');
  assert.equal(rejected.code, 'store_in_use');
  await stop(original);
  const [left, right] = await Promise.all([contender(), contender()]);
  const results = await Promise.all([start(left), start(right)]);
  assert.equal(results.filter(result => result.type === 'acquired').length, 1);
  assert.equal(results.filter(result => result.type === 'rejected' && result.code === 'store_in_use').length, 1);
  const winner = results[0].type === 'acquired' ? left : right;
  await stop(winner);
  const restarted = await fixture.coordinator(await fixture.consumer('WRITER'));
  await restarted.resume();
  assert.equal((await restarted.status()).groups[0].transactionId, group.transactionId);
  assert.equal((await restarted.status()).pending, 1);
  await restarted.flush();
  assert.equal((await restarted.status()).publishedToOrigin, 1);
  assert.equal(fixture.origin.controls.publications.length, 1);
});

for (const failure of [
  { code: 'encryption_key_missing' },
  { code: 'invalid_encryption_key' },
  { code: 'authentication_failed' },
  { code: 'invalid_schema', retryable: true, status: 422 },
]) {
  test(`${failure.code} during encoding retains and schedules the complete group when retryable`, async (t) => {
    const fixture = await setup(t);
    const consumer = await fixture.consumer('WRITER');
    const group = await consumer.commit(makeGroup([{ target: target('key-first') }, { target: target('key-second') }]));
    const clock = fixtureClock();
    let available = false;
    const codec = { ...fixtureCodec, async encode(bytes) {
      if (!available) throw Object.assign(new Error('local credential is temporarily unavailable'), failure);
      return Buffer.from(bytes);
    } };
    const coordinator = await fixture.coordinator(consumer, { codec, clock });
    const failed = await coordinator.flush();
    let status = await coordinator.status();
    assert.equal(failed.publicationBlocked, false);
    assert.equal(status.pending, 1);
    assert.equal(status.quarantined, 0);
    assert.equal(status.lastError.retryable, true);
    assert.deepEqual((await staged(consumer)).map(change => change.id).sort(), group.entries.map(entry => entry.id).sort());
    assert.ok(clock.timers > 0, 'a temporary credential failure retains a scheduled retry');
    available = true;
    await clock.runNext();
    status = await coordinator.status();
    assert.equal(status.pending, 0);
    assert.equal(status.publishedToOrigin, 1);
    assert.equal(fixture.origin.controls.publications.length, 1);
  });
}

test('an explicit permanent local-key callback error still quarantines the group', async (t) => {
  const fixture = await setup(t);
  const consumer = await fixture.consumer('WRITER');
  await consumer.commit(makeGroup([{ target: target('explicit-key-policy') }]));
  const codec = { ...fixtureCodec, async encode() {
    throw Object.assign(new Error('consumer explicitly rejects this input'), { code: 'encryption_key_missing', retryable: false });
  } };
  const coordinator = await fixture.coordinator(consumer, { codec });
  await coordinator.flush();
  const status = await coordinator.status();
  assert.equal(status.pending, 0);
  assert.equal(status.quarantined, 1);
  assert.equal(status.groups[0].state, 'quarantined');
  assert.equal(status.lastError.retryable, false);
  assert.equal(fixture.origin.controls.publications.length, 0);
});

for (const operation of [undefined, 'decode']) {
  test(`an expired publication credential${operation ? ' claiming a decode operation' : ''} retries the prepared packet with identical bytes`, async (t) => {
    const fixture = await setup(t);
    const consumer = await fixture.consumer('WRITER');
    await consumer.commit(makeGroup([{ target: target('provider-token') }]));
    const clock = fixtureClock();
    const attempts = [];
    let available = false;
    let encodes = 0;
    const codec = { ...fixtureCodec, async encode(bytes) { encodes += 1; return Buffer.from(bytes); } };
    fixture.origin.controls.publish = async (packet, options, publish) => {
      attempts.push({ ...packet, bytes: Buffer.from(packet.bytes) });
      if (!available) throw Object.assign(new Error('expired provider token'), { code: 'authentication_failed', operation });
      return publish(packet, options);
    };
    const coordinator = await fixture.coordinator(consumer, { codec, clock });
    await coordinator.flush();
    const before = await journal(consumer);
    const encoded = encodes;
    assert.equal(before.phase, 'prepared');
    assert.equal((await coordinator.status()).publicationBlocked, false);
    assert.equal((await coordinator.status()).quarantined, 0);
    assert.equal((await coordinator.status()).lastError.operation, 'publishPack');
    assert.equal((await coordinator.status()).lastError.retryable, true);
    assert.ok(clock.timers > 0);
    available = true;
    await clock.runNext();
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1].sequence, attempts[0].sequence);
    assert.equal(attempts[1].digest, attempts[0].digest);
    assert.deepEqual(attempts[1].bytes, attempts[0].bytes);
    assert.equal(encodes, encoded, 'recovery publishes the durable packet without encoding it again');
    assert.equal((await journal(consumer)).phase, 'committed');
    assert.equal((await coordinator.status()).pending, 0);
  });
}

for (const code of ['encryption_key_missing', 'invalid_encryption_key']) {
  test(`${code} while decoding remains pending until the receiver key becomes available`, async (t) => {
    const fixture = await setup(t);
    const writer = await fixture.consumer('WRITER');
    await writer.commit(makeGroup([{ target: target('receiver-key') }]));
    const first = await fixture.coordinator(writer);
    await first.flush();
    await first.close();
    const receiver = await fixture.consumer('RECEIVER');
    let available = false;
    const codec = { ...fixtureCodec, async decode(bytes) {
      if (!available) throw Object.assign(new Error('receiver keychain is locked'), { code });
      return Buffer.from(bytes);
    } };
    const second = await fixture.coordinator(receiver, { codec });
    await second.resume();
    const pending = await second.status();
    assert.equal(pending.quarantined, 0);
    assert.equal(pending.lastError.retryable, true);
    assert.ok(pending.incomingPending.some(item => item.code === code));
    assert.equal(receiver.control.applyCalls, 0);
    available = true;
    await second.resume();
    await second.resume();
    assert.equal((await receiver.state()).applied.length, 1);
    assert.equal(receiver.control.applyCalls, 1);
    assert.equal((await second.status()).incomingPending.length, 0);
  });
}

test('failed authenticated decryption without an explicit retry policy quarantines the input', async (t) => {
  const fixture = await setup(t);
  const writer = await fixture.consumer('WRITER');
  await writer.commit(makeGroup([{ target: target('authenticated-bytes') }]));
  const first = await fixture.coordinator(writer);
  await first.flush();
  await first.close();
  const receiver = await fixture.consumer('RECEIVER');
  const codec = { ...fixtureCodec, async decode() {
    throw Object.assign(new Error('the input authentication tag failed'), { code: 'authentication_failed' });
  } };
  const second = await fixture.coordinator(receiver, { codec });
  await second.resume();
  const status = await second.status();
  assert.equal(status.quarantined, 1);
  assert.equal(status.lastError.code, 'authentication_failed');
  assert.equal(status.lastError.retryable, false);
  assert.equal(receiver.control.applyCalls, 0);
});

for (const rejection of ['schema', 'codec-version', 'applyAtomic']) {
  test(`resume rechecks a ${rejection} quarantine and unblocks later immutable packs`, async (t) => {
    const fixture = await setup(t);
    const writer = await fixture.consumer('WRITER');
    const writerCodec = { ...fixtureCodec, version: rejection === 'codec-version' ? 2 : 1 };
    const first = await fixture.coordinator(writer, { codec: writerCodec });
    const groups = [];
    for (const row of ['blocked-first', 'waiting-second']) {
      groups.push(await writer.commit(makeGroup([{ target: target(row), bytes: row }])));
      await first.flush();
    }
    await first.close();
    const receiver = await fixture.consumer('RECEIVER');
    const codec = { ...fixtureCodec };
    if (rejection === 'schema') receiver.control.validate = entry => entry.target.row !== 'blocked-first';
    if (rejection === 'applyAtomic') receiver.control.beforeApply = () => {
      throw Object.assign(new Error('consumer schema is not ready'), { code: 'invalid_schema', retryable: false });
    };
    const second = await fixture.coordinator(receiver, { codec });
    await second.resume();
    assert.equal((await second.status()).quarantined, 1);
    assert.equal((await receiver.state()).applied.length, 0);
    assert.equal(receiver.control.applyCalls, rejection === 'applyAtomic' ? 1 : 0);
    const validations = receiver.control.validations;
    fixture.origin.notify();
    await second.changed([]);
    assert.equal(receiver.control.validations, validations, 'watch notifications cannot repeatedly retry quarantined input');
    if (rejection === 'applyAtomic') {
      receiver.control.beforeApply = null;
      receiver.control.validate = () => false;
      await second.resume();
      assert.equal(receiver.control.applyCalls, 1, 'the retained apply journal must pass current domain validation before retry');
      assert.equal((await receiver.state()).applied.length, 0);
    }
    receiver.control.validate = null;
    receiver.control.beforeApply = null;
    codec.version = writerCodec.version;
    await second.resume();
    await second.resume();
    const state = await receiver.state();
    assert.deepEqual(state.applied.map(group => group.transactionId), groups.map(group => group.transactionId));
    assert.equal(receiver.control.applyCalls, rejection === 'applyAtomic' ? 3 : 2);
    assert.equal((await second.status()).incomingPending.length, 0);
    assert.equal((await second.status()).quarantined, 0);
    assert.deepEqual(fixture.origin.controls.publications.map(packet => packet.sequence), [1, 2]);
  });
}

test('an invalid listed machine is safely reported while valid machines still receive and publish', async (t) => {
  const fixture = await setup(t);
  const peer = await fixture.consumer('PEER');
  await peer.commit(makeGroup([{ target: target('valid-peer') }]));
  const first = await fixture.coordinator(peer);
  await first.flush();
  await first.close();
  const consumer = await fixture.consumer('LOCAL');
  await consumer.commit(makeGroup([{ target: target('valid-local') }]));
  const secret = '../private-provider-credential';
  const origin = fixture.origin.adapter();
  origin.listMachines = async ({ signal }) => {
    assert.ok(signal instanceof AbortSignal);
    return [secret, 'PEER', 'LOCAL', 'PEER'];
  };
  const readHead = origin.readHead;
  origin.readHead = async (machine, options) => {
    assert.notEqual(machine, secret, 'an invalid listing must never reach another origin callback');
    return readHead(machine, options);
  };
  const events = [];
  const coordinator = await fixture.coordinator(consumer, { origin, events });
  await coordinator.resume();
  await coordinator.flush();
  const status = await coordinator.status();
  assert.equal((await consumer.state()).applied.length, 1);
  assert.equal(status.publishedToOrigin, 1);
  assert.equal(status.pending, 0);
  const failures = events.filter(event => event.type === 'sync.error');
  assert.ok(failures.length > 0);
  for (const { type: _type, ...error } of failures) {
    safeError(error);
    assert.equal(error.machine, null);
    assert.equal(error.operation, 'listMachines');
    assert.equal(error.code, 'invalid_name');
  }
  assert.equal(JSON.stringify({ events, status }).includes(secret), false);
  assert.equal(fixture.origin.controls.publications.filter(packet => packet.machine === 'LOCAL').length, 1);
});

test('resume clears both dependency and incoming codec quarantines after the consumer policy changes', async (t) => {
  const fixture = await setup(t);
  const writer = await fixture.consumer('WRITER');
  const remote = await writer.commit(makeGroup([{ target: target('remote-codec-two'), bytes: 'remote codec two' }]));
  const first = await fixture.coordinator(writer, { codec: { ...fixtureCodec, version: 2 } });
  await first.flush();
  await first.close();
  const receiver = await fixture.consumer('RECEIVER');
  const local = await receiver.commit(makeGroup([{ target: target('local-codec-one'), bytes: 'local codec one' }]));
  const codec = { ...fixtureCodec };
  const second = await fixture.coordinator(receiver, { codec });
  await second.flush();
  let status = await second.status();
  assert.equal(status.groups.find(group => group.transactionId === local.transactionId).state, 'published-to-origin');
  assert.equal(status.quarantined, 1, 'dependency inspection retains the rejected peer input separately');
  await second.resume();
  assert.equal((await second.status()).quarantined, 2, 'incoming reconciliation also retains the rejected immutable packet');
  assert.equal(receiver.control.applyCalls, 0);
  codec.version = 2;
  await second.resume();
  await second.resume();
  status = await second.status();
  assert.deepEqual((await receiver.state()).applied.map(group => group.transactionId), [remote.transactionId]);
  assert.equal(receiver.control.applyCalls, 1);
  assert.equal(status.quarantined, 0);
  assert.equal(status.incomingPending.length, 0);
  assert.equal(status.publishedToOrigin, 1);
});

for (const scenario of [
  { operation: 'listMachines', published: false },
  { operation: 'listMachines', published: true },
  { operation: 'readHead', published: true },
]) {
  test(`an unrelated ${scenario.operation} failure preserves scheduling ${scenario.published ? 'after a committed packet' : 'before any packet'}`, async (t) => {
    const fixture = await setup(t);
    const consumer = await fixture.consumer('WRITER');
    const clock = fixtureClock();
    const origin = fixture.origin.adapter();
    const original = origin[scenario.operation];
    let fail = false;
    origin[scenario.operation] = async (...args) => {
      if (fail) throw Object.assign(new Error('unrelated provider policy failure'), { code: 'invalid_schema', retryable: false });
      return original(...args);
    };
    const coordinator = await fixture.coordinator(consumer, { origin, clock });
    let published;
    if (scenario.published) {
      published = await consumer.commit(makeGroup([{ target: target('already-published') }]));
      await coordinator.flush();
    }
    const pending = await consumer.commit(makeGroup([{ target: target('still-pending') }]));
    await coordinator.changed([]);
    fail = true;
    await coordinator.flush();
    let status = await coordinator.status();
    assert.equal(status.groups.find(group => group.transactionId === pending.transactionId).state, 'pending');
    if (published) assert.equal(status.groups.find(group => group.transactionId === published.transactionId).state, 'published-to-origin');
    assert.equal(status.quarantined, 0);
    assert.equal(status.publicationBlocked, false);
    assert.equal(status.pending, 1);
    assert.ok(clock.timers > 0, 'unrelated failures cannot silently unschedule staged work');
    fail = false;
    await clock.runNext();
    status = await coordinator.status();
    assert.equal(status.pending, 0);
    assert.equal(status.publishedToOrigin, scenario.published ? 2 : 1);
    assert.equal(status.quarantined, 0);
  });
}

for (const fault of ['failure-record', 'rearm', 'issues-record', 'quarantine-record']) {
  test(`timer-driven ${fault} EPERM is handled safely and its durable group remains scheduled`, async (t) => {
    const fixture = await setup(t);
    const result = await execute(process.execPath, ['--unhandled-rejections=strict', 'fixtures/sync-timer-fault.mjs', fault, fixture.root], {
      cwd: checkout, windowsHide: true, timeout: 15000, env: process.env,
    });
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), { fault, safeErrors: true, retained: true,
      published: ['issues-record', 'quarantine-record'].includes(fault) ? 0 : 1 });
  });
}

test('a failed owner-claim unlink returns a safe close error and permits same-process recovery', async (t) => {
  const fixture = await setup(t);
  const result = await execute(process.execPath, ['--unhandled-rejections=strict', 'fixtures/sync-owner-release-fault.mjs', fixture.root], {
    cwd: checkout, windowsHide: true, timeout: 15000, env: process.env,
  });
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { safeClose: true, reacquired: true, pending: 1 });
});
