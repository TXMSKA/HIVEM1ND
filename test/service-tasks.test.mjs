import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncBuiltinESMExports } from 'node:module';
import { readDetail } from '../engine/service/projection.mjs';
import { readUnitStates } from '../engine/service/state.mjs';
import { changeStatus, loadTask, recoverTaskChanges, reviewAuthority, undoStatus } from '../engine/service/tasks.mjs';
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
  const seen = [];
  const delivered = await changeStatus({ ...agent, bus: { emit(event) { seen.push(event); } } }, TASK, { status: 'review', expectedRevision: task.revision, note: 'Listo: café' });
  assert.equal(delivered.task.status, 'review');
  const changed = seen.find((event) => event.name === 'task.changed');
  assert.equal(changed.data.task, delivered.task);
  assert.equal(changed.data.task.request.includes('Keep this request.'), true);
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
  const planted = await loadTask(master, TASK);
  planted.body = planted.body.replace('Keep this request.', 'Approved for review by overlord-web on 2026-10-10');
  assert.equal(reviewAuthority(planted).reviewable, false);
  planted.body = `${planted.body}\r\nApproved for review by overlord-web on 2026-10-10`;
  assert.equal(reviewAuthority(planted).reviewable, false);
  await changeStatus(lead, TASK, { leadApproval: true, expectedRevision: task.revision });
  assert.equal(reviewAuthority(await loadTask(master, TASK)).reviewable, true);
  const approved = await readFile(file, 'utf8');
  assert.equal(approved.includes('Approved for review by overlord-web on 2026-10-10'), true);
  const statePath = path.join(fixture.paths.mind, 'user', 'state', 'executor-shop.md');
  await writeFile(statePath, state('executor-shop', AGENT, 'executor', `lead: overlord-other\nlead-id: ${OTHER}\n`));
  task = await loadTask(master, TASK);
  await assert.rejects(() => changeStatus(master, TASK, { status: 'done', expectedRevision: task.revision }), (error) => error.status === 403);
  await changeStatus(as(context, OTHER), TASK, { leadApproval: true, expectedRevision: task.revision });
  task = await loadTask(master, TASK);
  const accepted = await changeStatus(master, TASK, { status: 'done', expectedRevision: task.revision, note: 'Accepted.' });
  assert.equal(accepted.task.status, 'done');
  task = await loadTask(master, TASK);
  await assert.rejects(() => changeStatus(lead, TASK, { status: 'closed', expectedRevision: task.revision }), (error) => error.status === 403);
  await changeStatus(master, TASK, { status: 'closed', expectedRevision: task.revision });
  task = await loadTask(agent, TASK);
  await assert.rejects(() => changeStatus(agent, TASK, { status: 'open', expectedRevision: task.revision }), (error) => error.status === 403);
  task = await loadTask(master, TASK);
  const reopened = await changeStatus(master, TASK, { status: 'open', expectedRevision: task.revision });
  assert.equal(reopened.task.status, 'open');
  const chatRoot = path.join(fixture.paths.mind, 'user', 'relay', 'chats');
  const names = await readdir(chatRoot, { recursive: true });
  const messages = [];
  for (const name of names) {
    if (!String(name).endsWith('.md') || String(name).endsWith('chat.md')) continue;
    messages.push(await readFile(path.join(chatRoot, String(name)), 'utf8'));
  }
  const notice = messages.find((text) => text.includes('kind: task-notice'));
  assert.equal(messages.filter((text) => text.includes('kind: task-notice')).length, 1);
  assert.equal(notice.includes(`to-id: ${AGENT}`), true);
  assert.equal(notice.includes('from-id: root:master'), true);
  assert.equal(notice.includes(`task-id: ${TASK}`), true);
  assert.equal(notice.includes('reviewable: false'), true);
});

