import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uuidV8 } from '../engine/service/identity.mjs';
import { admitMessage, chargeMetadata, claimLimitNotice, limitsFor, openLedger, reservePublication, reserveReceipt, retryAtFor } from '../engine/sync/limits.mjs';
import { openOrigin, publishBeat, publishPack, readHead, readOriginPack } from '../engine/sync/origin.mjs';
import { decodePack } from '../engine/sync/pack.mjs';
import { createPulse, nextDue } from '../engine/sync/pulse.mjs';
import { listStaged, openSync, stageTransaction } from '../engine/sync/store.mjs';
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

function fakeClock(fixture) {
  const timers = [];
  let sequence = 0;
  return {
    now: () => fixture.clock.now,
    setTimeout(fn, ms) {
      const timer = { id: ++sequence, at: fixture.clock.now + ms, fn, cleared: false };
      timers.push(timer);
      return timer.id;
    },
    clearTimeout(id) {
      const timer = timers.find((item) => item.id === id);
      if (timer) timer.cleared = true;
    },
    pending() {
      return timers.filter((timer) => !timer.cleared).length;
    },
    async advance(ms) {
      const target = fixture.clock.now + ms;
      for (let guard = 0; guard < 20; guard += 1) {
        const due = timers.filter((timer) => !timer.cleared && timer.at <= target).sort((left, right) => left.at - right.at || left.id - right.id);
        if (due.length === 0) break;
        fixture.clock.now = due[0].at;
        due[0].cleared = true;
        await due[0].fn();
      }
      fixture.clock.now = target;
    },
  };
}

