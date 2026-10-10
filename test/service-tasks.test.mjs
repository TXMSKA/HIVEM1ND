import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeStatus, loadTask, recoverTaskChanges, undoStatus } from '../engine/service/tasks.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const TASK = 'project:shop:029';
const AGENT = 'project:shop:executor-shop';
const LEAD = 'env:web:overlord-web';
const OTHER = 'env:web:overlord-other';

function state(unit, id, role, extra = '') {
  return `unit: ${unit}\nunit-id: ${id}\nrole: ${role}\nstate: in\nmachine: DESKTOP\n${extra}\nReady.\n`;
}

function taskText(body, status = 'open') {
  return [
    `id: ${TASK}`,
    'title: Review me',
    `status: ${status}`,
    'from: user',
    `to-id: ${AGENT}`,
    'date: 2026-10-10',
    '',
    '## Request',
    'Keep this request.',
    '',
    '## Request',
    'Keep the second request.',
    '',
    '## Report',
    'Existing report.',
    '',
    '## Extra',
    'Keep this extra.',
    '',
    body ?? '',
  ].filter((line, index, all) => !(index === all.length - 1 && line === '')).join('\r\n');
}

async function world(t) {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const root = fixture.paths.mind;
  await mkdir(path.join(root, 'user', 'state'), { recursive: true });
  await mkdir(path.join(root, 'user', 'tasks'), { recursive: true });
  await writeFile(path.join(root, 'user', 'state', 'executor-shop.md'), state('executor-shop', AGENT, 'executor', `lead: overlord-web\nlead-id: ${LEAD}\n`));
  await writeFile(path.join(root, 'user', 'state', 'overlord-web.md'), state('overlord-web', LEAD, 'overlord'));
  await writeFile(path.join(root, 'user', 'state', 'overlord-other.md'), state('overlord-other', OTHER, 'overlord'));
  await writeFile(path.join(root, 'user', 'tasks', '029-review.md'), taskText());
  const context = {
    store: fixture.store,
    paths: fixture.paths,
    now: () => fixture.clock.now,
    aliases: ['Tom'],
    principal: { unitId: 'root:master', audience: 'desktop' },
  };
  return { fixture, context, file: path.join(root, 'user', 'tasks', '029-review.md') };
}

function as(context, unitId) {
  return { ...context, principal: { unitId, audience: unitId === 'root:master' ? 'desktop' : 'agent' } };
}

async function records(fixture) {
  const directory = path.join(fixture.paths.mind, 'user', 'relay', 'task-undo', Buffer.from(TASK).toString('base64url'));
  return readdir(directory).catch(() => []);
}

test('a project task is read from its scope directory', async (t) => {
  const { fixture, context } = await world(t);
  const dir = path.join(fixture.paths.mind, 'user', 'projects', 'shop', 'tasks');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, '002.md'), taskText().replaceAll(`id: ${TASK}`, 'id: project:shop:002'));
  const task = await loadTask(context, 'project:shop:002');
  assert.equal(task.id, 'project:shop:002');
  await assert.rejects(() => loadTask(context, 'project:shop:003'), (error) => error.code === 'task_not_found');
});

