import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashBytes, uuidV8 } from '../engine/service/identity.mjs';
import { servicePaths } from '../engine/service/paths.mjs';
import { createStore } from '../engine/service/store.mjs';
import { applyPack, compareVersions } from '../engine/sync/apply.mjs';
import { limitsFor, openLedger } from '../engine/sync/limits.mjs';
import { closeOrigin, openOrigin, publishBeat, publishPack, readHead, watchOrigin } from '../engine/sync/origin.mjs';
import { encodePack } from '../engine/sync/pack.mjs';
import { openSync, stageTransaction } from '../engine/sync/store.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const AT = '2026-10-10T12:00:00.000Z';
const LATER = '2026-10-10T12:00:05.000Z';

function put(target, raw, extra = {}) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  return {
    format: 'hivem1nd-change-v1',
    id: extra.id ?? uuidV8(['change', target.path, extra.at ?? AT, extra.machine ?? 'LAPTOP']),
    machine: extra.machine ?? 'LAPTOP',
    at: extra.at ?? AT,
    target,
    operation: 'put',
    hash: hashBytes(bytes),
    size: bytes.length,
    baseHash: extra.baseHash ?? null,
    messageId: null,
    transactionId: extra.transactionId ?? null,
  };
}

function pack(changes, objects, extra = {}) {
  return encodePack({
    machine: extra.machine ?? 'LAPTOP',
    sequence: extra.sequence ?? 1,
    changes,
    objects,
    dependencies: extra.dependencies ?? [],
    transactions: extra.transactions ?? [],
  });
}

async function world(t) {
  const fixture = await makeCoreFixture({ machine: 'DESKTOP' });
  t.after(() => dispose(fixture));
  const origin = path.join(fixture.root, 'origin');
  await mkdir(path.join(origin, 'machines'), { recursive: true });
  fixture.paths.origin = origin;
  const laptopMind = path.join(fixture.root, 'localappdata', 'Cosmic', 'laptop-mind');
  await mkdir(path.join(laptopMind, 'user'), { recursive: true });
  const laptopPaths = servicePaths({
    platform: 'win32',
    env: fixture.env,
    home: fixture.home,
    machine: 'LAPTOP',
    mindPath: laptopMind,
    originPath: origin,
  });
  await mkdir(laptopPaths.localDirectory, { recursive: true });
  const laptopStore = createStore({
    root: fixture.root,
    confineRoot: fixture.root,
    mindPath: laptopMind,
    localDirectory: laptopPaths.localDirectory,
    now: () => fixture.clock.now,
    events: [],
  });
  const desktop = openSync({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now });
  const laptop = openSync({ store: laptopStore, paths: laptopPaths, now: () => fixture.clock.now });
  const desktopOrigin = openOrigin({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, machine: 'DESKTOP' });
  const laptopOrigin = openOrigin({ store: laptopStore, paths: laptopPaths, now: () => fixture.clock.now, machine: 'LAPTOP' });
  const ledger = openLedger({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, machine: 'DESKTOP' });
  return { fixture, desktop, laptop, desktopOrigin, laptopOrigin, ledger };
}

test('version order keeps both conflict bytes and breaks equal-time ties', async (t) => {
  const { fixture, desktop, laptopOrigin } = await world(t);
  const newer = Buffer.from('newer text');
  const older = Buffer.from('older text');
  const target = { kind: 'mind', path: 'user/doc.txt' };
  const first = pack([put(target, newer, { at: LATER })], [{ hash: hashBytes(newer), raw: newer }]);
  await publishPack(laptopOrigin, first);
  assert.equal((await readHead(laptopOrigin, 'LAPTOP')).sequence, 1);
  await applyPack(desktop, first, { ledger: null });
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'doc.txt'), 'utf8'), 'newer text');
  const second = pack([put(target, older, { at: AT })], [{ hash: hashBytes(older), raw: older }], { sequence: 2 });
  await publishPack(laptopOrigin, second);
  await applyPack(desktop, second);
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'doc.txt'), 'utf8'), 'newer text');
  const conflict = await readFile(path.join(fixture.paths.mind, 'user', `doc.txt.conflict-LAPTOP-${AT.replace(/[-:]/g, '').replace(/\./g, '')}`), 'utf8');
  assert.equal(conflict, 'older text');
  assert.equal(desktop.store.events.filter((event) => event.type === 'sync.conflict').length, 1);
  await applyPack(desktop, second);
  assert.equal(desktop.store.events.filter((event) => event.type === 'sync.conflict').length, 1);
  const sameTime = Buffer.from('tie text');
  const tieTarget = { kind: 'mind', path: 'user/tie.txt' };
  await writeFile(path.join(fixture.paths.mind, 'user', 'tie.txt'), 'desktop text');
  await stageTransaction(desktop, [{ target: tieTarget, bytes: Buffer.from('desktop text'), at: AT, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }]);
  const tied = pack([put(tieTarget, sameTime, { at: AT, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' })], [{ hash: hashBytes(sameTime), raw: sameTime }], { sequence: 3 });
  await applyPack(desktop, tied);
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'tie.txt'), 'utf8'), 'tie text');
  assert.equal(compareVersions({ at: AT, machine: 'LAPTOP', id: 'b' }, { at: AT, machine: 'DESKTOP', id: 'b' }) > 0, true);
});

