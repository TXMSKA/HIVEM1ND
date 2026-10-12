import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalTaskId, hashBytes, inboxDirectory, parseUnitId, scopeDirectory, unitStatePath } from '../engine/service/identity.mjs';
import { readUnitState } from '../engine/service/state.mjs';
import { consumeRevocations, listGrants, revokeGrant } from '../engine/service/approvals.mjs';
import { createNativeAdapter, enqueueStart } from '../engine/service/adapters.mjs';
import { changeStatus, loadTask, reviewAuthority } from '../engine/service/tasks.mjs';
import { createChat, postChat, readChat } from '../engine/service/chats.mjs';
import { openLedger } from '../engine/sync/limits.mjs';
import { readProjection } from '../engine/service/projection.mjs';
import { connectLead, createUnit } from '../engine/service/units.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

test('existing environment states, tasks and mailboxes use the documented envs directory', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const environment = path.join(fixture.paths.mind, 'user', 'envs', 'web');
  for (const directory of ['state', 'tasks', 'inbox/operator']) await mkdir(path.join(environment, directory), { recursive: true });
  await writeFile(path.join(environment, 'state/operator.md'), 'unit: operator\nrole: overlord\nstate: in\nmachine: DESKTOP\n\nKeep existing context.\n');
  await writeFile(path.join(environment, 'tasks/007.md'), 'id: 007\nstatus: open\nfrom: user\nto: operator\n\n## Request\nKeep existing work.\n');
  await writeFile(path.join(environment, 'inbox/operator/note.md'), 'id: env-note\nfrom: user\nto: operator\ntimestamp: 2026-10-10T12:00:00.000Z\n\nKeep existing mail.\n');
  const context = { store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now };
  const view = await readProjection(context);
  const unit = view.units.find((item) => item.id === 'env:web:operator');
  assert.ok(unit);
  assert.equal(unit.context.trim(), 'Keep existing context.');
  assert.equal(view.tasks.find((item) => item.id === 'env:web:007').toId, unit.id);
  assert.equal(view.messages.find((item) => item.id === 'env-note').toId, unit.id);
  assert.equal(canonicalTaskId('007', 'user/envs/web/tasks/007.md'), 'env:web:007');
  assert.equal(scopeDirectory('env:web'), 'user/envs/web');
  assert.equal(unitStatePath(parseUnitId(unit.id)), 'user/envs/web/state/operator.md');
  assert.equal(inboxDirectory(parseUnitId(unit.id)), 'user/envs/web/inbox/operator');
  const connected = await connectLead(context, unit.id, { leadId: null, confirmed: true, expectedRevision: unit.revision });
  assert.equal(connected.unit.id, unit.id);
  assert.match(await readFile(path.join(environment, 'state/operator.md'), 'utf8'), /Keep existing context/);
});

test('scoped lookup refuses same-name root fallback and conflicting canonical identities', async (t) => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const context = { store: fixture.store, paths: fixture.paths };
  const root = path.join(fixture.paths.mind, 'user/state'); await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'worker.md'), 'unit: worker\nrole: executor\nstate: in\n\nRoot only.\n');
  assert.equal(await readUnitState(context, parseUnitId('project:shop:worker')), null);
  const scoped = path.join(fixture.paths.mind, 'user/projects/shop/state'); await mkdir(scoped, { recursive: true });
  await writeFile(path.join(scoped, 'worker.md'), 'unit: worker\nunit-id: project:other:worker\nrole: executor\nstate: in\n');
  await writeFile(path.join(root, 'worker.md'), 'unit: worker\nunit-id: project:shop:worker\nrole: executor\nstate: in\n');
  assert.equal(await readUnitState(context, parseUnitId('project:shop:worker')), null);
});

test('legacy environment cycles and scoped grant resurrection remain denied', async (t) => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const directory = path.join(fixture.paths.mind, 'user/envs/web/state'); await mkdir(directory, { recursive: true });
  const worker = 'unit: worker\nrole: executor\nstate: in\nmachine: DESKTOP\nlead-id: env:web:lead\n\nKeep worker context.\n';
  const lead = 'unit: lead\nrole: overlord\nstate: in\nmachine: DESKTOP\n\nKeep lead context.\n';
  await writeFile(path.join(directory, 'worker.md'), worker); await writeFile(path.join(directory, 'lead.md'), lead);
  const context = { store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, principal: { unitId: 'root:master', audience: 'desktop' } };
  await assert.rejects(() => connectLead(context, 'env:web:lead', { leadId: 'env:web:worker', confirmed: true, expectedRevision: hashBytes(Buffer.from(lead)) }), { code: 'lead_cycle' });
  const granted = worker.replace('\n\n', '\napprovals: [{"id":"scoped-grant","action":"process.run","pattern":{"command":"npm test","cwd":"project:shop"}}]\n\n');
  const file = path.join(directory, 'worker.md'); await writeFile(file, granted);
  await revokeGrant(context, 'env:web:worker', 'scoped-grant', { expectedRevision: hashBytes(Buffer.from(granted)) });
  await writeFile(file, granted);
  await consumeRevocations(context);
  assert.equal((await listGrants(context, 'env:web:worker')).items.length, 0);
  assert.match(await readFile(file, 'utf8'), /Keep worker context/);
});

