import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createGroup, listGroups, patchGroup, removeGroup } from '../engine/service/groups.mjs';
import { createChat, patchChat, postChat, readChat } from '../engine/service/chats.mjs';
import { createEventBus } from '../engine/service/events.mjs';
import { projectChat, readCollection, readProjection } from '../engine/service/projection.mjs';
import { createStore, readBytes, recoverTransactions, revisionOf, undoChange, withReceipt } from '../engine/service/store.mjs';
import { openLedger } from '../engine/sync/limits.mjs';
import { listStaged, openSync } from '../engine/sync/store.mjs';
import { advanceClock, dispose, makeCoreFixture } from './core-fixture.mjs';
import { createGuiFixture } from './gui-fixture.mjs';

async function world(t) {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const states = [
    ['user/state/one.md', 'root:one', 'executor', 'root:overseer'],
    ['user/state/two.md', 'root:two', 'overlord', 'root:overseer'],
    ['user/projects/shop/state/three.md', 'project:shop:three', 'executor', 'root:two'],
    ['user/envs/dev/state/four.md', 'env:dev:four', 'executor', 'root:two'],
  ];
  for (const [relative, id, role, lead] of states) {
    const file = path.join(fixture.paths.mind, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `unit: ${id.split(':').at(-1)}\nunit-id: ${id}\nrole: ${role}\nstate: out\nlead-id: ${lead}\n\nKept context.\n`);
  }
  const context = { store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, projects: [],
    principal: { audience: 'desktop', unitId: 'root:master', capabilities: ['read', 'chat.manage'] },
    bus: createEventBus({ mind: fixture.paths.mind, now: () => fixture.clock.now }),
    sync: openSync({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now }),
    ledger: openLedger({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, machine: fixture.machine }) };
  return { fixture, context, states };
}

function groupFile(context, id) { return path.join(context.paths.mind, 'user', 'gui', 'groups', `${id}.json`); }
function chatFile(context, id) { return path.join(context.paths.mind, 'user', 'relay', 'chats', id, 'chat.md'); }

test('group validation rejects invalid titles, members and empty patches without creating a chat', async (t) => {
  const { context } = await world(t);
  for (const title of [undefined, null, 1, '', '  ', 'a'.repeat(241), 'a\nb', 'a\rb', 'a\0b', 'a\u007fb', 'a\u2028b']) {
    await assert.rejects(createGroup(context, { title, members: ['root:one'] }), { code: 'invalid_title' });
  }
  for (const members of [undefined, null, {}, ['root:master'], ['root:missing'], ['one'], [null], ['root:one', 'root:one'], Array(256).fill('root:one')]) {
    await assert.rejects(createGroup(context, { title: 'Group', members }), { code: 'invalid_members' });
  }
  assert.equal((await readProjection(context)).chats.length, 0);
  const group = await createGroup(context, { title: 'x'.repeat(240), members: ['root:one'] });
  await assert.rejects(patchGroup(context, group.id, { expectedRevision: group.revision }), { code: 'invalid_body' });
  await assert.rejects(removeGroup(context, group.id, { confirmed: false, expectedRevision: group.revision }), { code: 'confirmation_required' });
  await assert.rejects(patchGroup(context, randomUUID(), { title: 'Other', expectedRevision: group.revision }), { code: 'group_not_found' });
});

test('one-member groups stay distinct from reusable direct chats and cross-scope leads never change', async (t) => {
  const { context, states } = await world(t);
  const before = await Promise.all(states.map(([relative]) => readFile(path.join(context.paths.mind, ...relative.split('/')))));
  const direct = await createChat(context, { members: ['root:one'] });
  const group = await createGroup(context, { title: '  Checkout $& launch  ', members: ['root:one'] });
  assert.equal(group.title, 'Checkout $& launch');
  assert.equal(group.chatId, group.id);
  assert.notEqual(group.chatId, direct.chat.id);
  const chat = await projectChat(context, group.id);
  assert.equal(chat.kind, 'group');
  assert.equal(chat.archived, false);
  assert.deepEqual(chat.members, ['root:master', 'root:one']);
  assert.equal((await createChat(context, { members: ['root:one'] })).chat.id, direct.chat.id);
  const cross = await createGroup(context, { title: 'Cross scope', members: ['root:two', 'project:shop:three', 'env:dev:four'] });
  assert.deepEqual(cross.members, ['env:dev:four', 'project:shop:three', 'root:two']);
  const after = await Promise.all(states.map(([relative]) => readFile(path.join(context.paths.mind, ...relative.split('/')))));
  assert.deepEqual(after, before);
  assert.equal((await readProjection(context)).counts.groups, 2);
  assert.equal((await listGroups(context, { q: 'Checkout' })).total, 1);
  assert.equal((await listGroups(context, { limit: 1 })).nextCursor != null, true);
});

