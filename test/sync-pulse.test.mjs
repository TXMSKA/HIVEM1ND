import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admitMessage, chargeMetadata, claimLimitNotice, limitsFor, openLedger, reservePublication, reserveReceipt, retryAtFor } from '../engine/sync/limits.mjs';
import { stageTransaction } from '../engine/sync/store.mjs';
import { openSync } from '../engine/sync/store.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

async function ledgerFor(t) {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const ledger = openLedger({
    store: fixture.store,
    paths: fixture.paths,
    now: () => fixture.clock.now,
    machine: fixture.machine,
  });
  return { fixture, ledger };
}

test('the 61st admission writes nothing and a later window accepts again', async (t) => {
  const { fixture, ledger } = await ledgerFor(t);
  for (let index = 0; index < 48; index += 1) {
    const result = await admitMessage(ledger, { id: `m-${index}`, record: Buffer.from('ok') });
    assert.equal(result.counted, true);
  }
  assert.equal((await limitsFor(ledger, 'admission')).state, 'slowing');
  for (let index = 48; index < 60; index += 1) await admitMessage(ledger, { id: `m-${index}`, record: Buffer.from('ok') });
  const full = await limitsFor(ledger, 'admission');
  assert.equal(full.messages.used, 60);
  assert.equal(full.state, 'paused');
  const before = await readFile(ledger.file, 'utf8');
  await assert.rejects(() => admitMessage(ledger, { id: 'm-60', record: Buffer.from('no') }), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.code, 'message_rate_limited');
    assert.equal(error.details.phase, 'admission');
    assert.equal(error.details.limits.messages.used, 60);
    assert.equal(typeof error.details.retryAfter, 'number');
    return true;
  });
  assert.equal(await readFile(ledger.file, 'utf8'), before);
  const notice = await admitMessage(ledger, { id: 'notice-1', record: Buffer.from('notice'), notice: true });
  assert.equal(notice.counted, false);
  assert.equal((await limitsFor(ledger, 'admission')).messages.used, 60);
  const claimed = await claimLimitNotice(ledger, 'admission');
  assert.equal((await claimLimitNotice(ledger, 'admission')).id, claimed.id);
  assert.equal((await claimLimitNotice(ledger, 'admission')).created, false);
  const note = path.join(fixture.paths.mind, 'user', 'note.txt');
  await writeFile(note, 'local');
  const sync = openSync({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now });
  const staged = await stageTransaction(sync, [{ target: { kind: 'mind', path: 'user/note.txt' }, bytes: Buffer.from('local') }]);
  assert.equal(staged.length, 1);
  assert.equal(await readFile(note, 'utf8'), 'local');
  const restarted = openLedger({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, machine: fixture.machine });
  assert.equal((await limitsFor(restarted, 'admission')).messages.used, 60);
  fixture.clock.now += 60001;
  assert.equal((await limitsFor(restarted, 'admission')).messages.used, 0);
  assert.equal((await limitsFor(restarted, 'admission')).state, 'normal');
  const next = await admitMessage(restarted, { id: 'm-next', record: Buffer.from('again') });
  assert.equal(next.counted, true);
});

test('admission measures complete bytes, including multibyte text and headers', async (t) => {
  const { ledger } = await ledgerFor(t);
  await assert.rejects(() => admitMessage(ledger, { id: 'huge', record: Buffer.alloc(1000001) }), (error) => error.code === 'message_too_large' && error.status === 413);
  assert.equal((await limitsFor(ledger, 'admission')).messages.used, 0);
  await admitMessage(ledger, { id: 'exact', record: Buffer.alloc(1000000) });
  const characters = 'é'.repeat(500000);
  assert.equal(characters.length, 500000);
  assert.equal(Buffer.byteLength(characters), 1000000);
  await admitMessage(ledger, { id: 'utf8', record: characters });
  const over = 'é'.repeat(500001);
  assert.ok(over.length < 1000000);
  await assert.rejects(() => admitMessage(ledger, { id: 'utf8-over', record: over }), (error) => error.code === 'message_too_large');
  const body = Buffer.alloc(999990);
  const record = Buffer.concat([Buffer.from('id: header\n\n'), body]);
  assert.ok(body.length < 1000000);
  assert.ok(record.length > 1000000);
  await assert.rejects(() => admitMessage(ledger, { id: 'headed', record }), (error) => error.code === 'message_too_large');
  assert.equal((await limitsFor(ledger, 'admission')).messages.used, 2);
});

