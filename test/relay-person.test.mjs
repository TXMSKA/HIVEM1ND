import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPersonRelay } from '../engine/relay/person.mjs';
import { createRelay } from '../engine/relay/store.mjs';
import { makeRelayMind } from './relay-test-fixture.mjs';

const HOST = 'PERSONBOX';

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-person-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const mind = await makeRelayMind(root);
  await writeFile(path.join(mind, 'user', 'routes.md'), '## Environments\n- web: shop, blog\n\n## Projects\n- shop (web)\n- blog (web)\n');
  return mind;
}

async function unit(mind, project, name, { state = 'in', date = '2026-10-05 10:00' } = {}) {
  const folder = path.join(mind, 'user', 'projects', project, 'state');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, `${name}.md`), `unit: ${name}\nstate: ${state}\nmachine: ${HOST}\ndate: ${date}\n\nWorking.\n`);
}

async function wakePolicy(mind, name, policy, key = 'a') {
  const folder = path.join(mind, 'user', 'relay', 'wake', 'policies');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, `${key.repeat(64)}.json`), JSON.stringify({ enabled: true, deadlineAt: null, binding: { unit: name }, ...policy }));
}

const open = (mind, extra = {}) => createPersonRelay({ mindPath: mind, tool: 'blueprint', hostname: HOST, ...extra });

async function exists(target) {
  try { await access(target); return true; } catch { return false; }
}

test('the tool is a short lowercase name', async (context) => {
  const mind = await fixture(context);
  for (const tool of [undefined, '', 'Blueprint', '9lives', 'has space', 'a'.repeat(42), 'under_score']) {
    await assert.rejects(createPersonRelay({ mindPath: mind, tool, hostname: HOST }), TypeError, String(tool));
  }
  await open(mind);
});

test('a project with no unit in has no agent, and the chat of another project does not count', async (context) => {
  const mind = await fixture(context);
  const person = await open(mind);
  assert.equal(await person.agentFor('shop'), null);
  await unit(mind, 'shop', 'executor-shop', { state: 'out' });
  await unit(mind, 'blog', 'executor-blog');
  assert.equal(await person.agentFor('shop'), null, 'a unit that is out is not an agent');
  assert.deepEqual(await person.agentFor('blog'), { unit: 'executor-blog', awake: false });
  assert.equal(await person.agentFor('nowhere'), null);
});

test('the executor of the project is the agent, then the unit that was in most recently', async (context) => {
  const mind = await fixture(context);
  const person = await open(mind);
  await unit(mind, 'shop', 'reviewer-shop', { date: '2026-10-08 09:00' });
  assert.equal((await person.agentFor('shop')).unit, 'reviewer-shop');
  await unit(mind, 'shop', 'executor-shop', { date: '2026-10-01 09:00' });
  assert.equal((await person.agentFor('shop')).unit, 'executor-shop', 'an executor wins over a more recent unit');
  await unit(mind, 'shop', 'executor-shop-2', { date: '2026-10-07 09:00' });
  assert.equal((await person.agentFor('shop')).unit, 'executor-shop-2', 'between executors the newest wins');
});

test('the wake is on only for a policy that is enabled, not paused and not past its deadline', async (context) => {
  const mind = await fixture(context);
  const now = Date.parse('2026-10-09T12:00:00Z');
  const person = await open(mind, { clock: () => now });
  await unit(mind, 'shop', 'executor-shop');
  assert.equal((await person.agentFor('shop')).awake, false, 'no policy at all');

  await wakePolicy(mind, 'executor-shop', { enabled: false });
  assert.equal((await person.agentFor('shop')).awake, false, 'disabled');
  await wakePolicy(mind, 'executor-shop', { pausedReason: 'handoff-budget-exhausted' });
  assert.equal((await person.agentFor('shop')).awake, false, 'paused');
  await wakePolicy(mind, 'executor-shop', { deadlineAt: '2026-10-09T11:59:59Z' });
  assert.equal((await person.agentFor('shop')).awake, false, 'past its deadline');
  await wakePolicy(mind, 'executor-shop', { binding: { unit: 'executor-other' } });
  assert.equal((await person.agentFor('shop')).awake, false, 'a policy of another unit');

  await writeFile(path.join(mind, 'user', 'relay', 'wake', 'policies', `${'b'.repeat(64)}.json`), '{ not json');
  await writeFile(path.join(mind, 'user', 'relay', 'wake', 'policies', 'not-a-policy.json'), JSON.stringify({ enabled: true, deadlineAt: null, binding: { unit: 'executor-shop' } }));
  assert.equal((await person.agentFor('shop')).awake, false, 'a policy that cannot be read, or is not named like one, is skipped');

  await wakePolicy(mind, 'Executor-Shop', { deadlineAt: '2026-10-09T13:00:00Z' });
  assert.equal((await person.agentFor('shop')).awake, true, 'enabled, in time, and the unit name compared without case');
  await wakePolicy(mind, 'executor-shop', { deadlineAt: null }, 'c');
  assert.equal((await person.agentFor('shop')).awake, true, 'no deadline');
});