test('title and member changes commit together, retain unknown fields and enforce current membership', async (t) => {
  const { context } = await world(t);
  let group = await createGroup(context, { title: 'Original', members: ['root:one'] });
  const sent = await postChat(context, group.id, { body: 'Retained history' });
  const oldBytes = await readFile(groupFile(context, group.id));
  const record = JSON.parse(oldBytes);
  record.extension = { retained: true };
  await writeFile(groupFile(context, group.id), `${JSON.stringify(record)}\n`);
  const bytes = await readFile(groupFile(context, group.id));
  group = await patchGroup(context, group.id, { title: 'Changed $&', members: ['project:shop:three', 'root:two'], expectedRevision: revisionOf(bytes) });
  const chat = await projectChat(context, group.id);
  assert.equal(chat.title, group.title);
  assert.deepEqual(chat.members, ['project:shop:three', 'root:master', 'root:two']);
  assert.deepEqual(JSON.parse(await readFile(groupFile(context, group.id))).extension, { retained: true });
  assert.equal((await readCollection(context, 'messages', { chatId: group.id })).items[0].id, sent.message.id);
  const former = { ...context, principal: { audience: 'agent', unitId: 'root:one' } };
  assert.equal((await readCollection(former, 'chats')).total, 0);
  assert.equal((await listGroups(former)).total, 0);
  assert.equal((await readCollection(former, 'messages', { chatId: group.id })).total, 0);
  await assert.rejects(postChat(former, group.id, { body: 'Forbidden' }), { code: 'not_chat_member' });
  await assert.rejects(readChat(former, group.id, { messageIds: [sent.message.id] }), { code: 'not_chat_member' });
  const member = { ...context, principal: { audience: 'agent', unitId: 'root:two' } };
  assert.equal((await readCollection(member, 'messages', { chatId: group.id })).total, 1);
});

test('stale group or linked chat revisions write neither record', async (t) => {
  const { context } = await world(t);
  const group = await createGroup(context, { title: 'Original', members: ['root:one'] });
  const changed = await patchGroup(context, group.id, { title: 'New', expectedRevision: group.revision });
  const before = await readFile(chatFile(context, group.id));
  await assert.rejects(patchGroup(context, group.id, { title: 'Stale', expectedRevision: group.revision }), { code: 'revision_conflict' });
  await assert.rejects(removeGroup(context, group.id, { confirmed: true, expectedRevision: group.revision }), { code: 'revision_conflict' });
  assert.deepEqual(await readFile(chatFile(context, group.id)), before);
  await writeFile(chatFile(context, group.id), Buffer.concat([before, Buffer.from('Foreign metadata edit\n')]));
  const groupBefore = await readFile(groupFile(context, group.id));
  await assert.rejects(patchGroup(context, group.id, { title: 'Other', expectedRevision: changed.revision }), { code: 'chat_changed' });
  await assert.rejects(removeGroup(context, group.id, { confirmed: true, expectedRevision: changed.revision }), { code: 'chat_changed' });
  assert.deepEqual(await readFile(groupFile(context, group.id)), groupBefore);
});

test('pin and list edits preserve the linked group revision binding', async (t) => {
  const { fixture, context } = await world(t);
  const group = await createGroup(context, { title: 'Original', members: ['root:one'] });
  const chat = await projectChat(context, group.id);
  await patchChat(context, group.id, { pinned: true, expectedRevision: chat.revision });
  const current = (await listGroups(context)).items[0];
  assert.notEqual(current.revision, group.revision);
  const changed = await patchGroup(context, group.id, { title: 'Pinned group', expectedRevision: current.revision });
  assert.equal((await projectChat(context, group.id)).pinned, true);
  assert.equal(changed.title, 'Pinned group');
  const latestChat = await projectChat(context, group.id);
  const request = { principal: 'fixture-desktop', key: randomUUID(), requestId: randomUUID(), method: 'PATCH', path: `/chats/${group.id}`,
    body: { pinned: false, expectedRevision: latestChat.revision } };
  fixture.store.fault = { afterRenames: 1 };
  await assert.rejects(withReceipt(fixture.store, request, (receipt) => patchChat({ ...context, receipt }, group.id, request.body)), { code: 'injected_crash' });
  const replay = await withReceipt(fixture.store, request, () => { throw new Error('The chat receipt must replay.'); });
  assert.equal(replay.replayed, true);
  assert.equal(replay.body.pinned, false);
  assert.equal(replay.body.revision, revisionOf(await readFile(chatFile(context, group.id))));
  assert.deepEqual(replay.body, await projectChat(context, group.id));
});

