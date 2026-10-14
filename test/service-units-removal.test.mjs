import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createNativeAdapter, enqueueStart, registerNative } from '../engine/service/adapters.mjs';
import { createChat, postMailbox } from '../engine/service/chats.mjs';
import { createGroup, patchGroup } from '../engine/service/groups.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { readCollection, readDetail, readProjection } from '../engine/service/projection.mjs';
import { createStore, recoverTransactions, undoChange, withReceipt } from '../engine/service/store.mjs';
import { createUnit, removeUnit } from '../engine/service/units.mjs';
import { openLedger } from '../engine/sync/limits.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const UNIT = 'project:shop:one';

async function world(t) {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const file = path.join(fixture.paths.mind, 'user', 'projects', 'shop', 'state', 'one.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `unit: one\nunit-id: ${UNIT}\nrole: executor\nstate: out\nlead-id: root:overseer\nextra: kept\n\nSaved context.\n`);
  await mkdir(path.join(fixture.paths.mind, 'user', 'state'), { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'two.md'), 'unit: two\nunit-id: root:two\nrole: executor\nstate: out\n\n');
  const signaled = [];
  const adapter = createNativeAdapter('codex', { fixture: true, signaled,
    transcript: ['{"jsonrpc":"2.0","id":2,"result":{"thread":{"id":"owned-one"}}}'] });
  const context = { store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now,
    principal: { audience: 'desktop', unitId: 'root:master', capabilities: ['read', 'unit.create', 'chat.manage'] },
    beat: { state: 'running', heartbeatAt: new Date(fixture.clock.now).toISOString() },
    adapters: { codex: adapter }, ownedPids: new Set(), projects: [{ name: 'shop', localPath: fixture.root }] };
  context.ledger = openLedger({ store: fixture.store, paths: fixture.paths, now: context.now, machine: fixture.machine });
  const unit = await readDetail(context, 'units', UNIT);
  const input = { confirmed: true, expectedRevision: unit.revision };
  const start = () => enqueueStart(context, { unitId: UNIT, client: 'codex', runMode: 'chat', stateRevision: unit.revision });
  return { fixture, context, file, unit, input, signaled, start };
}

function restart(context) {
  const store = createStore({ root: context.store.root, confineRoot: context.store.confineRoot, mindPath: context.paths.mind,
    localDirectory: context.paths.localDirectory, now: context.now });
  store.aclRunner = context.store.aclRunner;
  return { ...context, store, ownedPids: new Set() };
}

test('offline removal archives visibility, retains bytes and IDs, and Undo restores memberships without launching', async (t) => {
  const { fixture, context, file, input, signaled } = await world(t);
  const state = await readFile(file);
  const task = path.join(path.dirname(path.dirname(file)), 'tasks', '001.md');
  await mkdir(path.dirname(task), { recursive: true });
  await writeFile(task, `id: 001\nto: one\nto-id: ${UNIT}\nfrom: master\nstatus: open\n\nTask retained.\n`);
  const repo = path.join(fixture.root, 'repository.txt');
  await writeFile(repo, 'Unchanged repository content.\n');
  const hashes = await Promise.all([task, repo].map(async (file) => hashBytes(await readFile(file))));
  const chat = (await createChat(context, { members: [UNIT] })).chat;
  await postMailbox(context, UNIT, { body: 'Saved mailbox message.' });
  const group = await createGroup(context, { title: 'Shared', members: [UNIT, 'root:two'] });
  const archivedGroup = await createGroup(context, { title: 'Past', members: [UNIT] });
  const { removeGroup } = await import('../engine/service/groups.mjs');
  await removeGroup(context, archivedGroup.id, { confirmed: true, expectedRevision: archivedGroup.revision });
  const pastBytes = await readFile(path.join(context.paths.mind, 'user', 'gui', 'groups', `${archivedGroup.id}.json`));
  const result = await removeUnit(context, UNIT, input);
  assert.equal(signaled.length, 0);
  assert.equal((await readProjection(context)).units.some((unit) => unit.id === UNIT), false);
  assert.equal((await readCollection(context, 'units', { archived: true })).items[0].removed, true);
  assert.equal((await readCollection(context, 'chats', { archived: true })).items.some((item) => item.id === chat.id), true);
  assert.equal((await readCollection(context, 'mailboxes')).items.some((box) => box.unitId === UNIT), false);
  assert.equal((await readCollection(context, 'mailboxes', { archived: true })).items[0].unitId, UNIT);
  assert.equal((await readCollection(context, 'messages', { mailboxId: UNIT, state: 'all' })).items[0].body.trim(), 'Saved mailbox message.');
  assert.deepEqual((await readCollection(context, 'groups')).items[0].members, ['root:two']);
  const record = JSON.parse(await readFile(path.join(context.paths.mind, 'user', 'gui', 'groups', `${group.id}.json`)));
  assert.deepEqual(record.formerMembers, [UNIT]);
  assert.deepEqual(await readFile(path.join(context.paths.mind, 'user', 'gui', 'groups', `${archivedGroup.id}.json`)), pastBytes);
  assert.deepEqual(await Promise.all([task, repo].map(async (file) => hashBytes(await readFile(file)))), hashes);
  context.paths.origin = path.join(fixture.root, 'origin');
  await mkdir(path.join(context.paths.origin, 'machines', fixture.machine), { recursive: true });
  await writeFile(path.join(context.paths.origin, 'machines', fixture.machine, 'service.json'), JSON.stringify(context.beat));
  await assert.rejects(createUnit(context, { unit: 'one', role: 'executor', scope: 'project:shop', machine: fixture.machine }), { code: 'unit_exists' });
  await undoChange(context, result.changeId);
  assert.deepEqual(await readFile(file), state);
  assert.equal((await readCollection(context, 'mailboxes')).items[0].unitId, UNIT);
  assert.deepEqual((await readCollection(context, 'groups')).items[0].members, group.members);
  assert.equal((await readCollection(context, 'chats')).items.some((item) => item.id === chat.id), true);
  assert.equal(signaled.length, 0);
});

test('native acknowledgment precedes every archive event, and crash after stop resumes without another signal', async (t) => {
  const { context, input, start, signaled } = await world(t);
  const started = await start();
  const sessionId = started.result.sessionId;
  let archiveEvents = 0;
  context.bus = { emit: () => {
    archiveEvents += 1;
    assert.equal(signaled.length, 1);
  } };
  context.removalFault = 'after-stop';
  await assert.rejects(removeUnit(context, UNIT, input), { code: 'injected_crash' });
  assert.equal(archiveEvents, 0);
  assert.equal((await readProjection(context)).units.some((unit) => unit.id === UNIT), true);
  const statuses = await readdir(path.join(context.paths.mind, 'user', 'relay', 'session-status', sessionId));
  const status = JSON.parse(await readFile(path.join(context.paths.mind, 'user', 'relay', 'session-status', sessionId, statuses[0])));
  assert.equal(status.reason, 'native-acknowledged');
  const recovered = restart(context);
  recovered.removalFault = null;
  const removed = await removeUnit(recovered, UNIT, input);
  assert.ok(archiveEvents > 0);
  assert.equal(signaled.length, 1);
  await undoChange(recovered, removed.changeId);
  assert.equal((await readDetail(recovered, 'units', UNIT)).sessionIds.length, 0);
  assert.equal((await readProjection(recovered)).sessions[0].state, 'stopped');
  assert.equal(signaled.length, 1);
});

test('a pending stop leaves state and events unarchived until the owned native process acknowledges', async (t) => {
  const { context, file, input, start } = await world(t);
  await start();
  let release, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  context.adapters.codex.stop = () => { entered(); return new Promise((resolve) => { release = resolve; }); };
  const before = await readFile(file);
  const eventsBefore = context.store.events.length;
  const pending = removeUnit(context, UNIT, input);
  await waiting;
  assert.deepEqual(await readFile(file), before);
  assert.equal(context.store.events.length, eventsBefore);
  release({ acknowledged: true });
  await pending;
  assert.equal((await readCollection(context, 'units', { archived: true })).total, 1);
});

test('a kill request without an observed native exit never fabricates a stop acknowledgment', async (t) => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {} };
  child.pid = 4243;
  child.kill = () => true;
  const adapter = createNativeAdapter('claude', { command: 'fixture-native', spawn(_command, args) {
    const nativeSessionId = args[args.indexOf('--session-id') + 1];
    queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify({ type: 'system', subtype: 'init', session_id: nativeSessionId })}\n`));
    return child;
  } });
  t.after(async () => { child.exitCode = 0; child.emit('exit', 0); await adapter.close(); });
  const created = await adapter.create({ cwd: process.cwd() });
  assert.equal((await adapter.stop({ owned: true, pid: created.pid })).acknowledged, false);
});

test('reports that appear during native shutdown are rejected before the archival transaction', async (t) => {
  const { context, file, input, start } = await world(t);
  await start();
  const before = await readFile(file);
  context.adapters.codex.stop = async () => {
    await writeFile(path.join(context.paths.mind, 'user', 'state', 'late.md'), `unit: late\nunit-id: root:late\nrole: executor\nstate: out\nlead-id: ${UNIT}\n\n`);
    return { acknowledged: true };
  };
  await assert.rejects(removeUnit(context, UNIT, input), { code: 'unit_has_reports' });
  assert.deepEqual(await readFile(file), before);
  assert.equal((await readProjection(context)).sessions[0].state, 'stopped');
});

test('unsupported, unowned, remote and interrupted stops never archive or signal twice', async (t) => {
  for (const failure of ['unsupported', 'unowned', 'remote', 'interrupted', 'unacknowledged']) {
    const { context, file, input, start, signaled } = await world(t);
    if (failure === 'remote') await registerNative({ ...context, paths: { ...context.paths, machine: 'LAPTOP' } }, { unitId: UNIT, client: 'codex', nativeSessionId: 'remote' });
    else {
      await start();
      if (failure === 'unsupported') context.adapters.codex.capabilities.stop = false;
      if (failure === 'unowned') context.ownedPids.clear();
      if (failure === 'interrupted') context.adapters.codex.stop = async () => { signaled.push(1); throw Object.assign(new Error('Crash during stop'), { code: 'injected_crash' }); };
      if (failure === 'unacknowledged') context.adapters.codex.stop = async () => ({ acknowledged: false });
    }
    const before = await readFile(file);
    await assert.rejects(removeUnit(context, UNIT, input), { code: failure === 'interrupted' ? 'injected_crash' : 'stop_unavailable' });
    assert.deepEqual(await readFile(file), before);
    if (failure === 'interrupted') {
      await assert.rejects(removeUnit(restart(context), UNIT, input), { code: 'stop_unavailable' });
      assert.equal(signaled.length, 1);
    } else assert.equal(signaled.length, 0);
  }
});

test('confirmation, revision, master, reports, groups and desktop authority are checked before stopping', async (t) => {
  const { context, input, start, signaled } = await world(t);
  await start();
  await assert.rejects(removeUnit(context, UNIT, { ...input, confirmed: false }), { code: 'confirmation_required' });
  await assert.rejects(removeUnit(context, UNIT, { ...input, expectedRevision: '0'.repeat(64) }), { code: 'revision_conflict' });
  await assert.rejects(removeUnit(context, 'root:master', input), { code: 'invalid_unit' });
  for (const audience of ['phone', 'agent']) await assert.rejects(removeUnit({ ...context, principal: { ...context.principal, audience } }, UNIT, input), { code: 'forbidden' });
  const report = path.join(context.paths.mind, 'user', 'state', 'report.md');
  await writeFile(report, `unit: report\nunit-id: root:report\nrole: executor\nstate: out\nlead-id: ${UNIT}\n\n`);
  await assert.rejects(removeUnit(context, UNIT, input), { code: 'unit_has_reports' });
  await writeFile(report, 'unit: report\nunit-id: root:report\nrole: executor\nstate: out\n\n');
  const group = await createGroup(context, { title: 'Single', members: [UNIT] });
  await assert.rejects(removeUnit(context, UNIT, input), { code: 'invalid_members' });
  await patchGroup(context, group.id, { members: [UNIT, 'root:two'], expectedRevision: group.revision });
  assert.equal(signaled.length, 0);
});

test('archival transaction recovery and the same receipt replay only once', async (t) => {
  const { context, input } = await world(t);
  const receipt = { key: randomUUID(), requestId: randomUUID(), principal: 'desktop-fixture', method: 'DELETE', path: `/units/${UNIT}`, body: input };
  const run = (ctx) => withReceipt(ctx.store, receipt, async (saved) => ({ status: 200, body: await removeUnit({ ...ctx, receipt: saved }, UNIT, input) }));
  const native = await world(t);
  const started = await native.start();
  native.context.removalFault = 'after-stop';
  await assert.rejects(removeUnit(native.context, UNIT, native.input), { code: 'injected_crash' });
  native.context.removalFault = null;
  native.context.store.fault = { afterRenames: 1 };
  await assert.rejects(removeUnit(native.context, UNIT, native.input), { code: 'injected_crash' });
  const recovered = restart(native.context);
  await recoverTransactions(recovered.store);
  assert.equal((await readDetail(recovered, 'units', UNIT)).removed, true);
  assert.equal(native.signaled.length, 1);
  assert.equal((await readProjection(recovered)).sessions.find((session) => session.id === started.result.sessionId).state, 'stopped');
  const first = await run(context);
  const eventCount = context.store.events.length;
  const replay = await run(restart(context));
  assert.deepEqual(replay.body, first.body);
  assert.equal(replay.replayed, true);
  assert.equal(context.store.events.length, eventCount);
});

test('Undo expires or conflicts on changed unit, group or direct chat revisions', async (t) => {
  for (const failure of ['expired', 'unit', 'group', 'chat']) {
    const { fixture, context, file, input } = await world(t);
    const group = await createGroup(context, { title: 'Shared', members: [UNIT, 'root:two'] });
    const chat = (await createChat(context, { members: [UNIT] })).chat;
    const removed = await removeUnit(context, UNIT, input);
    if (failure === 'expired') fixture.clock.now += 10000;
    else {
      const changed = failure === 'unit' ? file : failure === 'group' ? path.join(context.paths.mind, 'user', 'gui', 'groups', `${group.id}.json`)
        : path.join(context.paths.mind, 'user', 'relay', 'chats', chat.id, 'chat.md');
      await writeFile(changed, Buffer.concat([await readFile(changed), Buffer.from('\n')]));
    }
    await assert.rejects(undoChange(context, removed.changeId), { code: failure === 'expired' ? 'undo_expired' : 'undo_conflict' });
    assert.equal((await readDetail(context, 'units', UNIT)).removed, true);
  }
});