test('delete and edit each win when newer, and an old edit cannot revive a tombstone', async (t) => {
  const { fixture, desktop } = await world(t);
  const target = { kind: 'mind', path: 'user/life.txt' };
  const body = Buffer.from('keep me');
  await applyPack(desktop, pack([put(target, body, { at: AT })], [{ hash: hashBytes(body), raw: body }]));
  const removal = {
    ...put(target, body, { at: LATER }),
    operation: 'delete',
    hash: null,
    size: 0,
  };
  await applyPack(desktop, pack([removal], [], { sequence: 2 }));
  await assert.rejects(() => readFile(path.join(fixture.paths.mind, 'user', 'life.txt')));
  const preserved = await readFile(path.join(fixture.paths.mind, 'user', `life.txt.conflict-LAPTOP-${LATER.replace(/[-:]/g, '').replace(/\./g, '')}`), 'utf8');
  assert.equal(preserved, 'keep me');
  const revival = Buffer.from('too old');
  await applyPack(desktop, pack([put(target, revival, { at: '2026-10-10T11:59:00.000Z' })], [{ hash: hashBytes(revival), raw: revival }], { sequence: 3 }));
  await assert.rejects(() => readFile(path.join(fixture.paths.mind, 'user', 'life.txt')));
  const restored = Buffer.from('restored');
  const other = { kind: 'mind', path: 'user/other.txt' };
  await applyPack(desktop, pack([put(other, body, { at: AT })], [{ hash: hashBytes(body), raw: body }], { sequence: 4 }));
  await applyPack(desktop, pack([{
    ...put(other, body, { at: '2026-10-10T12:00:01.000Z' }),
    operation: 'delete',
    hash: null,
    size: 0,
  }], [], { sequence: 5 }));
  await applyPack(desktop, pack([put(other, restored, { at: LATER })], [{ hash: hashBytes(restored), raw: restored }], { sequence: 6 }));
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'other.txt'), 'utf8'), 'restored');
});

test('a local unpublished edit survives an older import', async (t) => {
  const { fixture, desktop } = await world(t);
  const target = { kind: 'mind', path: 'user/local.txt' };
  await writeFile(path.join(fixture.paths.mind, 'user', 'local.txt'), 'local edit');
  await stageTransaction(desktop, [{ target, bytes: Buffer.from('local edit'), at: LATER }]);
  const incoming = Buffer.from('remote edit');
  await applyPack(desktop, pack([put(target, incoming, { at: AT })], [{ hash: hashBytes(incoming), raw: incoming }]));
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'local.txt'), 'utf8'), 'local edit');
  const conflict = await readFile(path.join(fixture.paths.mind, 'user', `local.txt.conflict-LAPTOP-${AT.replace(/[-:]/g, '').replace(/\./g, '')}`), 'utf8');
  assert.equal(conflict, 'remote edit');
});

