import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChat, deliverNotifications, patchChat, postChat, postMailbox, queueNotice, readChat, readMailbox, recoverMailboxReads, recoverNotifications } from '../engine/service/chats.mjs';
import { composeCore } from '../engine/service/service.mjs';
import { openLedger } from '../engine/sync/limits.mjs';
import { recoverTransactions } from '../engine/service/store.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

function state(unit, id, role) {
  return `unit: ${unit}\nunit-id: ${id}\nrole: ${role}\nstate: in\nmachine: DESKTOP\n\nReady.\n`;
}

async function world(t) {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const root = fixture.paths.mind;
  await mkdir(path.join(root, 'user', 'state'), { recursive: true });
  await writeFile(path.join(root, 'user', 'state', 'executor-shop.md'), state('executor-shop', 'project:shop:executor-shop', 'executor'));
  await writeFile(path.join(root, 'user', 'state', 'overlord-web.md'), state('overlord-web', 'env:web:overlord-web', 'overlord'));
  const ledger = openLedger({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, machine: fixture.machine });
  const context = {
    store: fixture.store,
    paths: fixture.paths,
    now: () => fixture.clock.now,
    ledger,
    principal: { stableId: 'desktop', audience: 'desktop', unitId: 'root:master' },
  };
  return { fixture, context };
}

test('direct chats are reused, groups stay bounded, and history survives unlist', async (t) => {
  const { context, fixture } = await world(t);
  const first = await createChat(context, { members: ['project:shop:executor-shop'] });
  assert.equal(first.chat.lastMessage, null);
  assert.equal(first.chat.unread, 0);
  const second = await createChat(context, { members: ['project:shop:executor-shop'] });
  assert.equal(second.created, false);
  assert.equal(second.chat.id, first.chat.id);
  const group = await createChat(context, { members: ['project:shop:executor-shop', 'env:web:overlord-web'], title: 'Release' });
  assert.equal(group.created, true);
  assert.notEqual(group.chat.id, first.chat.id);
  const tooMany = Array.from({ length: 257 }, (_item, index) => `project:shop:unit-${index}`);
  await assert.rejects(() => createChat(context, { members: tooMany }), (error) => error.code === 'invalid_members');
  const posted = await postChat(context, first.chat.id, { body: 'Hello', subject: 'Ping' });
  assert.equal(posted.message.fromId, 'root:master');
  const afterPost = await createChat(context, { members: ['project:shop:executor-shop'] });
  assert.equal(afterPost.chat.lastMessage.id, posted.message.id);
  assert.equal(afterPost.chat.unread, 1);
  await patchChat(context, first.chat.id, { listed: false, pinned: true, expectedRevision: (await createChat(context, { members: ['project:shop:executor-shop'] })).chat.revision });
  const messagePath = path.join(fixture.paths.mind, 'user', 'relay', 'chats', first.chat.id, `${posted.message.id}.md`);
  assert.equal((await readFile(messagePath, 'utf8')).includes('Hello'), true);
  const chat = await readFile(path.join(fixture.paths.mind, 'user', 'relay', 'chats', first.chat.id, 'chat.md'), 'utf8');
  assert.equal(chat.includes('listed: false'), true);
  assert.equal(chat.includes('pinned: true'), true);
  const reopened = await createChat(context, { members: ['project:shop:executor-shop'] });
  assert.equal(reopened.chat.listed, true);
  await assert.rejects(() => patchChat(context, first.chat.id, { pinned: 'yes', expectedRevision: reopened.chat.revision }), { code: 'invalid_body' });
});

test('posts keep the credential author, reject cross-chat replies, and cap complete bytes', async (t) => {
  const { context, fixture } = await world(t);
  const chat = await createChat(context, { members: ['project:shop:executor-shop'] });
  const other = await createChat(context, { members: ['env:web:overlord-web'] });
  const subjectOnly = await postChat(context, chat.chat.id, { body: '', subject: 'Subject only' });
  assert.equal(subjectOnly.message.body, '');
  const attached = await postMailbox(context, 'project:shop:executor-shop', { body: '', attachments: [{ path: 'user/projects/shop/tasks/029.md', kind: 'task' }] });
  assert.equal(attached.message.attachments[0].path, 'user/projects/shop/tasks/029.md');
  await assert.rejects(() => postMailbox(context, 'project:shop:missing-unit', { body: 'No' }), { code: 'unknown_unit' });
  await assert.rejects(() => postChat(context, chat.chat.id, { body: 'Hi', subject: 'Bad\nfrom-id: root:builder' }), { code: 'invalid_body' });
  await assert.rejects(() => postChat(context, chat.chat.id, { body: 'Hi', priority: 'high' }), { code: 'invalid_body' });
  await assert.rejects(() => postChat(context, chat.chat.id, { subject: 's'.repeat(241) }), { code: 'invalid_body' });
  const wide = await postChat(context, chat.chat.id, { body: 'a'.repeat(100001) });
  assert.equal(wide.message.body.length, 100001);
  const savedWide = await readFile(path.join(fixture.paths.mind, 'user', 'relay', 'chats', chat.chat.id, `${wide.message.id}.md`), 'utf8');
  assert.equal(savedWide.includes('to: chat'), true);
  const forged = await postChat(context, chat.chat.id, { body: 'Mine', fromId: 'project:shop:executor-shop' });
  const saved = await readFile(path.join(fixture.paths.mind, 'user', 'relay', 'chats', chat.chat.id, `${forged.message.id}.md`), 'utf8');
  assert.equal(saved.includes('from-id: root:master'), true);
  assert.equal(saved.includes('from-id: project:shop:executor-shop'), false);
  const foreign = await postChat(context, other.chat.id, { body: 'Elsewhere' });
  await assert.rejects(() => postChat(context, chat.chat.id, { body: 'Nope', replyTo: foreign.message.id }), (error) => error.code === 'invalid_reply');
  const names = await readdir(path.join(fixture.paths.mind, 'user', 'relay', 'chats', chat.chat.id));
  assert.equal(names.includes(`${foreign.message.id}.md`), false);
  await assert.rejects(() => postChat(context, chat.chat.id, { body: 'é'.repeat(500000) }), (error) => error.code === 'message_too_large');
  const inbox = path.join(fixture.paths.mind, 'user', 'projects', 'shop', 'inbox', 'executor-shop');
  assert.equal((await readdir(inbox)).length, 1);
});