test('only authorized edges commit and lead gating stays intact', async (t) => {
  const { fixture, context, file } = await world(t);
  const agent = as(context, AGENT);
  const lead = as(context, LEAD);
  const master = as(context, 'root:master');
  const stranger = as(context, 'project:shop:stranger');
  let task = await loadTask(agent, TASK);
  await assert.rejects(() => changeStatus(stranger, TASK, { status: 'review', expectedRevision: task.revision }), (error) => error.status === 403);
  await assert.rejects(() => changeStatus(agent, TASK, { status: 'open', expectedRevision: task.revision }), (error) => error.code === 'status_unchanged');
  await assert.rejects(() => changeStatus(agent, TASK, { status: 'closed', expectedRevision: task.revision }), (error) => error.code === 'invalid_transition');
  const original = await readFile(file);
  const delivered = await changeStatus(agent, TASK, { status: 'review', expectedRevision: task.revision, note: 'Listo: café' });
  assert.equal(delivered.body.status, 'review');
  const deliveredText = await readFile(file, 'utf8');
  assert.equal(deliveredText.includes('from: user'), true);
  assert.equal(deliveredText.includes('Keep this request.'), true);
  assert.equal(deliveredText.includes('Keep the second request.'), true);
  assert.equal(deliveredText.includes('Existing report.'), true);
  assert.equal(deliveredText.includes('Keep this extra.'), true);
  assert.equal(deliveredText.includes('Listo: café'), true);
  assert.equal(deliveredText.includes('\r\n'), true);
  assert.equal(original.toString('utf8').includes('from: user'), true);
  task = await loadTask(master, TASK);
  await assert.rejects(() => changeStatus(agent, TASK, { status: 'done', expectedRevision: task.revision }), (error) => error.status === 403);
  await assert.rejects(() => changeStatus(master, TASK, { status: 'done', expectedRevision: task.revision }), (error) => error.status === 403);
  await changeStatus(lead, TASK, { leadApproval: true, expectedRevision: task.revision });
  const approved = await readFile(file, 'utf8');
  assert.equal(approved.includes('Approved for review by overlord-web on 2026-10-10'), true);
  const statePath = path.join(fixture.paths.mind, 'user', 'state', 'executor-shop.md');
  await writeFile(statePath, state('executor-shop', AGENT, 'executor', `lead: overlord-other\nlead-id: ${OTHER}\n`));
  task = await loadTask(master, TASK);
  await assert.rejects(() => changeStatus(master, TASK, { status: 'done', expectedRevision: task.revision }), (error) => error.status === 403);
  await changeStatus(as(context, OTHER), TASK, { leadApproval: true, expectedRevision: task.revision });
  task = await loadTask(master, TASK);
  const accepted = await changeStatus(master, TASK, { status: 'done', expectedRevision: task.revision, note: 'Accepted.' });
  assert.equal(accepted.body.status, 'done');
  task = await loadTask(master, TASK);
  await changeStatus(master, TASK, { status: 'closed', expectedRevision: task.revision });
  task = await loadTask(agent, TASK);
  const reopened = await changeStatus(agent, TASK, { status: 'open', expectedRevision: task.revision });
  assert.equal(reopened.body.status, 'open');
  const notices = await readdir(path.join(fixture.paths.mind, 'user', 'relay', 'chats'), { recursive: true });
  assert.equal(notices.filter((name) => String(name).endsWith('.md') && String(name).includes('notices')).length, 1);
});