test('immutable bytes and the wrong owner are rejected before writes', async (t) => {
  const { fixture, desktop } = await world(t);
  const message = path.join(fixture.paths.mind, 'user', 'inbox', 'master');
  await mkdir(message, { recursive: true });
  await writeFile(path.join(message, 'one.md'), 'id: one\n\nOriginal\n');
  const changed = Buffer.from('id: one\n\nChanged\n');
  await assert.rejects(() => applyPack(desktop, pack([
    put({ kind: 'mind', path: 'user/inbox/master/one.md' }, changed),
  ], [{ hash: hashBytes(changed), raw: changed }])), (error) => error.code === 'corrupt_resource');
  assert.equal(await readFile(path.join(message, 'one.md'), 'utf8'), 'id: one\n\nOriginal\n');
  const approvalId = uuidV8(['approval']);
  const result = Buffer.from(JSON.stringify({
    format: 'hivem1nd-approval-result-v1',
    approvalId,
    state: 'approved',
    answerId: null,
    grantId: null,
    at: AT,
  }));
  await assert.rejects(() => applyPack(desktop, pack([
    put({ kind: 'mind', path: `user/relay/approvals/${approvalId}/result.json` }, result),
  ], [{ hash: hashBytes(result), raw: result }], { sequence: 2 }), {
    bindings: { approvals: { [approvalId]: { machine: 'DESKTOP' } } },
  }), (error) => error.code === 'invalid_record_owner');
  await assert.rejects(() => readFile(path.join(fixture.paths.mind, 'user', 'relay', 'approvals', approvalId, 'result.json')));
  const ahead = Buffer.from('future');
  await assert.rejects(() => applyPack(desktop, pack([
    put({ kind: 'mind', path: 'user/future.txt' }, ahead, { at: '2026-10-10T12:00:31.000Z' }),
  ], [{ hash: hashBytes(ahead), raw: ahead }], { sequence: 3 })), (error) => error.code === 'invalid_pack');
});

test('a missing dependency stays pending and a later copy does not charge twice', async (t) => {
  const { desktop, ledger } = await world(t);
  const raw = Buffer.from('shared');
  const hash = hashBytes(raw);
  const base = pack([put({ kind: 'mind', path: 'user/base.txt' }, raw)], [{ hash, raw }], { sequence: 1 });
  const laterChange = put({ kind: 'mind', path: 'user/later.txt' }, raw, { at: LATER });
  const later = pack([laterChange], [], {
    sequence: 2,
    dependencies: [{ hash, machine: 'LAPTOP', sequence: 1, packHash: hashBytes(base) }],
  });
  const head = {
    format: 'hivem1nd-head-v1',
    machine: 'LAPTOP',
    sequence: 1,
    updatedAt: AT,
    packs: [{ sequence: 1, file: '000000000001.pack', hash: hashBytes(base), bytes: base.length }],
  };
  const pending = await applyPack(desktop, later, {
    ledger,
    provider: { async readHead() { return head; }, async readPack() { return null; } },
  });
  assert.equal(pending.status, 'pending');
  const charged = (await limitsFor(ledger, 'receipt', 'LAPTOP')).syncBytes.used;
  assert.equal(charged, later.length);
  const applied = await applyPack(desktop, later, {
    ledger,
    provider: { async readHead() { return head; }, async readPack() { return base; } },
  });
  assert.equal(applied.status, 'applied');
  assert.equal((await limitsFor(ledger, 'receipt', 'LAPTOP')).syncBytes.used, charged);
  assert.equal(await readFile(path.join(desktop.paths.mind, 'user', 'later.txt'), 'utf8'), 'shared');
});

test('a crashed group resumes once and a crashed head is not reused for other bytes', async (t) => {
  const { fixture, desktop, laptopOrigin } = await world(t);
  const left = Buffer.from('left');
  const right = Buffer.from('right');
  const transactionId = uuidV8(['group']);
  const first = put({ kind: 'mind', path: 'user/left.txt' }, left, { transactionId, id: uuidV8(['left']) });
  const second = put({ kind: 'mind', path: 'user/right.txt' }, right, { transactionId, at: LATER, id: uuidV8(['right']) });
  const grouped = pack([first, second], [{ hash: hashBytes(left), raw: left }, { hash: hashBytes(right), raw: right }], {
    transactions: [{ id: transactionId, changeIds: [first.id, second.id] }],
  });
  desktop.applyFault = { afterWrites: 1 };
  await assert.rejects(() => applyPack(desktop, grouped), (error) => error.code === 'injected_crash');
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'left.txt'), 'utf8'), 'left');
  await assert.rejects(() => readFile(path.join(fixture.paths.mind, 'user', 'right.txt')));
  await applyPack(desktop, grouped);
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'right.txt'), 'utf8'), 'right');
  assert.equal(desktop.store.events.filter((event) => event.type === 'sync.applied').length, 1);
  const beat = { format: 'hivem1nd-service-v1', machine: 'LAPTOP', state: 'running', version: '3.0.0', heartbeatAt: AT, startedAt: AT };
  laptopOrigin.fault = 'before-head';
  const bytes = Buffer.from('pack-bytes-are-not-a-pack');
  await assert.rejects(() => publishPack(laptopOrigin, bytes), (error) => error.code === 'injected_crash');
  assert.equal(await readHead(laptopOrigin, 'LAPTOP'), null);
  await assert.rejects(() => publishPack(laptopOrigin, Buffer.from('other bytes')), (error) => error.code === 'revision_conflict');
  const parked = await readFile(path.join(fixture.root, 'origin', 'machines', 'LAPTOP', 'packs', '000000000001.pack'));
  assert.equal(hashBytes(parked), hashBytes(bytes));
  await publishPack(laptopOrigin, bytes);
  assert.equal((await readHead(laptopOrigin, 'LAPTOP')).packs[0].hash, hashBytes(bytes));
  await publishBeat(laptopOrigin, beat);
  const service = JSON.parse(await readFile(path.join(fixture.root, 'origin', 'machines', 'LAPTOP', 'service.json'), 'utf8'));
  assert.equal(service.machine, 'LAPTOP');
});

