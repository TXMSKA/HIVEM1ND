import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createPersonRelay } from '../engine/relay/person.mjs';
import { listAppAgents, sendAppAgent } from '../engine/service/app-agents.mjs';
import { createEventBus } from '../engine/service/events.mjs';
import { openLedger } from '../engine/sync/limits.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

async function fixture(t) {
  const fixture = await makeCoreFixture({ platform: process.platform });
  t.after(() => dispose(fixture));
  const localPath = path.join(fixture.root, 'shop');
  const flows = path.join(localPath, 'docs', 'flows');
  await mkdir(path.join(flows, 'boards'), { recursive: true });
  await writeFile(path.join(flows, 'boards', 'checkout.json'), '{"format":4,"threads":[]}\n');
  const context = { store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now,
    projects: [{ name: 'shop', localPath }, { name: 'blocked', localPath: fixture.root, eligible: false }],
    bus: createEventBus({ now: () => fixture.clock.now }),
    ledger: openLedger({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, machine: fixture.paths.machine }) };
  const unit = async (name, { project = 'shop', state = 'in', date = '2026-10-09 12:00', alias = '' } = {}) => {
    const file = path.join(fixture.paths.mind, 'user', 'projects', project, 'state', `${name}.md`);
    await mkdir(path.dirname(file), { recursive: true });
    const id = `project:${project}:${name}`;
    await writeFile(file, `unit: ${name}\nunit-id: ${id}\nrole: ${name.startsWith('executor') ? 'executor' : 'helper'}\nscope: project:${project}\nstate: ${state}\nmachine: ${fixture.paths.machine}\ndate: ${date}\nalias: ${alias}\n\nTesting.\n`);
    return id;
  };
  return { ...fixture, context, localPath, flows, unit };
}

test('the person relay lists every active project agent with canonical IDs, executor first, and keeps its original agentFor shape', async () => {
  const calls = [];
  const relay = await createPersonRelay({ mindPath: process.cwd(), tool: 'embedded-app', hostname: 'TEST', operations: {
    async status() { return { units: [
      { id: 'project:shop:helper', unit: 'helper', scope: 'project:shop', state: 'in', date: '2026-10-10', alias: 'Reviewer' },
      { id: 'project:shop:executor', unit: 'executor', role: 'executor', scope: 'project:shop', state: 'in', date: '2026-10-01' },
      { id: 'project:shop:asleep', unit: 'asleep', scope: 'project:shop', state: 'out' },
      { id: 'project:other:executor', unit: 'executor', scope: 'project:other', state: 'in' },
    ] }; },
    async awake(id) { return id === 'project:shop:helper'; },
    async register(input) { calls.push(input); },
    async send(input) { calls.push(input); return { id: 'message-id' }; },
  } });
  assert.deepEqual(await relay.listFor('shop'), [
    { id: 'project:shop:executor', unit: 'executor', name: 'executor', awake: false },
    { id: 'project:shop:helper', unit: 'helper', name: 'Reviewer', awake: true },
  ]);
  assert.deepEqual(await relay.agentFor('shop'), { unit: 'executor', awake: false });
  const requestId = randomUUID();
  assert.deepEqual(await relay.send({ project: 'shop', to: 'project:shop:helper', requestId, body: 'Review this.' }), { sent: true, to: 'helper', id: 'message-id' });
  assert.equal(calls[0].unit, 'master');
  assert.equal(calls[1].to, 'project:shop:helper');
  assert.equal(calls[1].requestId, requestId);
});

test('agents.list resolves only attached locations and shares executor-first selection with the person relay', async (t) => {
  const { context, localPath, flows, unit } = await fixture(t);
  await unit('helper-shop', { alias: 'Reviewer' });
  await unit('executor-shop', { date: '2026-10-01 12:00' });
  await unit('executor-away', { state: 'out' });
  await unit('executor-other', { project: 'other' });
  for (const location of ['shop', localPath, flows]) {
    assert.deepEqual(await listAppAgents(context, { location }), [
      { unit: 'executor-shop', name: 'executor-shop', awake: false },
      { unit: 'helper-shop', name: 'Reviewer', awake: false },
    ]);
  }
  for (const location of ['other', 'blocked', path.dirname(localPath)]) await assert.rejects(listAppAgents(context, { location }), { code: 'denied' });
  await assert.rejects(listAppAgents(context, { location: null }), { code: 'invalid' });
  await assert.rejects(listAppAgents(context, null), { code: 'invalid' });
  await assert.rejects(sendAppAgent(context, null), { code: 'invalid' });
});