test('the 255-member limit includes master only in the linked chat and corrupt group records remain isolated', async (t) => {
  const { context } = await world(t);
  const members = [];
  for (let index = 0; index < 255; index += 1) {
    const unit = `unit-${index}`;
    members.push(`root:${unit}`);
    await writeFile(path.join(context.paths.mind, 'user', 'state', `${unit}.md`), `unit: ${unit}\nunit-id: root:${unit}\nrole: executor\nstate: out\n\n`);
  }
  const group = await createGroup(context, { title: 'Maximum group', members });
  assert.equal(group.members.length, 255);
  assert.equal((await projectChat(context, group.id)).members.length, 256);
  const id = randomUUID();
  await writeFile(groupFile(context, id), JSON.stringify({ format: 'hivem1nd-group-v1', id, chatId: id, members: ['root:one'], deleted: false }));
  const view = await readProjection(context);
  assert.equal(view.groups.length, 1);
  assert.ok(view.issues.some((issue) => issue.path.endsWith(`${id}.json`) && issue.code === 'corrupt_resource'));
});

test('crashes after the first create or edit write recover group and chat once, including staged transaction and receipt', async (t) => {
  const { fixture, context, states } = await world(t);
  const stateBytes = await Promise.all(states.map(([relative]) => readFile(path.join(context.paths.mind, ...relative.split('/')))));
  const request = { principal: 'fixture-desktop', key: randomUUID(), requestId: randomUUID(), method: 'POST', path: '/groups', body: { title: 'Recovered', members: ['root:one'] } };
  const cursor = context.bus.captureCursor();
  const subscriber = context.bus.subscribe({ stableId: 'desktop', audience: 'desktop' });
  fixture.store.fault = { afterRenames: 1 };
  await assert.rejects(withReceipt(fixture.store, request, (receipt) => createGroup({ ...context, receipt }, request.body)), { code: 'injected_crash' });
  const names = await readdir(path.dirname(groupFile(context, randomUUID())));
  assert.equal(names.length, 1);
  const groupId = names[0].slice(0, -5);
  assert.equal(await readBytes({ ...fixture.store, autoRecover: false }, chatFile(context, groupId)), null);
  await recoverTransactions(fixture.store);
  const replay = await withReceipt(fixture.store, request, () => { throw new Error('The receipt must replay.'); });
  assert.equal(replay.replayed, true);
  assert.equal(replay.body.revision, revisionOf(await readFile(groupFile(context, groupId))));
  assert.equal((await readProjection(context)).chats.length, 1);
  assert.equal(fixture.events.filter((event) => event.name === 'group.changed').length, 1);
  assert.equal(context.bus.replay(subscriber, cursor).events.filter((event) => event.name === 'group.changed').length, 1);
  await recoverTransactions(fixture.store);
  assert.equal((await listStaged(context.sync)).length, 2);
  fixture.store.fault = { afterRenames: 1 };
  await assert.rejects(patchGroup(context, groupId, { title: 'Recovered edit', expectedRevision: replay.body.revision }), { code: 'injected_crash' });
  const recoveredView = await readProjection(context);
  assert.equal(recoveredView.groups[0].title, 'Recovered edit');
  assert.equal(recoveredView.chats[0].title, 'Recovered edit');
  assert.deepEqual(await Promise.all(states.map(([relative]) => readFile(path.join(context.paths.mind, ...relative.split('/'))))), stateBytes);
});