test('links are not followed and an unregistered project stays pending', async (t) => {
  const { fixture, desktop } = await world(t);
  const outside = path.join(fixture.root, 'outside');
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(outside, 'secret.txt'), 'secret');
  await symlink(outside, path.join(fixture.paths.mind, 'user', 'linked'), 'junction');
  const raw = Buffer.from('nope');
  await assert.rejects(() => applyPack(desktop, pack([
    put({ kind: 'mind', path: 'user/linked/secret.txt' }, raw),
  ], [{ hash: hashBytes(raw), raw }])), (error) => error.code === 'unsafe_path');
  assert.equal(await readFile(path.join(outside, 'secret.txt'), 'utf8'), 'secret');
  const pending = await applyPack(desktop, pack([
    put({ kind: 'project', project: 'shop', path: 'docs/readme.md' }, raw, { at: LATER }),
  ], [{ hash: hashBytes(raw), raw }], { sequence: 4 }));
  assert.equal(pending.status, 'pending');
  assert.equal(pending.code, 'project_unavailable');
  await assert.rejects(() => readFile(path.join(fixture.root, 'shop', 'docs', 'readme.md')));
});

test('a revocation tombstone blocks an older grant and keeps a new grant id', async (t) => {
  const { fixture, desktop } = await world(t);
  const revoked = uuidV8(['grant', 'old']);
  const fresh = uuidV8(['grant', 'new']);
  const revocation = Buffer.from(JSON.stringify({
    format: 'hivem1nd-grant-revocation-result-v1',
    requestId: uuidV8(['revoke']),
    unitId: 'project:shop:executor-shop',
    grantId: revoked,
    state: 'revoked',
    at: AT,
    machine: 'LAPTOP',
  }));
  await applyPack(desktop, pack([
    put({ kind: 'mind', path: 'user/relay/grant-revocation-results/one.json' }, revocation),
  ], [{ hash: hashBytes(revocation), raw: revocation }]));
  const state = Buffer.from(JSON.stringify({ grants: [{ id: revoked }, { id: fresh }] }));
  await applyPack(desktop, pack([
    put({ kind: 'mind', path: 'user/grants.json' }, state, { at: '2026-10-10T11:00:00.000Z' }),
  ], [{ hash: hashBytes(state), raw: state }], { sequence: 2 }));
  const saved = JSON.parse(await readFile(path.join(fixture.paths.mind, 'user', 'grants.json'), 'utf8'));
  assert.deepEqual(saved.grants.map((grant) => grant.id), [fresh]);
});

test('an origin watcher reports a real head change and does not poll while idle', async (t) => {
  const { laptopOrigin } = await world(t);
  const events = [];
  const close = watchOrigin(laptopOrigin, (event) => events.push(event.type), { debounceMs: 20 });
  t.after(() => closeOrigin(laptopOrigin));
  const raw = Buffer.from('watched');
  const body = pack([put({ kind: 'mind', path: 'user/watched.txt' }, raw)], [{ hash: hashBytes(raw), raw }]);
  await publishPack(laptopOrigin, body);
  const started = Date.now();
  while (!events.includes('origin') && Date.now() - started < 3000) {
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.ok(events.includes('reconcile'));
  assert.ok(events.includes('origin'));
  await new Promise((resolve) => setTimeout(resolve, 200));
  const count = events.length;
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(events.length, count);
  await close();
});