test('publication, receipt and metadata charges stay independent', async (t) => {
  const { ledger } = await ledgerFor(t);
  for (let index = 0; index < 60; index += 1) await admitMessage(ledger, { id: `a-${index}`, record: Buffer.from('a') });
  const published = await reservePublication(ledger, { id: 'pack-1', messages: 2, bytes: 1000 });
  assert.equal(published.charged, true);
  const replayed = await reservePublication(ledger, { id: 'pack-1', messages: 2, bytes: 1000 });
  assert.equal(replayed.replayed, true);
  assert.equal((await limitsFor(ledger, 'publication')).messages.used, 2);
  assert.equal((await limitsFor(ledger, 'publication')).syncBytes.used, 1000);
  assert.equal((await limitsFor(ledger, 'admission')).messages.used, 60);
  assert.equal((await limitsFor(ledger, 'receipt', 'LAPTOP')).syncBytes.used, 0);
  await chargeMetadata(ledger, { machine: 'DESKTOP', path: 'machines/DESKTOP/service.json', contentHash: 'ab'.repeat(32), bytes: 400 });
  await chargeMetadata(ledger, { machine: 'DESKTOP', path: 'machines/DESKTOP/service.json', contentHash: 'ab'.repeat(32), bytes: 400 });
  assert.equal((await limitsFor(ledger, 'publication')).syncBytes.used, 1400);
  await reserveReceipt(ledger, { machine: 'LAPTOP', id: 'pack-1', messages: 2, bytes: 1000 });
  assert.equal((await limitsFor(ledger, 'receipt', 'LAPTOP')).syncBytes.used, 1000);
  assert.equal((await limitsFor(ledger, 'publication')).syncBytes.used, 1400);
});

test('a service beat pauses at the byte limit and resumes when the hour expires', async (t) => {
  const { fixture, ledger } = await ledgerFor(t);
  const beat = { machine: 'DESKTOP', path: 'machines/DESKTOP/service.json', contentHash: 'cd'.repeat(32), bytes: 50000000 };
  const charged = await chargeMetadata(ledger, beat);
  assert.equal(charged.limits.state, 'paused');
  assert.equal(charged.limits.syncBytes.used, 50000000);
  await assert.rejects(() => chargeMetadata(ledger, { ...beat, contentHash: 'ef'.repeat(32), bytes: 1 }), (error) => error.code === 'sync_rate_limited' && error.details.phase === 'publication');
  assert.equal((await limitsFor(ledger, 'publication')).syncBytes.used, 50000000);
  fixture.clock.now += 3600000;
  const resumed = await chargeMetadata(ledger, { ...beat, contentHash: 'ef'.repeat(32), bytes: 1 });
  assert.equal(resumed.charged, true);
  assert.equal((await limitsFor(ledger, 'publication')).syncBytes.used, 1);
  assert.equal((await limitsFor(ledger, 'publication')).state, 'normal');
});

test('retry waits for both blocked dimensions and ignores an unrelated older entry', async (t) => {
  const now = Date.parse('2026-10-10T12:00:00.000Z');
  const later = retryAtFor(now, [
    { id: 'bytes', at: now - 1800000, messages: 0, bytes: 50000000 },
    { id: 'messages', at: now - 1000, messages: 60, bytes: 0 },
  ], { messages: 1, bytes: 1 });
  assert.equal(later, now - 1800000 + 3600000);
  const specific = retryAtFor(now, [
    { id: 'old-bytes', at: now - 3599000, messages: 0, bytes: 1 },
    { id: 'messages', at: now - 1000, messages: 60, bytes: 0 },
  ], { messages: 1, bytes: 0 });
  assert.equal(specific, now - 1000 + 60000);
  const { fixture, ledger } = await ledgerFor(t);
  fixture.clock.now = now;
  await reservePublication(ledger, { id: 'bytes', messages: 0, bytes: 50000000 });
  fixture.clock.now = now + 1800000;
  await reservePublication(ledger, { id: 'messages', messages: 60, bytes: 0 });
  await assert.rejects(() => reservePublication(ledger, { id: 'next', messages: 1, bytes: 1 }), (error) => {
    assert.equal(error.retryAt, new Date(now + 3600000).toISOString());
    assert.equal(error.details.retryAfter, 1800);
    return true;
  });
});