test('restart after the first deletion write restores a protected Undo copy before success', async (t) => {
  const { fixture, context } = await world(t);
  const group = await createGroup(context, { title: 'Archive', members: ['root:one'] });
  fixture.store.fault = { afterRenames: 1 };
  await assert.rejects(removeGroup(context, group.id, { confirmed: true, expectedRevision: group.revision }), { code: 'injected_crash' });
  const fresh = createStore({ root: fixture.root, confineRoot: fixture.root, mindPath: fixture.paths.mind, localDirectory: fixture.paths.localDirectory, now: context.now });
  fresh.aclRunner = fixture.store.aclRunner;
  const restarted = { ...context, store: fresh, sync: openSync({ store: fresh, paths: context.paths, now: context.now }) };
  const view = await readProjection(restarted);
  assert.equal(view.groups.length, 0);
  const names = await readdir(path.join(fixture.paths.localDirectory, 'change-undo'));
  const undoRecords = await Promise.all(names.map(async name => ({ name, record: JSON.parse(await readFile(path.join(fixture.paths.localDirectory, 'change-undo', name))) })));
  const archivedRevision = revisionOf(await readFile(groupFile(context, group.id)));
  const name = undoRecords.find(item => item.record.entries.some(entry => entry.recordPath === groupFile(context, group.id) && entry.afterRevision === archivedRevision)).name;
  await undoChange(restarted, name.slice(0, -5));
  assert.equal((await readProjection(restarted)).groups[0].revision, group.revision);
});

test('delete archives only its group chat and Undo restores exact metadata and messages within ten seconds', async (t) => {
  const { fixture, context, states } = await world(t);
  const direct = await createChat(context, { members: ['root:one'] });
  await patchChat(context, direct.chat.id, { listed: false, expectedRevision: direct.chat.revision });
  let group = await createGroup(context, { title: 'Archive', members: ['root:one'] });
  const chat = await projectChat(context, group.id);
  await patchChat(context, group.id, { pinned: true, expectedRevision: chat.revision });
  group = (await listGroups(context)).items[0];
  const sent = await postChat(context, group.id, { body: 'History survives' });
  const before = await readFile(chatFile(context, group.id));
  const leadBefore = await readFile(path.join(context.paths.mind, ...states[0][0].split('/')));
  const removed = await removeGroup(context, group.id, { confirmed: true, expectedRevision: group.revision });
  assert.equal(Date.parse(removed.undoUntil) - context.now(), 10000);
  assert.equal((await readProjection(context)).counts.groups, 0);
  assert.equal((await readProjection(context)).counts.chats, 0);
  assert.equal((await readProjection(context)).counts.unread, 0);
  const archives = await readCollection(context, 'chats', { archived: true });
  assert.deepEqual(archives.items.map((item) => item.id), [group.id]);
  assert.equal(archives.items[0].listed, false);
  assert.equal((await readCollection(context, 'chats', { listed: false })).items[0].id, direct.chat.id);
  assert.equal((await readCollection(context, 'messages', { chatId: group.id })).items[0].id, sent.message.id);
  const member = { ...context, principal: { audience: 'agent', unitId: 'root:one' } };
  assert.equal((await readCollection(member, 'messages', { chatId: group.id })).total, 1);
  advanceClock(fixture, 9999);
  const restored = await undoChange(context, removed.changeId);
  assert.equal(restored.undoOf, removed.changeId);
  assert.deepEqual(restored.resourceIds, [group.id]);
  assert.deepEqual(await readFile(chatFile(context, group.id)), before);
  assert.deepEqual(await readFile(path.join(context.paths.mind, ...states[0][0].split('/'))), leadBefore);
  assert.equal((await listGroups(context)).items[0].revision, group.revision);
  await assert.rejects(undoChange(context, removed.changeId), { code: 'undo_conflict' });
});

test('the compatibility removal response retains group identity on receipt replay', async t => {
  const { context } = await world(t);
  const group = await createGroup(context, { title: 'Receipt', members: ['root:one'] });
  const body = { confirmed: true, expectedRevision: group.revision };
  const request = { principal: 'desktop', key: randomUUID(), requestId: randomUUID(), method: 'DELETE', path: `/groups/${group.id}`, body };
  const first = await withReceipt(context.store, request, receipt => removeGroup({ ...context, receipt }, group.id, body));
  const replay = await withReceipt(context.store, request, () => { throw new Error('The receipt must replay.'); });
  assert.equal(first.groupId, group.id);
  assert.deepEqual(replay.body, first);
});

