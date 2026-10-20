import { randomUUID } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeCore } from '../engine/service/service.mjs';
import { uuidV8 } from '../engine/service/identity.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

test('an agent reads the inbox copy of a chat message through the service and the chat gets its receipt', async (t) => {
  const fixture = await makeCoreFixture();
  const sessionId = uuidV8(['session', fixture.machine, 'cursor', 'native-one', 'root:one']);
  const registrationId = randomUUID();
  const chatId = randomUUID(), messageId = randomUUID(), copyId = randomUUID();
  const user = path.join(fixture.paths.mind, 'user');
  await mkdir(path.join(user, 'state'), { recursive: true });
  await writeFile(path.join(user, 'state', 'one.md'), 'unit: one\nunit-id: root:one\nstate: in\nmachine: DESKTOP\n\nReady.\n');
  const chat = path.join(user, 'relay', 'chats', chatId);
  await mkdir(chat, { recursive: true });
  await writeFile(path.join(chat, 'chat.md'), `id: ${chatId}\ntitle: one\nkind: direct\nmembers: ["root:master","root:one"]\ncreated: 2026-10-11T12:00:00.000Z\n\n`);
  await writeFile(path.join(chat, `${messageId}.md`), `id: ${messageId}\nfrom: master\nfrom-id: root:master\nto: chat:${chatId}\nto-id: chat:${chatId}\nmachine: DESKTOP\ntimestamp: 2026-10-11T12:00:00.000Z\npriority: normal\nsubject: \nthread-id: ${chatId}\nreply-to: \nreply-requested: false\nattachments: []\nkind: message\nrecipient-ids: ["root:one"]\n\nHello one.\n`);
  await mkdir(path.join(user, 'inbox', 'one'), { recursive: true });
  await writeFile(path.join(user, 'inbox', 'one', `20261011-120000-DESKTOP-${copyId}.md`), `id: ${copyId}\nfrom: master\nto: one\nmachine: DESKTOP\ntimestamp: 2026-10-11T12:00:00.000Z\nsubject: Chat: one\nthread-id: chat-${chatId}\nkind: chat-copy\nchat-id: ${chatId}\nchat-message-id: ${messageId}\nreply-requested: true\n\nHello one.\n`);
  await mkdir(path.join(user, 'relay', 'sessions'), { recursive: true });
  await writeFile(path.join(user, 'relay', 'sessions', `${registrationId}.json`), `${JSON.stringify({
    kind: 'registration', registrationId, instanceId: `service-${fixture.machine}`, sessionId, unit: 'one', unitId: 'root:one', scopeId: 'root',
    nativeSessionId: 'native-one', client: 'cursor', machine: fixture.machine, registeredAt: '2026-10-11T12:00:00.000Z',
    activity: 'idle', activityObservedAt: '2026-10-11T12:00:00.000Z', quota: null, quotaObservedAt: null,
  })}\n`);
  await mkdir(path.join(fixture.paths.localDirectory, 'session-starts'), { recursive: true });
  await writeFile(path.join(fixture.paths.localDirectory, 'session-starts', `${randomUUID()}.json`), `${JSON.stringify({ sessionId, pid: 4242 })}\n`);
  const core = await composeCore({
    store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, projects: [], ownedPids: new Set([4242]),
    adapters: { cursor: { confirm: (proof) => proof.unitId === 'root:one' && proof.nativeSessionId === 'native-one' } },
  });
  t.after(async () => { await core.http.close(); await dispose(fixture); });
  const token = core.credentials.issue({ audience: 'agent', unitId: 'root:one', sessionId, attached: true, capabilities: ['own'] }).token;
  const started = Date.now();
  const read = await call(core.http.port, token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_inbox', arguments: {} } });
  assert.ok(Date.now() - started < 3000, `the read took ${Date.now() - started} ms`);
  assert.equal(read.json.result.isError, false, JSON.stringify(read.json));
  const receipts = await readdir(path.join(chat, 'read'), { recursive: true });
  assert.equal(receipts.some((name) => String(name).endsWith('.json')), true);
});

function call(port, token, body) {
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/mcp', headers: {
      host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json', 'content-length': String(payload.length),
      authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream',
    } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, json: text && String(res.headers['content-type'] ?? '').includes('json') ? JSON.parse(text) : null });
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timed out')));
    req.end(payload);
  });
}
