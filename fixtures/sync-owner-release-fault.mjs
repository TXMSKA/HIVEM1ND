import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { createSyncCoordinator } from 'hivem1nd/sync';
import { createConsumer, createOrigin, fixtureClock, fixtureCodec, makeGroup } from './sync-consumer.mjs';

const root = process.argv[2];
const originalUnlink = fs.unlink;
const origin = createOrigin(root);
const secret = 'private-owner-claim-path-and-key';
let first;
let second;
let faults = 0;

try {
  const consumer = await createConsumer(root, 'WRITER');
  const group = await consumer.commit(makeGroup([{ target: { collection: 'consumer-table', row: 'retained-owner-release' } }]));
  const create = () => createSyncCoordinator({ store: consumer.store, domain: consumer.domain,
    origin: origin.adapter(), codec: fixtureCodec, clock: fixtureClock() });
  first = await create();
  await first.changed([]);
  assert.equal((await first.status()).pending, 1);
  fs.unlink = async (file) => {
    if (path.basename(path.dirname(String(file))) === 'owners') {
      faults += 1;
      throw Object.assign(new Error(secret), { code: 'EPERM', path: secret, dest: secret });
    }
    return originalUnlink(file);
  };
  syncBuiltinESMExports();
  await assert.rejects(first.close(), error => {
    assert.deepEqual(Object.keys(error).sort(), ['code', 'machine', 'operation', 'retryable', 'sequence']);
    assert.equal(error.code, 'sync_failed');
    assert.equal(error.operation, 'close');
    assert.equal(error.retryable, true);
    assert.equal(error.machine, 'WRITER');
    assert.equal(error.sequence, null);
    assert.equal(error.message.includes(secret), false);
    assert.equal(JSON.stringify(error).includes(secret), false);
    return true;
  });
  assert.equal(faults, 1);
  fs.unlink = originalUnlink;
  syncBuiltinESMExports();
  assert.equal((await first.status()).closed, true);
  second = await create();
  await second.resume();
  const status = await second.status();
  assert.equal(status.pending, 1);
  assert.equal(status.quarantined, 0);
  assert.equal(status.groups[0].transactionId, group.transactionId);
  assert.equal(origin.controls.publications.length, 0);
  await second.close();
  process.stdout.write(`${JSON.stringify({ safeClose: true, reacquired: true, pending: 1 })}\n`);
} finally {
  fs.unlink = originalUnlink;
  syncBuiltinESMExports();
  if (first) await first.close().catch(() => {});
  if (second) await second.close();
}