test('fanout is restart-safe and a chat read leaves a late message unread', async (t) => {
  const { context, fixture } = await world(t);
  const chat = await createChat(context, { members: ['project:shop:executor-shop', 'env:web:overlord-web'] });
  const early = await postChat(context, chat.chat.id, { body: 'Early' });
  fixture.clock.now += 1000;
  const later = await postChat(context, chat.chat.id, { body: 'Later' });
  const notices = JSON.parse(await readFile(path.join(fixture.paths.mind, 'user', 'relay', 'fanout', `${later.message.id}.json`), 'utf8'));
  assert.equal(notices.notices.length, 2);
  assert.equal(notices.notices.some((item) => item.unitId === 'root:master'), false);
  const again = await queueNotice(context, { messageId: later.message.id, unitId: 'project:shop:executor-shop', state: 'pending' });
  assert.equal(again.key, `${later.message.id}:project:shop:executor-shop`);
  assert.equal((await recoverNotifications(context)).some((item) => item.key === again.key), true);
  await queueNotice(context, { messageId: later.message.id, unitId: 'root:master', state: 'ambiguous' });
  const pending = await recoverNotifications(context);
  assert.equal(pending.some((item) => item.state === 'ambiguous'), false);
  const read = await readChat(context, chat.chat.id, { messageIds: [later.message.id] });
  assert.deepEqual(read.readIds, [later.message.id]);
  assert.equal(read.unread, 1);
  assert.equal(early.message.id === later.message.id, false);
  const quiet = await deliverNotifications(context);
  assert.equal(quiet.some((item) => item.state === 'submitted'), false);
  assert.equal(quiet.some((item) => item.error === 'transport_unavailable'), true);
  let calls = 0;
  context.wake = { notify: async () => { calls += 1; return { state: 'submitted' }; } };
  const sent = await deliverNotifications(context);
  assert.equal(sent.filter((item) => item.state === 'submitted').length > 0, true);
  const submitted = calls;
  await deliverNotifications(context);
  assert.equal(calls, submitted);
});

test('mailbox reads are atomic, collide on different bytes, and resume after a crash', async (t) => {
  const { context, fixture } = await world(t);
  const first = await postMailbox(context, 'root:master', { body: 'One', subject: 'A' });
  fixture.clock.now += 1000;
  const second = await postMailbox(context, 'root:master', { body: 'Two', subject: 'B' });
  const inbox = path.join(fixture.paths.mind, 'user', 'inbox', 'master');
  await assert.rejects(() => readMailbox(context, 'root:master', { messageIds: [first.message.id, 'missing'] }), (error) => error.code === 'message_not_found');
  assert.equal((await readdir(inbox)).length, 2);
  const agent = { ...context, principal: { stableId: 'agent', audience: 'agent', unitId: 'project:shop:executor-shop' } };
  await assert.rejects(() => readMailbox(agent, 'root:master', { messageIds: [first.message.id] }), (error) => error.status === 403);
  const name = (await readdir(inbox)).find((item) => item.includes(first.message.id));
  const archive = path.join(fixture.paths.mind, 'user', 'relay', 'archive', 'by-unit', Buffer.from('root:master').toString('base64url'), name);
  await mkdir(path.dirname(archive), { recursive: true });
  await writeFile(archive, 'different');
  await assert.rejects(() => readMailbox(context, 'root:master', { messageIds: [first.message.id] }), (error) => error.code === 'archive_collision');
  assert.equal((await readdir(inbox)).length, 2);
  await unlinkSafe(archive);
  fixture.store.fault = { afterRenames: 1 };
  await assert.rejects(() => readMailbox(context, 'root:master', { messageIds: [first.message.id, second.message.id] }), (error) => error.code === 'injected_crash');
  await recoverTransactions(fixture.store);
  await recoverMailboxReads(context);
  const left = await readdir(inbox).catch(() => []);
  assert.equal(left.length, 0);
  const archived = await readdir(path.dirname(archive));
  assert.equal(archived.length, 2);
});