test('opening the tool writes nothing, and with no agent a send says so and still writes nothing', async (context) => {
  const mind = await fixture(context);
  const before = await readdir(path.join(mind, 'user'));
  const person = await open(mind);
  await person.agentFor('shop');
  assert.deepEqual(await readdir(path.join(mind, 'user')), before);
  assert.deepEqual(await person.send({ project: 'shop', subject: 'Hello', body: 'Anyone?' }), { sent: false, reason: 'no-agent' });
  assert.equal(await exists(path.join(mind, 'user', 'relay', 'sessions')), false, 'a send that found no agent registers nothing');
  assert.deepEqual(await readdir(path.join(mind, 'user')), before);
});

test('a send arrives from the unit user, registers once, and keeps the subject to one line', async (context) => {
  const mind = await fixture(context);
  await unit(mind, 'shop', 'executor-shop');
  const person = await open(mind);

  const first = await person.send({ project: 'shop', subject: `A comment\non a ${'long '.repeat(80)}line\u0007`, body: 'Line one.\nLine two.', attachments: ['C:\\repo\\docs\\flows\\comments\\checkout.json'] });
  assert.equal(first.sent, true);
  assert.equal(first.to, 'executor-shop');
  assert.match(first.id, /^[0-9a-f-]{36}$/);
  const second = await person.send({ project: 'shop', subject: '   ', body: 'Again' });
  assert.equal(second.sent, true);

  const reader = await createRelay({ mindPath: mind, hostname: HOST, sessionId: 'reader', client: 'test' });
  const { messages } = await reader.read({ unit: 'executor-shop' });
  assert.equal(messages.length, 2);
  const byId = new Map(messages.map((message) => [message.id, message]));
  const one = byId.get(first.id);
  assert.equal(one.from, 'user');
  assert.equal(one.to, 'executor-shop');
  assert.equal(one.priority, 'normal');
  assert.equal(one.body, 'Line one.\nLine two.');
  assert.deepEqual(one.attachments, ['C:\\repo\\docs\\flows\\comments\\checkout.json']);
  assert.ok(one.subject.startsWith('A comment on a long long'), one.subject);
  assert.ok(one.subject.length <= 240 && !/[\u0000-\u001f]/.test(one.subject));
  assert.equal(byId.get(second.id).subject, 'Message from the person', 'an empty subject gets a plain one');

  const sessions = await readdir(path.join(mind, 'user', 'relay', 'sessions'));
  assert.equal(sessions.length, 1, 'two sends are one registration');
  const status = await reader.status({ unit: 'user' });
  const [registration] = status.units.flatMap((item) => item.registeredSessions);
  assert.equal(registration.unit, 'user');
  assert.equal(registration.client, 'user');
  assert.equal(registration.nativeSessionId, `blueprint-${HOST}`);
});

test('a send to a project is not a send to the whole mind', async (context) => {
  const mind = await fixture(context);
  await unit(mind, 'shop', 'executor-shop');
  await unit(mind, 'blog', 'executor-blog');
  const person = await open(mind);
  assert.equal((await person.send({ project: 'blog', subject: 'For blog', body: 'x' })).to, 'executor-blog');
  const reader = await createRelay({ mindPath: mind, hostname: HOST, sessionId: 'reader', client: 'test' });
  assert.equal((await reader.inbox({ unit: 'executor-shop' })).unread, 0);
  assert.equal((await reader.inbox({ unit: 'executor-blog' })).unread, 1);
});

test('two tools of one person use sessions of their own', async (context) => {
  const mind = await fixture(context);
  await unit(mind, 'shop', 'executor-shop');
  const blueprint = await open(mind);
  const void_ = await open(mind, { tool: 'void' });
  await blueprint.send({ project: 'shop', subject: 'From Blueprint', body: 'x' });
  await void_.send({ project: 'shop', subject: 'From Void', body: 'y' });
  const sessions = await readdir(path.join(mind, 'user', 'relay', 'sessions'));
  assert.equal(sessions.length, 2);
  const reader = await createRelay({ mindPath: mind, hostname: HOST, sessionId: 'reader', client: 'test' });
  assert.deepEqual((await reader.read({ unit: 'executor-shop' })).messages.map((message) => message.subject).sort(), ['From Blueprint', 'From Void']);
});