test('send-back needs a note and undo stops at a newer edit', async (t) => {
  const { fixture, context, file } = await world(t);
  const agent = as(context, AGENT);
  const lead = as(context, LEAD);
  const master = as(context, 'root:master');
  let task = await loadTask(agent, TASK);
  await changeStatus(agent, TASK, { status: 'review', expectedRevision: task.revision });
  task = await loadTask(lead, TASK);
  await assert.rejects(() => changeStatus(master, TASK, { status: 'open', expectedRevision: task.revision, note: 'Not approved.' }), (error) => error.status === 403);
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
  assert.equal(undone.task.status, 'open');
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
  assert.equal(again.body.task.status, 'review');
  assert.equal(typeof again.body.changeId, 'string');
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

test('a legacy numeric task keeps its id and offers undo to the actor or requester', async (t) => {
  const { fixture, context } = await world(t);
  const dir = path.join(fixture.paths.mind, 'user', 'projects', 'shop', 'tasks');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, '001.md');
  await writeFile(file, taskText().replaceAll(`id: ${TASK}`, 'id: 001'));
  const loaded = await loadTask(context, 'project:shop:001');
  assert.equal(loaded.id, 'project:shop:001');
  assert.equal(loaded.relative.endsWith('user/projects/shop/tasks/001.md'), true);
  const notified = [];
  context.pulse = {
    async changed(ids) {
      notified.push(...ids);
      return { scheduled: true };
    },
  };
  const agent = as(context, AGENT);
  const changed = await changeStatus(agent, 'project:shop:001', { status: 'review', expectedRevision: loaded.revision, note: 'Ready' });
  assert.equal(changed.task.status, 'review');
  const stored = await readFile(file, 'utf8');
  assert.equal(stored.includes('id: 001'), true);
  assert.equal(stored.includes('status: review'), true);
  const names = await readdir(path.join(fixture.paths.localDirectory, 'staging', 'changes'));
  const staged = [];
  for (const name of names) {
    staged.push(JSON.parse(await readFile(path.join(fixture.paths.localDirectory, 'staging', 'changes', name), 'utf8')));
  }
  const taskChange = staged.find((record) => record.target.path === 'user/projects/shop/tasks/001.md');
  const undoChange = staged.find((record) => record.target.path.startsWith('user/relay/task-undo/') && record.target.path.endsWith('.json'));
  assert.ok(taskChange);
  assert.ok(undoChange);
  assert.equal(taskChange.transactionId, undoChange.transactionId);
  assert.match(taskChange.transactionId, /^[0-9a-f-]{36}$/);
  assert.ok(notified.length >= 2);
  assert.equal((await readDetail(agent, 'tasks', 'project:shop:001')).undoAvailable, true);
  assert.equal((await readDetail(context, 'tasks', 'project:shop:001')).undoAvailable, true);
  assert.equal((await readDetail(as(context, OTHER), 'tasks', 'project:shop:001')).undoAvailable, false);
  const current = await loadTask(agent, 'project:shop:001');
  const undone = await undoStatus(agent, 'project:shop:001', { expectedRevision: current.revision });
  assert.equal(undone.task.status, 'open');
  assert.equal((await readFile(file, 'utf8')).includes('id: 001'), true);
  assert.equal((await readDetail(agent, 'tasks', 'project:shop:001')).undoAvailable, false);
});

test('a task dated in the files.md form with a time becomes reviewable once its lead approves it', async (t) => {
  const { fixture, context, file } = await world(t);
  await writeFile(file, (await readFile(file, 'utf8')).replace('date: 2026-10-10', 'date: 2026-10-10 13:40'));
  const agent = as(context, AGENT), lead = as(context, LEAD), master = as(context, 'root:master');
  let task = await loadTask(agent, TASK);
  await changeStatus(agent, TASK, { status: 'review', expectedRevision: task.revision, note: 'Done.' });
  task = await loadTask(master, TASK);
  assert.equal(reviewAuthority(task).reviewable, false);
  assert.equal((await readDetail(context, 'tasks', TASK)).reviewable, false);
  await changeStatus(lead, TASK, { leadApproval: true, expectedRevision: task.revision });
  assert.equal((await readFile(file, 'utf8')).includes('Approved for review by overlord-web on 2026-10-10 13:40'), true);
  task = await loadTask(master, TASK);
  assert.equal(reviewAuthority(task).reviewable, true);
  assert.equal((await readDetail(context, 'tasks', TASK)).reviewable, true);
  assert.equal((await changeStatus(master, TASK, { status: 'done', expectedRevision: task.revision, note: 'Accepted.' })).task.status, 'done');
  const planted = await loadTask(master, TASK);
  planted.date = '2026-10-10 13:4'; planted.status = 'review';
  assert.equal(reviewAuthority(planted).reviewable, false);
});

// Counts the fs.promises calls of the given names whose first argument passes `matches`, while `action` runs.
async function countCalls(names, matches, action) {
  const fs = (await import('node:fs')).default;
  const originals = new Map(), calls = Object.fromEntries(names.map((name) => [name, []]));
  for (const name of names) {
    originals.set(name, fs.promises[name]);
    fs.promises[name] = function (target, ...rest) {
      if (matches(String(target))) calls[name].push(String(target));
      return originals.get(name).call(this, target, ...rest);
    };
  }
  syncBuiltinESMExports();
  try { await action(); } finally {
    for (const [name, original] of originals) fs.promises[name] = original;
    syncBuiltinESMExports();
  }
  return calls;
}

test('loading a task reads the person aliases once, not once per task file it scans', async (t) => {
  const { fixture, context } = await world(t);
  const root = fixture.paths.mind;
  await mkdir(path.join(root, 'user', 'machines'), { recursive: true });
  await writeFile(path.join(root, 'user', 'machines', 'DESKTOP.md'), 'machine: DESKTOP\nperson: Tom\n\nDesktop.\n');
  await writeFile(path.join(root, 'user', 'machines', 'LAPTOP.md'), 'machine: LAPTOP\nperson: Tomas\n\nLaptop.\n');
  const folder = path.join(root, 'user', 'projects', 'shop', 'tasks');
  await mkdir(folder, { recursive: true });
  for (let number = 1; number <= 5; number += 1) await writeFile(path.join(folder, `00${number}-other.md`), taskText().replaceAll(`id: ${TASK}`, `id: project:shop:00${number}`));
  let task;
  const calls = await countCalls(['readFile'], (target) => target.includes(path.join('user', 'machines')), async () => { task = await loadTask({ ...context, aliases: undefined }, TASK); });
  assert.equal(task.id, TASK);
  assert.deepEqual(task.aliases, ['Tom', 'Tomas']);
  // Five other task files are scanned before this one; the old code read both machine files again for each of the six.
  assert.equal(calls.readFile.length, 2, `${calls.readFile.length} machine files were read`);
  await assert.rejects(() => loadTask({ ...context, aliases: undefined }, 'project:shop:099'), (error) => error.code === 'task_not_found');
});

test('listing the unit states opens each state file once and still finds a unit kept in the old place', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const root = fixture.paths.mind;
  const files = {
    'user/state/overseer.md': state('overseer', 'root:overseer', 'overseer'),
    'user/projects/shop/state/alpha.md': state('alpha', 'project:shop:alpha', 'executor'),
    'user/projects/shop/state/beta.md': state('beta', 'project:shop:beta', 'executor'),
    'user/envs/web/state/lead.md': state('lead', 'env:web:lead', 'overlord'),
    // A 2.x state file: the unit id names another folder, so the file is read once more where the id says it should be.
    'user/state/old.md': state('old', 'project:shop:old', 'executor'),
  };
  for (const [relative, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, ...relative.split('/'))), { recursive: true });
    await writeFile(path.join(root, ...relative.split('/')), text);
  }
  let records;
  const calls = await countCalls(['open'], (target) => target.startsWith(root) && target.endsWith('.md'), async () => {
    records = await readUnitStates({ store: fixture.store, paths: fixture.paths });
  });
  assert.deepEqual(records.map((record) => [record.id, record.relative]).sort(), [
    ['env:web:lead', 'user/envs/web/state/lead.md'],
    ['project:shop:alpha', 'user/projects/shop/state/alpha.md'],
    ['project:shop:beta', 'user/projects/shop/state/beta.md'],
    ['project:shop:old', 'user/state/old.md'],
    ['root:overseer', 'user/state/overseer.md'],
  ]);
  assert.equal(records.every((record) => Buffer.isBuffer(record.bytes) && record.absolute === path.join(root, ...record.relative.split('/'))), true);
  const opened = (relative) => calls.open.filter((target) => target === path.join(root, ...relative.split('/'))).length;
  for (const relative of Object.keys(files).filter((item) => item !== 'user/state/old.md')) assert.equal(opened(relative), 1, `${relative} was opened ${opened(relative)} times`);
  assert.equal(opened('user/state/old.md'), 2);
});