test('agents.send writes a real master message and the editor fanout with canonical recipients, and retries once', async (t) => {
  const { context, paths, flows, unit } = await fixture(t);
  const id = await unit('executor-shop');
  await unit('helper-shop');
  const delivered = [];
  context.wake = { async notify(notice) { delivered.push(notice); return { state: 'submitted' }; } };
  const request = { ...context, receipt: { key: randomUUID(), principalHash: 'person' } };
  const input = { location: flows, kind: 'comment', document: 'checkout', threadId: 'thread-1', subject: 'Checkout comment', body: 'Review the button.' };
  const sent = await sendAppAgent(request, input);
  assert.equal(sent.sent, true);
  assert.equal(sent.unit, 'executor-shop');
  const inbox = path.join(paths.mind, 'user', 'projects', 'shop', 'inbox', 'executor-shop');
  const files = await readdir(inbox);
  assert.equal(files.length, 1);
  const message = await readFile(path.join(inbox, files[0]), 'utf8');
  assert.match(message, /^from: master$/m);
  assert.match(message, /^from-id: root:master$/m);
  assert.match(message, /^to-id: project:shop:executor-shop$/m);
  assert.match(message, /Document: docs\/flows\/boards\/checkout\.json/);
  assert.match(message, /Thread: thread-1/);
  assert.match(message, /Review the button\./);
  const fanout = JSON.parse(await readFile(path.join(paths.mind, 'user', 'relay', 'fanout', `${sent.id}.json`), 'utf8'));
  assert.equal(fanout.messageId, sent.id);
  assert.equal(fanout.notices.length, 1);
  assert.equal(fanout.notices[0].unitId, id);
  assert.equal(fanout.notices[0].state, 'submitted');
  assert.equal(delivered[0].unitId, id);
  assert.deepEqual(await sendAppAgent(request, input), sent);
  assert.equal((await readdir(inbox)).length, 1);
  assert.equal(delivered.length, 1);
  await assert.rejects(sendAppAgent(request, { ...input, body: 'Changed.' }), { code: 'conflict' });
  const attachment = path.join(flows, 'notes.txt');
  await writeFile(attachment, 'Notes.');
  const helper = await sendAppAgent(context, { ...input, to: 'helper-shop', attachment: { path: 'notes.txt' } });
  assert.equal(helper.unit, 'helper-shop');
  const helperFanout = JSON.parse(await readFile(path.join(paths.mind, 'user', 'relay', 'fanout', `${helper.id}.json`), 'utf8'));
  assert.equal(helperFanout.notices[0].unitId, 'project:shop:helper-shop');
  assert.equal(delivered[1].unitId, 'project:shop:helper-shop');
  const helperInbox = path.join(paths.mind, 'user', 'projects', 'shop', 'inbox', 'helper-shop');
  const helperMessage = await readFile(path.join(helperInbox, (await readdir(helperInbox))[0]), 'utf8');
  const attachmentHeader = JSON.parse(helperMessage.split('\n').find((line) => line.startsWith('attachments: ')).slice('attachments: '.length));
  assert.equal(attachmentHeader[1].path, attachment);
});

test('agents.send confines documents, attachments, links and destinations before sending, with body-free errors', async (t) => {
  const { context, root, localPath, flows, unit, paths } = await fixture(t);
  await unit('executor-shop');
  const outside = path.join(root, 'private.txt');
  await writeFile(outside, 'Private.');
  const linked = path.join(localPath, 'linked');
  await symlink(root, linked, process.platform === 'win32' ? 'junction' : 'dir');
  const input = { location: flows, kind: 'comment', document: 'checkout', body: 'SECRET-BODY' };
  for (const [patch, code] of [
    [{ document: '../private.txt' }, 'denied'],
    [{ document: outside }, 'denied'],
    [{ attachment: outside }, 'denied'],
    [{ document: 'linked/private.txt' }, 'denied'],
    [{ document: 'missing.json' }, 'not_found'],
    [{ to: 'project:other:executor-other' }, 'denied'],
    [{ kind: 'unknown' }, 'invalid'],
    [{ threadId: 'thread\nforged' }, 'invalid'],
    [{ body: 'x'.repeat(256 * 1024 + 1) }, 'invalid'],
  ]) {
    await assert.rejects(sendAppAgent(context, { ...input, ...patch }), (error) => {
      assert.equal(error.code, code);
      assert.ok(!error.message.includes('SECRET-BODY'));
      return true;
    });
  }
  await assert.rejects(readdir(path.join(paths.mind, 'user', 'relay', 'fanout')), { code: 'ENOENT' });
});

test('agents.send reports no_agent when every project unit is out', async (t) => {
  const { context, flows, unit } = await fixture(t);
  await unit('executor-shop', { state: 'out' });
  assert.deepEqual(await listAppAgents(context, { location: 'shop' }), []);
  await assert.rejects(sendAppAgent(context, { location: flows, kind: 'board', document: { path: 'boards/checkout.json' } }), { code: 'no_agent' });
});

test('agents.send bounds message bytes and shares six sends per project per minute across callers', async t => {
  const { context, flows, unit, clock } = await fixture(t);
  await unit('executor-shop');
  const input = { location: flows, kind: 'comment', document: 'checkout', body: 'Review.' };
  await assert.rejects(sendAppAgent(context, { ...input, body: 'é'.repeat(8193) }), { code: 'invalid' });
  await assert.rejects(sendAppAgent(context, { ...input, unused: 'x'.repeat(32769) }), { code: 'invalid' });
  for (let index = 0; index < 6; index++) await sendAppAgent({ ...context, principal: { unitId: `caller-${index}` } }, input);
  await assert.rejects(sendAppAgent(context, input), { code: 'unavailable' });
  clock.now += 60000;
  assert.equal((await sendAppAgent(context, input)).sent, true);
});

test('agents.send throttles the seventh valid delivery to a project', async t => {
  const { context, flows, unit } = await fixture(t);
  await unit('executor-shop');
  const input = { location: flows, kind: 'comment', document: 'checkout' };
  for (let index = 0; index < 6; index++) await sendAppAgent(context, input);
  await assert.rejects(sendAppAgent(context, input), { code: 'unavailable' });
});