test('concurrent mailbox posts return only created or limited results and replay the same key', async (t) => {
  const fixture = await makeCoreFixture();
  const origin = path.join(fixture.root, 'origin');
  await mkdir(origin, { recursive: true });
  const core = await composeCore({
    store: fixture.store,
    paths: { ...fixture.paths, origin },
    now: () => fixture.clock.now,
  });
  t.after(async () => {
    await core.http.close();
    await dispose(fixture);
  });
  const local = await httpCall(core.http.port, 'POST', '/api/v1/auth/local', {
    token: core.bootstrap.secret,
    body: { embedded: false, hostOrigin: null, look: null, language: null },
  });
  assert.equal(local.status, 201);
  const token = local.json.data.token;
  const keys = Array.from({ length: 30 }, () => randomUUID());
  const responses = await Promise.all(keys.map((key, index) => httpCall(core.http.port, 'POST', '/api/v1/mailboxes/root:master/messages', {
    token,
    body: { body: `burst ${index}`, subject: 'Burst' },
    headers: { 'idempotency-key': key, 'x-request-id': key },
  })));
  const bad = responses.filter((item) => item.status !== 201 && item.status !== 429);
  assert.deepEqual(bad.map((item) => ({ status: item.status, body: item.json, diagnostics: core.http.security.diagnostics })), []);
  for (const item of responses) {
    if (item.status === 429) {
      assert.equal(item.json.error.code, 'message_rate_limited');
      assert.equal(typeof item.headers['retry-after'], 'string');
      assert.equal(item.json.error.details.phase, 'admission');
      assert.equal(item.json.error.details.limits.messages.max, 60);
      assert.equal(typeof item.json.error.details.limits.messages.used, 'number');
      assert.equal(item.json.error.details.limits.messageBytes.max, 1000000);
      assert.equal(item.json.error.details.limits.syncBytes.max, 50000000);
    } else {
      assert.equal(item.json.data.subject, 'Burst');
      assert.equal(item.json.meta.replayed, false);
    }
  }
  const created = responses.find((item) => item.status === 201);
  const replay = await httpCall(core.http.port, 'POST', '/api/v1/mailboxes/root:master/messages', {
    token,
    body: { body: created.json.data.body, subject: 'Burst' },
    headers: { 'idempotency-key': created.json.meta.requestId, 'x-request-id': randomUUID() },
  });
  assert.equal(replay.status, 201);
  assert.equal(replay.json.meta.replayed, true);
  assert.equal(replay.json.data.id, created.json.data.id);
});

test('a partial mailbox commit replays the same message for the same key', async (t) => {
  const fixture = await makeCoreFixture();
  const origin = path.join(fixture.root, 'origin');
  await mkdir(origin, { recursive: true });
  const core = await composeCore({
    store: fixture.store,
    paths: { ...fixture.paths, origin },
    now: () => fixture.clock.now,
  });
  t.after(async () => {
    await core.http.close();
    await dispose(fixture);
  });
  const local = await httpCall(core.http.port, 'POST', '/api/v1/auth/local', {
    token: core.bootstrap.secret,
    body: { embedded: false, hostOrigin: null, look: null, language: null },
  });
  assert.equal(local.status, 201);
  const token = local.json.data.token;
  const key = randomUUID();
  const body = { body: 'partial', subject: 'Once' };
  fixture.store.fault = { afterRenames: 1 };
  const failed = await httpCall(core.http.port, 'POST', '/api/v1/mailboxes/root:master/messages', {
    token,
    body,
    headers: { 'idempotency-key': key, 'x-request-id': randomUUID() },
  });
  assert.equal(failed.status, 500);
  assert.equal(failed.json.error.code, 'injected_crash');
  const replay = await httpCall(core.http.port, 'POST', '/api/v1/mailboxes/root:master/messages', {
    token,
    body,
    headers: { 'idempotency-key': key, 'x-request-id': randomUUID() },
  });
  assert.equal(replay.status, 201);
  assert.equal(replay.json.meta.replayed, true);
  assert.equal(replay.json.data.subject, 'Once');
  const inbox = path.join(fixture.paths.mind, 'user', 'inbox', 'master');
  const names = (await readdir(inbox)).filter((name) => name.endsWith('.md'));
  assert.equal(names.length, 1);
  assert.equal(names[0].includes(replay.json.data.id), true);
});

function httpCall(port, method, target, { token = null, body = undefined, headers = {} } = {}) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      method,
      path: target,
      headers: {
        host: `127.0.0.1:${port}`,
        origin: `http://127.0.0.1:${port}`,
        ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        if (raw.length > 0 && String(res.headers['content-type'] ?? '').includes('json')) json = JSON.parse(raw);
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

async function unlinkSafe(file) {
  const { unlink } = await import('node:fs/promises');
  await unlink(file);
}