test('scoped native launch and task review use the scoped state authority', async (t) => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const directory = path.join(fixture.paths.mind, 'user/projects/shop');
  await mkdir(path.join(directory, 'state'), { recursive: true }); await mkdir(path.join(directory, 'tasks'), { recursive: true });
  const state = 'unit: worker\nrole: executor\nstate: in\nmachine: DESKTOP\nlead-id: project:shop:lead\n\nScoped context.\n';
  await writeFile(path.join(directory, 'state/worker.md'), state);
  await writeFile(path.join(directory, 'state/lead.md'), 'unit: lead\nrole: overlord\nstate: in\nmachine: DESKTOP\n');
  const task = 'id: 007\nstatus: review\nfrom: user\nto: worker\ndate: 2026-10-10\n\n## Request\nKeep authority.\n\n## Report\nDelivered.\n';
  await writeFile(path.join(directory, 'tasks/007.md'), task);
  const adapter = createNativeAdapter('codex', { fixture: true, transcript: ['{"id":2,"result":{"thread":{"id":"scoped-thread"}}}'] });
  const context = { store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, beat: { state: 'running', heartbeatAt: new Date(fixture.clock.now).toISOString() }, projects: [{ name: 'shop', localPath: fixture.root }], adapters: { codex: adapter }, principal: { unitId: 'root:master', audience: 'desktop' }, ownedPids: new Set() };
  const loaded = await loadTask(context, 'project:shop:007'); assert.equal(loaded.toId, 'project:shop:worker'); assert.equal(reviewAuthority(loaded).reviewable, false);
  await assert.rejects(() => changeStatus(context, loaded.id, { status: 'done', expectedRevision: loaded.revision }), { code: 'forbidden' });
  const started = await enqueueStart(context, { unitId: 'project:shop:worker', client: 'codex', stateRevision: hashBytes(Buffer.from(state)) });
  assert.equal(started.result.state, 'started'); await adapter.close();
  context.ledger = openLedger({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, machine: fixture.machine });
  const chat = (await createChat(context, { members: ['project:shop:worker'] })).chat;
  const noticeId = '11111111-1111-4111-8111-111111111111';
  await writeFile(path.join(fixture.paths.mind, `user/relay/chats/${chat.id}/encoded-task-notice.md`), `id: ${noticeId}\nfrom: master\nfrom-id: root:master\nto-id: project:shop:worker\nkind: task-notice\ntimestamp: 2026-10-10T12:00:00.000Z\n\nDelivered.\n`);
  const read = await readChat(context, chat.id, { messageIds: [noticeId] }); assert.equal(read.unread, 0);
  const reply = await postChat(context, chat.id, { body: 'Reply to the real message identity.', replyTo: noticeId }); assert.equal(reply.message.replyTo, noticeId);
});

test('environment unit creation and cycle checks read and write the same canonical directory', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  fixture.paths.origin = path.join(fixture.root, 'origin');
  await mkdir(path.join(fixture.paths.origin, 'machines/DESKTOP'), { recursive: true });
  await writeFile(path.join(fixture.paths.origin, 'machines/DESKTOP/service.json'), JSON.stringify({ state: 'running', heartbeatAt: new Date(fixture.clock.now).toISOString() }));
  const context = { store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now };
  const lead = await createUnit(context, { unit: 'lead', role: 'overlord', scope: 'env:web', machine: 'DESKTOP' });
  await createUnit(context, { unit: 'worker', role: 'executor', scope: 'env:web', machine: 'DESKTOP', leadId: lead.unit.id });
  assert.match(await readFile(path.join(fixture.paths.mind, 'user/envs/web/state/worker.md'), 'utf8'), /lead-id: env:web:lead/);
  await assert.rejects(() => connectLead(context, lead.unit.id, { leadId: 'env:web:worker', confirmed: true, expectedRevision: lead.unit.revision }), { code: 'lead_cycle' });
});
