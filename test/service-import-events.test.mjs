import './relay-local-state.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEventBus } from '../engine/service/events.mjs';
import { startService, stopService } from '../engine/service/service.mjs';
import { createChat } from '../engine/service/chats.mjs';
import { createComment, createText, replyComment, writeAttachments } from '../engine/service/editors.mjs';
import { applyPack } from '../engine/sync/apply.mjs';
import { readHead, readOriginPack } from '../engine/sync/origin.mjs';
import { stageTransaction } from '../engine/sync/store.mjs';
import { makeCoreFixture, dispose } from './core-fixture.mjs';

async function waitFor(read) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await read();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('The imported event did not arrive.');
}

test('two cores project imported tasks, encoded notices and editor sidecars once, then restart quietly', async t => {
  const left = await makeCoreFixture({ machine: 'ALPHA' });
  const right = await makeCoreFixture({ machine: 'BRAVO' });
  const origin = path.join(left.root, 'origin');
  await mkdir(origin);
  let a, b;
  t.after(async () => { await stopService(a); await stopService(b); await dispose(right); await dispose(left); });
  for (const fixture of [left, right]) {
    fixture.store.confineRoot = os.tmpdir();
    await mkdir(path.join(fixture.paths.mind, 'user/state'), { recursive: true });
    await writeFile(path.join(fixture.paths.mind, 'user/state/master.md'), 'unit: master\nrole: master\nstate: in\n\nReady.\n');
    fixture.project = path.join(fixture.root, 'shop');
    await mkdir(fixture.project);
  }
  const options = fixture => ({ store: fixture.store, paths: { ...fixture.paths, origin }, projects: [{ name: 'shop', localPath: fixture.project }], now: Date.now, clients: [] });
  async function start(fixture, bus = createEventBus({ machine: fixture.machine, mind: fixture.paths.mind })) {
    return { ...await startService({ ...options(fixture), bus, env: fixture.env, guardPort: 0, userKey: fixture.machine }), bus };
  }
  a = await start(left);
  b = await start(right);
  const frames = [];
  const principal = { stableId: randomUUID(), audience: 'desktop', unitId: 'root:master' };
  const subscriber = b.bus.subscribe(principal, {}, frame => frames.push(frame));
  const context = { ...options(left), paths: a.runtime.paths, sync: a.runtime.sync, pulse: a.runtime.pulse, ledger: a.runtime.ledger, bus: a.bus, principal };
  const created = await createChat(context, { members: ['root:master'], title: 'Imported notices' });
  await a.runtime.pulse.flush();
  await waitFor(() => frames.some(frame => frame.name === 'chat.changed'));
  const noticeId = randomUUID();
  const changes = await stageTransaction(a.runtime.sync, [
    { target: { kind: 'mind', path: 'user/projects/shop/tasks/001-release.md' }, bytes: Buffer.from('id: 001\nstatus: review\nfrom: master\nto: master\n\n## Request\nCheck the release.\n\n## Report\nReady.\n') },
    { target: { kind: 'mind', path: `user/relay/chats/${created.chat.id}/encoded-task-notice.md` }, bytes: Buffer.from(`id: ${noticeId}\nfrom: master\nto: ${created.chat.id}\nmachine: ALPHA\nsubject: Review task\nkind: task\n\nReady for review.\n`) },
  ]);
  await a.runtime.pulse.changed(changes.map(change => change.id));
  await a.runtime.pulse.flush();
  await waitFor(() => frames.some(frame => frame.name === 'task.changed') && frames.some(frame => frame.name === 'message.created' && frame.data.data.message.id === noticeId));
  const task = frames.find(frame => frame.name === 'task.changed');
  assert.equal(task.data.data.task.id, 'project:shop:001');
  assert.equal(task.data.data.task.status, 'review');
  assert.equal(task.data.source.kind, 'sync');
  assert.equal(frames.filter(frame => frame.name === 'message.created' && frame.data.data.message.id === noticeId).length, 1);
  assert.ok(frames.some(frame => frame.name === 'view.changed' && frame.data.data.collections.includes('waiting') && frame.data.data.collections.includes('tasks')));
  const text = await createText(context, { project: 'shop', path: 'docs/release.json', document: { v: 1, rev: 1, title: 'Release', langs: ['en'], pages: [{ k: 'Intro', en: 'Welcome' }] } });
  const attachment = await writeAttachments(context, text.id, { attached: ['root:master'], expectedRevision: null });
  const comment = await createComment(context, text.id, { text: 'Review this', expectedRevision: text.revision, expectedCommentsRevision: text.commentsRevision, anchor: { k: 'Intro', lang: 'en', start: 0, end: 7, quote: 'Welcome' } });
  await replyComment(context, text.id, comment.thread.id, { text: 'Checked', expectedCommentsRevision: comment.commentsRevision });
  await a.runtime.pulse.flush();
  await waitFor(() => frames.some(frame => frame.name === 'comment.changed' && frame.data.data.thread.messages.length === 2));
  assert.ok(frames.some(frame => frame.name === 'editor.attachments.changed' && frame.data.data.revision === attachment.revision));
  assert.equal(b.runtime.lastError, null);
  const count = frames.length;
  const head = await readHead(a.runtime.origin, 'ALPHA');
  const pack = await readOriginPack(a.runtime.origin, 'ALPHA', head.sequence);
  const replay = await applyPack(b.runtime.sync, pack, { projects: b.runtime.sync.projects });
  assert.equal(replay.replayed, true);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(frames.length, count);
  b.bus.release(subscriber);
  await stopService(b);
  const restartedEvents = [];
  const bus = createEventBus({ machine: 'BRAVO', mind: right.paths.mind });
  bus.subscribe({ ...principal, stableId: randomUUID() }, {}, frame => restartedEvents.push(frame));
  b = await start(right, bus);
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(restartedEvents.filter(frame => frame.data.source.kind === 'sync').length, 0);
  assert.equal(b.runtime.lastError, null);
  assert.match(await readFile(path.join(right.paths.mind, 'user/projects/shop/tasks/001-release.md'), 'utf8'), /status: review/);
  await stopService(a);
  a = await start(left);
  assert.equal(a.runtime.lastError, null);
});