test('Undo expires at ten seconds or rejects either changed record without restoring anything', async (t) => {
  for (const change of ['expired', 'group', 'chat']) {
    await t.test(change, async (t) => {
      const { fixture, context } = await world(t);
      const group = await createGroup(context, { title: 'Archive', members: ['root:one'] });
      const removed = await removeGroup(context, group.id, { confirmed: true, expectedRevision: group.revision });
      if (change === 'expired') advanceClock(fixture, 10000);
      else {
        const file = change === 'group' ? groupFile(context, group.id) : chatFile(context, group.id);
        await writeFile(file, Buffer.concat([await readFile(file), Buffer.from(' ')]));
      }
      const before = [await readFile(groupFile(context, group.id)), await readFile(chatFile(context, group.id))];
      await assert.rejects(undoChange(context, removed.changeId), { code: change === 'expired' ? 'undo_expired' : 'undo_conflict' });
      assert.deepEqual([await readFile(groupFile(context, group.id)), await readFile(chatFile(context, group.id))], before);
    });
  }
});

test('group events use current membership on replay and phone or agent cannot mutate or undo', async (t) => {
  const { context } = await world(t);
  const cursor = context.bus.captureCursor();
  const group = await createGroup(context, { title: 'Members', members: ['root:one'] });
  await patchGroup(context, group.id, { members: ['root:two'], expectedRevision: group.revision });
  const outsider = context.bus.subscribe({ stableId: 'outsider', audience: 'agent', unitId: 'root:one' });
  assert.equal(context.bus.replay(outsider, cursor).events.some((event) => event.name === 'group.changed'), false);
  const member = context.bus.subscribe({ stableId: 'member', audience: 'agent', unitId: 'root:two' });
  assert.equal(context.bus.replay(member, cursor).events.filter((event) => event.name === 'group.changed').length, 2);
  for (const audience of ['phone', 'agent']) {
    const denied = { ...context, principal: { audience, unitId: 'root:one' } };
    await assert.rejects(createGroup(denied, { title: 'Denied', members: ['root:one'] }), { code: 'forbidden' });
    await assert.rejects(patchGroup(denied, group.id, { title: 'Denied', expectedRevision: group.revision }), { code: 'forbidden' });
    await assert.rejects(removeGroup(denied, group.id, { confirmed: true, expectedRevision: group.revision }), { code: 'forbidden' });
    await assert.rejects(undoChange(denied, randomUUID()), { code: 'forbidden' });
  }
});

test('the browser fixture implements the same group, archive and ten-second Undo protocol', async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  async function call(method, target, body, key = randomUUID()) {
    const response = await fetch(`${fixture.origin}/api/v1${target}`, { method,
      headers: { ...fixture.headers, ...(body === undefined ? {} : { 'content-type': 'application/json', 'idempotency-key': key }) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, json: await response.json() };
  }
  const before = (await call('GET', '/view')).json.data;
  const unit = before.units.find((item) => item.role !== 'master' && item.revision);
  const body = { title: 'Fixture group', members: [unit.id] };
  const key = randomUUID();
  const created = await call('POST', '/groups', body, key);
  assert.equal(created.status, 201);
  assert.deepEqual((await call('POST', '/groups', body, key)).json.data, created.json.data);
  const group = created.json.data;
  const chat = (await call('GET', `/chats/${group.id}`)).json.data;
  assert.equal(chat.kind, 'group');
  assert.equal(chat.archived, false);
  const patched = await call('PATCH', `/groups/${group.id}`, { title: 'Fixture renamed', expectedRevision: group.revision });
  assert.equal(patched.status, 200);
  assert.equal((await call('GET', `/chats/${group.id}`)).json.data.title, 'Fixture renamed');
  const removed = await call('DELETE', `/groups/${group.id}`, { confirmed: true, expectedRevision: patched.json.data.revision });
  assert.equal(removed.status, 200);
  assert.equal((await call('GET', '/groups')).json.data.total, 0);
  assert.equal((await call('GET', '/chats?archived=true')).json.data.items[0].id, group.id);
  const restored = await call('POST', `/changes/${removed.json.data.changeId}/undo`, {});
  assert.equal(restored.status, 200);
  const after = (await call('GET', '/view')).json.data;
  assert.equal(after.groups[0].revision, patched.json.data.revision);
  assert.deepEqual(after.units.map((item) => [item.id, item.leadId, item.revision]), before.units.map((item) => [item.id, item.leadId, item.revision]));
  const expired = await call('DELETE', `/groups/${group.id}`, { confirmed: true, expectedRevision: patched.json.data.revision });
  await fixture.control.advance(10000);
  const tooLate = await call('POST', `/changes/${expired.json.data.changeId}/undo`, {});
  assert.equal(tooLate.status, 410);
  assert.equal(tooLate.json.error.code, 'undo_expired');
});