test('send-back needs a note and undo stops at a newer edit', async (t) => {
  const { fixture, context, file } = await world(t);
  const agent = as(context, AGENT);
  const lead = as(context, LEAD);
  let task = await loadTask(agent, TASK);
  await changeStatus(agent, TASK, { status: 'review', expectedRevision: task.revision });
  task = await loadTask(lead, TASK);
  await assert.rejects(() => changeStatus(lead, TASK, { status: 'open', expectedRevision: task.revision, note: '   ' }), (error) => error.code === 'note_required');
  await assert.rejects(() => changeStatus(agent, TASK, { status: 'open', expectedRevision: task.revision, note: 'No' }), (error) => error.status === 403);
  const sent = await changeStatus(lead, TASK, { status: 'open', expectedRevision: task.revision, note: 'Fix the edge.' });
  const text = await readFile(file, 'utf8');
  assert.equal(text.includes('Fix the edge.'), true);
  assert.equal(text.includes('Keep this request.'), true);
  assert.equal(text.includes('status: open'), true);
  task = await loadTask(agent, TASK);
  await changeStatus(agent, TASK, { status: 'review', expectedRevision: task.revision });
  task = await loadTask(agent, TASK);
  const current = await readFile(file, 'utf8');
  await writeFile(file, current.replace('Existing report.', 'External report.'));
  await assert.rejects(() => undoStatus(agent, TASK, { expectedRevision: task.revision }), (error) => error.code === 'revision_conflict');
  const edited = await loadTask(agent, TASK);
  await assert.rejects(() => undoStatus(agent, TASK, { expectedRevision: edited.revision }), (error) => error.code === 'undo_conflict');
  assert.equal((await readFile(file, 'utf8')).includes('External report.'), true);
  await writeFile(file, current);
  task = await loadTask(agent, TASK);
  const undone = await undoStatus(agent, TASK, { expectedRevision: task.revision });
  assert.equal(undone.body.status, 'open');
  assert.equal((await readFile(file, 'utf8')).includes('Existing report.'), true);
  assert.equal((await readFile(file, 'utf8')).includes('Undone.'), true);
  task = await loadTask(agent, TASK);
  await assert.rejects(() => undoStatus(agent, TASK, { expectedRevision: task.revision }), (error) => error.code === 'undo_conflict');
  await changeStatus(agent, TASK, { status: 'review', expectedRevision: task.revision });
  task = await loadTask(agent, TASK);
  await undoStatus(agent, TASK, { expectedRevision: task.revision });
  const names = await records(fixture);
  assert.equal(names.length >= 4, true);
  const folder = path.join(fixture.paths.mind, 'user', 'relay', 'task-undo', Buffer.from(TASK).toString('base64url'));
  const parsed = await Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(folder, name), 'utf8'))));
  const undoneIds = new Set(parsed.filter((record) => record.kind === 'undo').map((record) => record.undoOf));
  const kept = parsed.find((record) => record.kind === 'status' && !undoneIds.has(record.id));
  assert.equal(kept.undoOf, null);
  assert.equal(undoneIds.has(kept.id), false);
});

test('a repeated receipt and a crashed record recover without doubling', async (t) => {
  const { fixture, context, file } = await world(t);
  const agent = as(context, AGENT);
  const task = await loadTask(agent, TASK);
  const receipt = { principal: 'agent', key: randomUUID(), method: 'POST', path: `/api/v1/tasks/${TASK}/status`, body: { status: 'review' }, requestId: randomUUID() };
  await changeStatus(agent, TASK, { status: 'review', expectedRevision: task.revision, note: 'Once' }, { receipt });
  const again = await changeStatus(agent, TASK, { status: 'review', expectedRevision: 'stale', note: 'Twice' }, { receipt });
  assert.equal(again.replayed, true);
  assert.equal((await records(fixture)).length, 1);
  const other = await world(t);
  const otherAgent = as(other.context, AGENT);
  const otherLead = as(other.context, LEAD);
  const fresh = await loadTask(otherAgent, TASK);
  await changeStatus(otherAgent, TASK, { status: 'review', expectedRevision: fresh.revision });
  const reviewing = await loadTask(otherLead, TASK);
  other.fixture.store.fault = { afterRenames: 1 };
  await assert.rejects(() => changeStatus(otherLead, TASK, { leadApproval: true, expectedRevision: reviewing.revision }), (error) => error.code === 'injected_crash');
  await recoverTaskChanges(other.context);
  const restored = await readFile(other.file, 'utf8');
  assert.equal(restored.includes('Approved for review by overlord-web on 2026-10-10'), true);
  assert.equal((await records(other.fixture)).length, 2);
  const crashed = await loadTask(otherLead, TASK);
  other.fixture.store.fault = { afterRenames: 1 };
  await assert.rejects(() => changeStatus(otherLead, TASK, { status: 'open', expectedRevision: crashed.revision, note: 'Back' }), (error) => error.code === 'injected_crash');
  await writeFile(other.file, 'third-party bytes\r\n');
  await recoverTaskChanges(other.context);
  assert.equal(await readFile(other.file, 'utf8'), 'third-party bytes\r\n');
});