async function pulseWorld(t) {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const originPath = path.join(fixture.root, 'origin');
  await mkdir(originPath, { recursive: true });
  fixture.paths.origin = originPath;
  const sync = openSync({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now });
  const origin = openOrigin({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, machine: fixture.machine });
  const ledger = openLedger({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, machine: fixture.machine });
  const clock = fakeClock(fixture);
  const io = { read: 0, pack: 0, beat: 0 };
  origin.readHead = async (machine) => {
    io.read += 1;
    return readHead(origin, machine);
  };
  origin.publishPack = async (bytes) => {
    io.pack += 1;
    return publishPack(origin, bytes);
  };
  origin.publishBeat = async (beat) => {
    io.beat += 1;
    return publishBeat(origin, beat);
  };
  const pulse = createPulse({
    sync,
    origin,
    ledger,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  return { fixture, sync, origin, ledger, clock, io, pulse };
}

function stamp(ms) {
  return new Date(ms).toISOString();
}

async function stageNote(sync, name, at) {
  return stageTransaction(sync, [{
    target: { kind: 'mind', path: `user/${name}` },
    bytes: Buffer.from(name),
    at,
  }], { at });
}

function messageBody(id) {
  return Buffer.from(`id: ${id}\nkind: message\n\nHello\n`);
}

async function stageMessage(sync, id, at, transactionId = null) {
  return stageTransaction(sync, [{
    target: { kind: 'mind', path: `user/inbox/master/${id}.md` },
    bytes: messageBody(id),
    at,
  }], { at, transactionId });
}

async function publishedPacks(origin) {
  const head = await readHead(origin, origin.machine);
  if (!head) return [];
  const packs = [];
  for (const entry of head.packs) {
    const bytes = await readOriginPack(origin, origin.machine, entry.sequence);
    packs.push(decodePack(bytes).changes.map((change) => change.id));
  }
  return packs;
}

function serviceBeat(machine, at) {
  return {
    format: 'hivem1nd-service-v1',
    machine,
    state: 'running',
    version: '2.0.0',
    heartbeatAt: at,
    startedAt: at,
  };
}

test('nextDue stays quiet for a burst and caps a continuous flow', () => {
  assert.equal(nextDue(0, null, 0, { state: 'normal' }), null);
  assert.equal(nextDue(0, 0, 0, { state: 'normal' }), 2000);
  assert.equal(nextDue(5000, 0, 9000, { state: 'normal' }), 10000);
  assert.equal(nextDue(0, 0, 0, { state: 'slowing' }), 4000);
  assert.equal(nextDue(0, 0, 27000, { state: 'slowing' }), 30000);
  assert.equal(nextDue(0, 0, 0, { state: 'paused', retryAt: '2026-10-10T12:01:00.000Z' }), Date.parse('2026-10-10T12:01:00.000Z'));
});

test('a quiet burst publishes once at 2 seconds and shutdown leaves it staged', async (t) => {
  const { sync, origin, clock, io, pulse } = await pulseWorld(t);
  assert.equal(clock.pending(), 0);
  const staged = await stageNote(sync, 'burst.txt', stamp(clock.now()));
  await pulse.changed([]);
  assert.equal(clock.pending(), 0);
  await pulse.changed([staged[0].id]);
  await clock.advance(1999);
  assert.equal(io.pack, 0);
  await clock.advance(1);
  assert.equal(io.pack, 1);
  assert.equal((await publishedPacks(origin)).length, 1);
  const again = await stageNote(sync, 'held.txt', stamp(clock.now()));
  await pulse.changed([again[0].id]);
  assert.equal(pulse.close().pending, 1);
  await clock.advance(3600000);
  assert.equal(io.pack, 1);
  assert.equal((await listStaged(sync)).map((change) => change.id).includes(again[0].id), true);
});

test('continuous changes flush once at 10 seconds', async (t) => {
  const { sync, clock, io, pulse } = await pulseWorld(t);
  const first = await stageNote(sync, 'flow-0.txt', stamp(clock.now()));
  await pulse.changed([first[0].id]);
  for (let index = 1; index <= 6; index += 1) {
    await clock.advance(1500);
    const staged = await stageNote(sync, `flow-${index}.txt`, stamp(clock.now()));
    await pulse.changed([staged[0].id]);
    assert.equal(io.pack, 0);
  }
  await clock.advance(1000);
  assert.equal(io.pack, 1);
  assert.equal((await listStaged(sync)).length, 0);
});

test('slowing waits 4 seconds and caps a flow at 30', async (t) => {
  const { sync, ledger, clock, io, pulse } = await pulseWorld(t);
  await reservePublication(ledger, { id: 'slow', messages: 48, bytes: 0 });
  const staged = await stageNote(sync, 'slow.txt', stamp(clock.now()));
  await pulse.changed([staged[0].id]);
  await clock.advance(3999);
  assert.equal(io.pack, 0);
  await clock.advance(1);
  assert.equal(io.pack, 1);
  const next = await stageNote(sync, 'slow-0.txt', stamp(clock.now()));
  await pulse.changed([next[0].id]);
  for (let index = 1; index <= 8; index += 1) {
    await clock.advance(3500);
    const extra = await stageNote(sync, `slow-${index}.txt`, stamp(clock.now()));
    await pulse.changed([extra[0].id]);
    assert.equal(io.pack, 1);
  }
  await clock.advance(2000);
  assert.equal(io.pack, 2);
});

test('a full message window pauses publication until the window expires', async (t) => {
  const { sync, ledger, clock, io, pulse } = await pulseWorld(t);
  await reservePublication(ledger, { id: 'full', messages: 60, bytes: 0 });
  const staged = await stageNote(sync, 'paused.txt', stamp(clock.now()));
  await pulse.changed([staged[0].id]);
  await clock.advance(59999);
  assert.equal(io.pack, 0);
  assert.equal((await listStaged(sync)).length, 1);
  await clock.advance(1);
  assert.equal(io.pack, 1);
  assert.equal((await listStaged(sync)).length, 0);
});

test('changes during a flush wait for the next pulse and repeated flush shares one promise', async (t) => {
  const { sync, origin, clock, io, pulse } = await pulseWorld(t);
  const staged = await stageNote(sync, 'during.txt', stamp(clock.now()));
  let lateId = null;
  let injected = false;
  const countedPack = origin.publishPack;
  origin.publishPack = async (bytes) => {
    if (!injected) {
      injected = true;
      const late = await stageNote(sync, 'late.txt', stamp(clock.now()));
      lateId = late[0].id;
      await pulse.changed([lateId]);
    }
    return countedPack(bytes);
  };
  await pulse.changed([staged[0].id]);
  const first = pulse.flush();
  const second = pulse.flush();
  assert.equal(first, second);
  const result = await first;
  assert.equal(result.ids.includes(lateId), false);
  assert.equal(io.pack, 1);
  await clock.advance(2000);
  assert.equal(io.pack, 2);
  const packs = await publishedPacks(origin);
  assert.deepEqual(packs[1], [lateId]);
});

test('an offline backlog continues in order across windows and a restarted pulse', async (t) => {
  const firstWorld = await pulseWorld(t);
  const ids = [];
  for (let index = 0; index < 61; index += 1) {
    const at = stamp(firstWorld.clock.now() + index);
    const staged = await stageMessage(firstWorld.sync, `backlog-${index}`, at);
    ids.push(staged[0].id);
  }
  await firstWorld.pulse.changed(ids);
  await firstWorld.clock.advance(2000);
  const packs = await publishedPacks(firstWorld.origin);
  assert.equal(packs.length, 1);
  assert.deepEqual(packs[0], ids.slice(0, 60));
  assert.equal((await listStaged(firstWorld.sync)).map((change) => change.id).includes(ids[60]), true);
  firstWorld.pulse.close();
  const restarted = createPulse({
    sync: firstWorld.sync,
    origin: firstWorld.origin,
    ledger: firstWorld.ledger,
    now: firstWorld.clock.now,
    setTimeout: firstWorld.clock.setTimeout,
    clearTimeout: firstWorld.clock.clearTimeout,
  });
  await restarted.resume();
  await firstWorld.clock.advance(60000);
  const after = await publishedPacks(firstWorld.origin);
  assert.equal(after.length, 2);
  assert.deepEqual(after[1], [ids[60]]);
  assert.equal((await listStaged(firstWorld.sync)).length, 0);
});

test('a transaction group that does not fit stays together', async (t) => {
  const { sync, origin, ledger, clock, io, pulse } = await pulseWorld(t);
  await reservePublication(ledger, { id: 'almost', messages: 59, bytes: 0 });
  const at = stamp(clock.now());
  const transactionId = uuidV8(['tx', 'pair']);
  const staged = await stageTransaction(sync, [
    { target: { kind: 'mind', path: 'user/inbox/master/left.md' }, bytes: messageBody('left'), at },
    { target: { kind: 'mind', path: 'user/inbox/master/right.md' }, bytes: messageBody('right'), at },
  ], { at, transactionId });
  await pulse.changed(staged.map((change) => change.id));
  await clock.advance(10000);
  assert.equal(io.pack, 0);
  assert.equal((await listStaged(sync)).length, 2);
  await clock.advance(50000);
  assert.equal(io.pack, 1);
  const packs = await publishedPacks(origin);
  assert.equal(packs.length, 1);
  assert.equal(packs[0].length, 2);
  assert.deepEqual(packs[0].sort(), staged.map((change) => change.id).sort());
});

test('an oversized transaction becomes an issue instead of retrying forever', async (t) => {
  const { fixture, sync, origin, ledger, clock, io, pulse } = await pulseWorld(t);
  const transactionId = uuidV8(['tx', 'huge']);
  const entries = [];
  for (let index = 0; index < 61; index += 1) {
    entries.push({
      target: { kind: 'mind', path: `user/inbox/master/huge-${index}.md` },
      bytes: messageBody(`huge-${index}`),
    });
  }
  const staged = await stageTransaction(sync, entries, { transactionId });
  await pulse.changed(staged.map((change) => change.id));
  await clock.advance(10000);
  assert.equal(io.pack, 0);
  const issues = JSON.parse(await readFile(path.join(fixture.paths.localDirectory, 'outgoing', 'issues.json'), 'utf8'));
  assert.equal(issues.ids.length, 61);
  await clock.advance(3600000);
  assert.equal(io.pack, 0);
  const restarted = createPulse({
    sync,
    origin,
    ledger,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  await restarted.resume();
  await clock.advance(10000);
  assert.equal(io.pack, 0);
});

test('a crashed publication resumes before and after the head commit', async (t) => {
  const { sync, origin, ledger, clock, io, pulse, fixture } = await pulseWorld(t);
  const first = await stageNote(sync, 'before.txt', stamp(clock.now()));
  origin.fault = 'before-head';
  await pulse.changed([first[0].id]);
  const failed = await pulse.flush();
  assert.equal(failed.error, 'injected_crash');
  assert.equal(await readHead(origin, origin.machine), null);
  assert.equal((await listStaged(sync)).length, 1);
  assert.equal(fixture.events.filter((event) => event.type === 'sync.error').length, 1);
  const used = (await limitsFor(ledger, 'publication')).syncBytes.used;
  const recovered = await pulse.flush();
  assert.equal(recovered.published, true);
  assert.equal((await readHead(origin, origin.machine)).sequence, 1);
  assert.equal((await listStaged(sync)).length, 0);
  assert.equal((await limitsFor(ledger, 'publication')).syncBytes.used, used);
  const packs = await readdir(path.join(fixture.paths.origin, 'machines', fixture.machine, 'packs'));
  assert.equal(packs.filter((name) => name.endsWith('.pack')).length, 1);
  const second = await stageNote(sync, 'after.txt', stamp(clock.now()));
  origin.fault = 'after-head';
  await pulse.changed([second[0].id]);
  const crashed = await pulse.flush();
  assert.equal(crashed.error, 'injected_crash');
  assert.equal((await readHead(origin, origin.machine)).sequence, 2);
  assert.equal((await listStaged(sync)).length, 1);
  await pulse.flush();
  assert.equal((await listStaged(sync)).length, 0);
  assert.equal((await readHead(origin, origin.machine)).sequence, 2);
  assert.equal(fixture.events.filter((event) => event.type === 'sync.error').length, 1);
  assert.equal(io.pack > 0, true);
});

test('an idle hour writes no pack and a beat writes only its own metadata', async (t) => {
  const { fixture, origin, ledger, clock, io, pulse } = await pulseWorld(t);
  const unchanged = await pulse.flush();
  assert.equal(unchanged.published, false);
  await clock.advance(3600000);
  assert.equal(io.pack, 0);
  assert.equal(io.read, 0);
  assert.equal(io.beat, 0);
  assert.equal(clock.pending(), 0);
  const at = stamp(clock.now());
  const beat = await pulse.beat(serviceBeat(fixture.machine, at));
  assert.equal(beat.published, true);
  assert.equal(io.beat, 1);
  assert.equal(io.pack, 0);
  const servicePath = path.join(fixture.paths.origin, 'machines', fixture.machine, 'service.json');
  const before = await readFile(servicePath, 'utf8');
  const used = (await limitsFor(ledger, 'publication')).syncBytes.used;
  await reservePublication(ledger, { id: 'fill', messages: 0, bytes: 50000000 - used });
  const paused = await pulse.beat(serviceBeat(fixture.machine, stamp(clock.now() + 1000)));
  assert.equal(paused.published, false);
  assert.equal(io.beat, 1);
  assert.equal(await readFile(servicePath, 'utf8'), before);
  assert.equal(await readHead(origin, fixture.machine), null);
});
