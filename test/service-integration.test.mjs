import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { PassThrough } from 'node:stream';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addScreen, newSketch } from '../features/blueprint/review/sketch-format.mjs';
import { createNativeAdapter, probeClients } from '../engine/service/adapters.mjs';
import { exchange, openHome } from '../engine/service/home.mjs';
import { hashBytes, uuidV8 } from '../engine/service/identity.mjs';
import { createCredentialStore } from '../engine/service/security.mjs';
import { servicePaths } from '../engine/service/paths.mjs';
import { routeTable } from '../engine/service/http.mjs';
import { createStore, recoverTransactions } from '../engine/service/store.mjs';
import { composeCore, startService, stopService, writeBeat } from '../engine/service/service.mjs';
import { serveRelayMcp } from '../engine/relay/mcp.mjs';
import { applyPack } from '../engine/sync/apply.mjs';
import { limitsFor, openLedger, reservePublication } from '../engine/sync/limits.mjs';
import { openOrigin, publishPack } from '../engine/sync/origin.mjs';
import { encodePack } from '../engine/sync/pack.mjs';
import { clearSyncFailure, openSync, recordSyncFailure } from '../engine/sync/store.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';
import { makeRelayMind } from './relay-test-fixture.mjs';
import { finalAdditionArchive, finalLookCaptures, finalVerificationCases } from './gui-data.mjs';
import { createFinalCoreFixture as openFinalCoreFixture } from './gui-fixture.mjs';
import { legacyTreeInventory } from '../engine/legacy-copy.mjs';
import { callPlanTool, drainRunLaunches } from '../engine/service/runs.mjs';

const AT = '2026-10-10T12:00:00.000Z';
const LATER = '2026-10-10T12:00:05.000Z';

function call(port, method, target, { token = null, body = undefined, headers = {} } = {}) {
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
        resolve({ status: res.statusCode, headers: res.headers, raw, json });
      });
    });
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

function key() {
  return { 'idempotency-key': randomUUID() };
}

async function boot(t) {
  const fixture = await makeCoreFixture();
  const origin = path.join(fixture.root, 'origin');
  await mkdir(origin, { recursive: true });
  fixture.paths.origin = origin;
  const localPath = path.join(fixture.paths.localDirectory, 'shop');
  await mkdir(localPath, { recursive: true });
  const core = await composeCore({
    store: fixture.store,
    paths: fixture.paths,
    now: () => fixture.clock.now,
    projects: [{ name: 'shop', localPath }],
  });
  t.after(async () => {
    await core.http.close();
    await dispose(fixture);
  });
  const local = await call(core.http.port, 'POST', '/api/v1/auth/local', { token: core.bootstrap.secret, body: { embedded: false, hostOrigin: null, look: null, language: null } });
  assert.equal(local.status, 201);
  return { fixture, core, localPath, token: local.json.data.token, port: core.http.port };
}

test('desktop HTTP covers chat, task, editor, watch, phone denial, receipts and logout', async (t) => {
  const { fixture, core, localPath, token, port } = await boot(t);
  await writeBeat({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now }, 'running');
  const unitKey = randomUUID();
  const created = await call(port, 'POST', '/api/v1/units', {
    token,
    body: { unit: 'builder', role: 'executor', scope: 'root', machine: fixture.machine },
    headers: { 'idempotency-key': unitKey },
  });
  assert.equal(created.status, 201);
  const replay = await call(port, 'POST', '/api/v1/units', {
    token,
    body: { unit: 'builder', role: 'executor', scope: 'root', machine: fixture.machine },
    headers: { 'idempotency-key': unitKey },
  });
  assert.equal(replay.status, 201);
  assert.equal(replay.json.meta.replayed, true);
  const units = await call(port, 'GET', '/api/v1/units', { token });
  assert.equal(units.json.data.items.some((item) => item.unit === 'builder'), true);

  const builder = units.json.data.items.find((item) => item.unit === 'builder');
  const chat = await call(port, 'POST', '/api/v1/chats', {
    token,
    body: { members: [builder.id], title: 'Release' },
    headers: key(),
  });
  assert.equal(chat.status, 201);
  const posted = await call(port, 'POST', `/api/v1/chats/${chat.json.data.id}/messages`, {
    token,
    body: { body: 'Ship the notes.' },
    headers: key(),
  });
  assert.equal(posted.status, 201);
  assert.equal(posted.json.data.message.body, 'Ship the notes.');
  // The service puts the chat message in the agent's inbox itself, so the notice is submitted.
  assert.deepEqual(posted.json.data.notifications, [{ unitId: builder.id, state: 'submitted' }]);

  const taskId = 'project:shop:029';
  const taskPath = path.join(fixture.paths.mind, 'user', 'tasks', '029.md');
  await mkdir(path.dirname(taskPath), { recursive: true });
  await writeFile(taskPath, `id: ${taskId}\r\ntitle: Review me\r\nstatus: open\r\nfrom: user\r\nto-id: ${builder.id}\r\ndate: 2026-10-10\r\n\r\n## Request\r\nKeep this request.\r\n\r\n## Report\r\nExisting report.\r\n`);
  const task = await call(port, 'GET', `/api/v1/tasks/${taskId}`, { token });
  assert.equal(task.status, 200);
  const reviewed = await call(port, 'POST', `/api/v1/tasks/${taskId}/status`, {
    token,
    body: { status: 'review', expectedRevision: task.json.data.revision },
    headers: key(),
  });
  assert.equal(reviewed.status, 200);
  const accepted = await call(port, 'POST', `/api/v1/tasks/${taskId}/status`, {
    token,
    body: { status: 'done', expectedRevision: reviewed.json.data.task.revision },
    headers: key(),
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.json.data.task.status, 'done');
  const undone = await call(port, 'POST', `/api/v1/tasks/${taskId}/undo`, {
    token,
    body: { expectedRevision: accepted.json.data.task.revision },
    headers: key(),
  });
  assert.equal(undone.status, 200);
  assert.equal(undone.json.data.task.status, 'review');
  assert.match(await readFile(taskPath, 'utf8'), /## Report/);

  const document = newSketch('cart', 'Cart');
  addScreen(document, { title: 'Bag', x: 0, y: 0 });
  document.script = 'kept';
  const board = await call(port, 'POST', '/api/v1/blueprint/boards', {
    token,
    body: { project: 'shop', document },
    headers: key(),
  });
  assert.equal(board.status, 201);
  assert.equal(board.json.data.document.script, 'kept');
  const text = await call(port, 'POST', '/api/v1/void/texts', {
    token,
    body: {
      project: 'shop',
      path: 'docs/release.json',
      document: { title: 'Release notes', rev: 0, pages: [{ k: 'Intro.Welcome', en: 'Hello there', es: 'Hola' }] },
    },
    headers: key(),
  });
  assert.equal(text.status, 201);
  const attachmentList = await call(port, 'GET', `/api/v1/editors/${text.json.data.id}/attachments`, { token });
  assert.equal(attachmentList.status, 200);
  const attached = await call(port, 'PUT', `/api/v1/editors/${text.json.data.id}/attachments`, {
    token,
    body: { attached: [builder.id], expectedRevision: attachmentList.json.data.revision },
    headers: key(),
  });
  assert.equal(attached.status, 200);
  const existingComments = await call(port, 'GET', `/api/v1/editors/${text.json.data.id}/comments`, { token });
  assert.equal(existingComments.status, 200);
  const commented = await call(port, 'POST', `/api/v1/editors/${text.json.data.id}/comments`, {
    token,
    body: {
      text: 'Clarify',
      expectedRevision: text.json.data.revision,
      expectedCommentsRevision: existingComments.json.data.commentsRevision,
      anchor: { k: 'Intro.Welcome', lang: 'en', start: 0, end: 5, quote: 'Hello' },
    },
    headers: key(),
  });
  assert.equal(commented.status, 201);
  const fanout = await readdir(path.join(fixture.paths.mind, 'user', 'relay', 'fanout'));
  assert.equal(fanout.some((name) => name.endsWith('.json')), true);
  const proposed = await call(port, 'POST', `/api/v1/void/texts/${text.json.data.id}/ranges`, {
    token,
    body: {
      k: 'Intro.Welcome',
      lang: 'en',
      start: 0,
      end: 5,
      expectedText: 'Hello',
      replacement: 'Hi',
      expectedRevision: text.json.data.revision,
      mode: 'propose',
      threadId: commented.json.data.thread.id,
      expectedCommentsRevision: commented.json.data.commentsRevision,
    },
    headers: key(),
  });
  assert.equal(proposed.status, 200);
  assert.equal(proposed.json.data.proposal.state, 'pending');
  const answer = await call(port, 'POST', `/api/v1/void/texts/${text.json.data.id}/proposals/${proposed.json.data.proposal.id}/answer`, {
    token,
    body: {
      decision: 'accept',
      expectedRevision: text.json.data.revision,
      expectedCommentsRevision: proposed.json.data.proposal.commentsRevision,
    },
    headers: key(),
  });
  assert.equal(answer.status, 200);
  assert.equal(answer.json.data.editor.document.pages[0].en.startsWith('Hi'), true);
  assert.match(await readFile(path.join(localPath, 'docs', 'release.versions.jsonl'), 'utf8'), /Hello/);

  const watch = await call(port, 'POST', '/api/v1/watch', {
    token,
    body: { unitId: 'root:master' },
    headers: key(),
  });
  assert.equal(watch.status, 200);
  const stopped = await call(port, 'DELETE', `/api/v1/watch/${watch.json.data.watchId}`, { token, body: {}, headers: key() });
  assert.equal(stopped.status, 204);

  const phone = core.credentials.issue({ audience: 'phone', unitId: 'root:master', expiresAt: '2027-01-01T00:00:00.000Z' });
  const denied = await call(port, 'PATCH', '/api/v1/settings', {
    token: phone.token,
    body: { language: 'es', expectedRevision: null },
    headers: key(),
  });
  assert.equal(denied.status, 403);

  const opened = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('event stream timed out')), 30000);
    const req = request({
      host: '127.0.0.1',
      port,
      method: 'GET',
      path: '/api/v1/events',
      headers: {
        host: `127.0.0.1:${port}`,
        origin: `http://127.0.0.1:${port}`,
        authorization: `Bearer ${token}`,
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk.toString('utf8');
        if (raw.includes('event: stream.ready')) {
          clearTimeout(timer);
          resolve({ req, raw });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(opened.raw.includes(token), false);
  opened.req.destroy();
  const loggedOut = await call(port, 'POST', '/api/v1/auth/logout', { token });
  assert.equal(loggedOut.status, 204);
  assert.equal((await call(port, 'GET', '/api/v1/units', { token })).status, 401);
  const recovered = await recoverTransactions(fixture.store);
  assert.equal(Array.isArray(recovered), true);
  const receiptGroups = await readdir(path.join(fixture.paths.localDirectory, 'receipts'));
  let receipt = null;
  for (const group of receiptGroups) {
    const bytes = await readFile(path.join(fixture.paths.localDirectory, 'receipts', group, `${unitKey}.json`)).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (bytes) receipt = JSON.parse(bytes.toString('utf8'));
  }
  assert.ok(receipt);
  assert.equal(typeof receipt.requestId, 'string');
  assert.equal(receipt.response.unit, created.json.data.unit);
});

test('two machines share an origin and limits pause at the hard window', async (t) => {
  const fixture = await makeCoreFixture({ machine: 'DESKTOP' });
  t.after(() => dispose(fixture));
  const origin = path.join(fixture.root, 'origin');
  await mkdir(path.join(origin, 'machines'), { recursive: true });
  fixture.paths.origin = origin;
  const laptopMind = path.join(fixture.root, 'localappdata', 'Cosmic', 'laptop-mind');
  await mkdir(path.join(laptopMind, 'user'), { recursive: true });
  const laptopPaths = servicePaths({
    platform: 'win32',
    env: fixture.env,
    home: fixture.home,
    machine: 'LAPTOP',
    mindPath: laptopMind,
    originPath: origin,
  });
  await mkdir(laptopPaths.localDirectory, { recursive: true });
  const laptopStore = createStore({
    root: fixture.root,
    confineRoot: fixture.root,
    mindPath: laptopMind,
    localDirectory: laptopPaths.localDirectory,
    now: () => fixture.clock.now,
    events: [],
  });
  const desktop = openSync({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now });
  const laptopOrigin = openOrigin({ store: laptopStore, paths: laptopPaths, now: () => fixture.clock.now, machine: 'LAPTOP' });
  const target = { kind: 'mind', path: 'user/doc.txt' };
  const newer = Buffer.from('newer text');
  const first = encodePack({
    machine: 'LAPTOP',
    sequence: 1,
    changes: [{
      format: 'hivem1nd-change-v1', id: '11111111-1111-4111-8111-111111111111', machine: 'LAPTOP', at: LATER, target, // Compatibility: stored schemas and wire contracts retain their existing identifiers.
      operation: 'put', hash: hashBytes(newer), size: newer.length, baseHash: null, messageId: null, transactionId: null,
    }],
    objects: [{ hash: hashBytes(newer), raw: newer }],
    dependencies: [],
    transactions: [],
  });
  await publishPack(laptopOrigin, first);
  await applyPack(desktop, first, { ledger: null });
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'doc.txt'), 'utf8'), 'newer text');
  const older = Buffer.from('older text');
  const second = encodePack({
    machine: 'LAPTOP',
    sequence: 2,
    changes: [{
      format: 'hivem1nd-change-v1', id: '22222222-2222-4222-8222-222222222222', machine: 'LAPTOP', at: AT, target, // Compatibility: stored schemas and wire contracts retain their existing identifiers.
      operation: 'put', hash: hashBytes(older), size: older.length, baseHash: null, messageId: null, transactionId: null,
    }],
    objects: [{ hash: hashBytes(older), raw: older }],
    dependencies: [],
    transactions: [],
  });
  await publishPack(laptopOrigin, second);
  await applyPack(desktop, second);
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'doc.txt'), 'utf8'), 'newer text');
  const removal = encodePack({
    machine: 'LAPTOP',
    sequence: 3,
    changes: [{
      format: 'hivem1nd-change-v1', id: '33333333-3333-4333-8333-333333333333', machine: 'LAPTOP', at: '2026-10-10T12:00:06.000Z', target, // Compatibility: stored schemas and wire contracts retain their existing identifiers.
      operation: 'delete', hash: null, size: 0, baseHash: hashBytes(newer), messageId: null, transactionId: null,
    }],
    objects: [],
    dependencies: [],
    transactions: [],
  });
  await applyPack(desktop, removal);
  await assert.rejects(() => readFile(path.join(fixture.paths.mind, 'user', 'doc.txt')), { code: 'ENOENT' });
  const ledger = openLedger({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, machine: 'DESKTOP' });
  const raw = Buffer.from('shared');
  const base = encodePack({
    machine: 'LAPTOP', sequence: 1, changes: [], objects: [{ hash: hashBytes(raw), raw }], dependencies: [], transactions: [],
  });
  const later = encodePack({
    machine: 'LAPTOP',
    sequence: 9,
    changes: [{
      format: 'hivem1nd-change-v1', id: '44444444-4444-4444-8444-444444444444', machine: 'LAPTOP', at: LATER, // Compatibility: stored schemas and wire contracts retain their existing identifiers.
      target: { kind: 'mind', path: 'user/later.txt' }, operation: 'put', hash: hashBytes(raw), size: raw.length,
      baseHash: null, messageId: null, transactionId: null,
    }],
    objects: [],
    dependencies: [{ hash: hashBytes(raw), machine: 'LAPTOP', sequence: 1, packHash: hashBytes(base) }],
    transactions: [],
  });
  const pending = await applyPack(desktop, later, {
    ledger,
    provider: {
      async readHead() {
        return { format: 'hivem1nd-head-v1', machine: 'LAPTOP', sequence: 1, updatedAt: AT, packs: [{ sequence: 1, file: '000000000001.pack', hash: hashBytes(base), bytes: base.length }] }; // Compatibility: stored schemas and wire contracts retain their existing identifiers.
      },
      async readPack() { return null; },
    },
  });
  assert.equal(pending.status, 'pending');
  await reservePublication(ledger, { id: 'window', messages: 0, bytes: 50000000 });
  assert.equal((await limitsFor(ledger, 'publication')).state, 'paused');
  await assert.rejects(reservePublication(ledger, { id: 'more', messages: 0, bytes: 1 }), (error) => error.status === 429);
});

test('an open stream receives imported chat, unit, and editor events once', async (t) => {
  const { fixture, core, localPath, token, port } = await boot(t);
  await core.runtime.pulse.close().done;
  const chatId = '55555555-5555-4555-8555-555555555555';
  const messageId = '66666666-6666-4666-8666-666666666666';
  const voidPath = 'docs/note.json';
  const boardPath = 'docs/flows/boards/home.json';
  const voidId = uuidV8(['editor', 'void', 'shop', voidPath]);
  const boardId = uuidV8(['editor', 'blueprint', 'shop', boardPath]);
  await mkdir(path.join(fixture.paths.mind, 'user', 'relay', 'chats', chatId), { recursive: true });
  await mkdir(path.join(fixture.paths.mind, 'user', 'state'), { recursive: true });
  await mkdir(path.join(fixture.paths.mind, 'user', 'gui'), { recursive: true });
  await mkdir(path.join(localPath, 'docs', 'flows', 'boards'), { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'user', 'relay', 'chats', chatId, 'chat.md'), `id: ${chatId}\ntitle: Probe\nmembers: ["root:master"]\npinned: false\nlisted: true\ncreated: ${AT}\ncreated-by: root:master\nkind: direct\n\n`);
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'builder.md'), 'unit: builder\nunit-id: root:builder\nrole: executor\nstate: in\nmachine: DESKTOP\n\nLocal.\n');
  await writeFile(path.join(localPath, 'docs', 'note.json'), `${JSON.stringify({ rev: 1, pages: { en: 'local' } })}\n`);
  await writeFile(path.join(localPath, 'docs', 'flows', 'boards', 'home.json'), `${JSON.stringify({ id: 'home', title: 'Local' })}\n`);
  await writeFile(path.join(fixture.paths.mind, 'user', 'gui', 'resources.json'), `${JSON.stringify({
    format: 'hivem1nd-resources-v1', // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    resources: [
      { id: voidId, kind: 'void', project: 'shop', path: voidPath, legacyId: 'note', readOnly: false, attached: [] },
      { id: boardId, kind: 'blueprint', project: 'shop', path: boardPath, legacyId: 'home', readOnly: false, attached: [] },
    ],
  })}\n`);
  const outsider = [];
  core.bus.subscribe({ audience: 'agent', unitId: 'root:stranger', stableId: 'stranger' }, {}, (frame) => outsider.push(frame));
  const opened = await openEvents(port, token);
  t.after(() => opened.req.destroy());
  const messageBytes = Buffer.from(`id: ${messageId}\nfrom: master\nto: chat\nto-id: chat:${chatId}\nmachine: LAPTOP\ntimestamp: ${LATER}\npriority: normal\nsubject:\nthread-id: ${chatId}\nreply-to:\nreply-requested: false\nattachments: []\nkind: message\n\nQA043 clean incoming live probe`);
  const unitBytes = Buffer.from('unit: builder\nunit-id: root:builder\nrole: executor\nstate: in\nmachine: LAPTOP\n\nUpdated from the other machine.\n');
  const voidBytes = Buffer.from(`${JSON.stringify({ rev: 2, pages: { en: 'imported void' } })}\n`);
  const boardBytes = Buffer.from(`${JSON.stringify({ id: 'home', title: 'Imported' })}\n`);
  const transactionId = '77777777-7777-4777-8777-777777777777';
  const messageChange = '11111111-1111-4111-8111-111111111111';
  const unitChange = '22222222-2222-4222-8222-222222222222';
  const voidChange = '33333333-3333-4333-8333-333333333333';
  const boardChange = '44444444-4444-4444-8444-444444444444';
  const laptop = await laptopOriginFor(fixture);
  await publishPack(laptop, encodePack({
    machine: 'LAPTOP',
    sequence: 1,
    changes: [
      importedChange(messageChange, { kind: 'mind', path: `user/relay/chats/${chatId}/${messageId}.md` }, messageBytes, transactionId),
      importedChange(unitChange, { kind: 'mind', path: 'user/state/builder.md' }, unitBytes, transactionId),
      importedChange(voidChange, { kind: 'project', project: 'shop', path: voidPath }, voidBytes, transactionId),
      importedChange(boardChange, { kind: 'project', project: 'shop', path: boardPath }, boardBytes, transactionId),
    ],
    objects: [messageBytes, unitBytes, voidBytes, boardBytes].map((raw) => ({ hash: hashBytes(raw), raw })),
    dependencies: [],
    transactions: [{ id: transactionId, changeIds: [messageChange, unitChange, voidChange, boardChange] }],
  }));
  const frames = await waitForFrames(opened, () => {
    const parsed = sseFrames(opened.raw).filter(frame => frame.data.source.kind === 'sync');
    const names = parsed.map((frame) => frame.name);
    return names.includes('message.created') && names.includes('unit.changed') && names.includes('void.changed') && names.includes('blueprint.changed') ? parsed : null;
  }, core.runtime);
  const message = frames.find((frame) => frame.name === 'message.created');
  const chat = frames.find((frame) => frame.name === 'chat.changed');
  const unit = frames.find((frame) => frame.name === 'unit.changed');
  const text = frames.find((frame) => frame.name === 'void.changed');
  const board = frames.find((frame) => frame.name === 'blueprint.changed');
  assert.equal(message.data.source.kind, 'sync');
  assert.equal(message.data.source.id, 'LAPTOP');
  assert.equal(message.data.data.chatId, chatId);
  assert.equal(message.data.data.mailboxId, null);
  assert.equal(message.data.data.message.id, messageId);
  assert.equal(message.data.data.message.body, 'QA043 clean incoming live probe');
  assert.equal(chat.data.data.chat.lastMessage.body, 'QA043 clean incoming live probe');
  assert.equal(unit.data.source.kind, 'sync');
  assert.equal(unit.data.data.unit.id, 'root:builder');
  assert.match(unit.data.data.unit.context, /Updated from the other machine/);
  assert.equal(text.data.data.resourceId, voidId);
  assert.equal(text.data.data.operation, 'import');
  assert.equal(text.data.data.rev, 2);
  assert.equal(text.data.source.kind, 'sync');
  assert.equal(board.data.data.resourceId, boardId);
  assert.equal(board.data.data.operation, 'import');
  assert.equal(board.data.data.nodeId, null);
  assert.equal(frames.filter((frame) => frame.name === 'view.changed').length, 1);
  assert.deepEqual(frames.find((frame) => frame.name === 'view.changed').data.data.collections, ['chats', 'editors', 'leads', 'squads', 'units', 'waiting']);
  assert.equal(outsider.length, 0);
  const sameMessage = '88888888-8888-4888-8888-888888888888';
  await publishPack(laptop, encodePack({
    machine: 'LAPTOP',
    sequence: 2,
    changes: [importedChange(sameMessage, { kind: 'mind', path: `user/relay/chats/${chatId}/${messageId}.md` }, messageBytes, null, '2026-10-10T12:00:06.000Z')],
    objects: [{ hash: hashBytes(messageBytes), raw: messageBytes }],
    dependencies: [],
    transactions: [],
  }));
  await waitForFile(path.join(fixture.paths.localDirectory, 'received', 'LAPTOP', '2.applied.json'), core.runtime);
  await writeFile(path.join(fixture.paths.origin, 'machines', 'LAPTOP', 'again.txt'), 'again\n');
  await delay(300);
  const after = sseFrames(opened.raw).filter(frame => frame.data.source.kind === 'sync');
  assert.equal(after.filter((frame) => frame.name === 'message.created').length, 1);
  assert.equal(after.filter((frame) => frame.name === 'unit.changed').length, 1);
  assert.equal(after.filter((frame) => frame.name === 'void.changed').length, 1);
  assert.equal(after.filter((frame) => frame.name === 'blueprint.changed').length, 1);
  assert.equal(after.filter((frame) => frame.name === 'view.changed').length, 1);
  assert.equal(outsider.length, 0);
});

test('an invalid owner pack stays rejected and visible until reconcile succeeds', async (t) => {
  const { fixture, core, token, port } = await boot(t);
  const chatId = '55555555-5555-4555-8555-555555555555';
  const messageId = '66666666-6666-4666-8666-666666666666';
  const sessionId = '99999999-9999-4999-8999-999999999999';
  const unitId = 'root:builder';
  const messagePath = path.join(fixture.paths.mind, 'user', 'relay', 'chats', chatId, `${messageId}.md`);
  await mkdir(path.join(fixture.paths.mind, 'user', 'relay', 'registrations'), { recursive: true });
  await mkdir(path.join(fixture.paths.mind, 'user', 'relay', 'chats', chatId), { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'user', 'relay', 'registrations', 'desktop.json'), `${JSON.stringify({
    kind: 'registration', sessionId, unitId, machine: 'DESKTOP',
  })}\n`);
  const messageBytes = Buffer.from(`id: ${messageId}\nfrom: builder\nfrom-id: ${unitId}\nto: chat:${chatId}\nmachine: LAPTOP\ntimestamp: ${LATER}\nkind: message\n\nRejected owner\n`);
  const changeId = '12121212-1212-4121-8121-121212121212';
  const laptop = await laptopOriginFor(fixture);
  await publishPack(laptop, encodePack({
    machine: 'LAPTOP',
    sequence: 1,
    changes: [importedChange(changeId, { kind: 'mind', path: `user/relay/chats/${chatId}/${messageId}.md` }, messageBytes, null)],
    objects: [{ hash: hashBytes(messageBytes), raw: messageBytes }],
    dependencies: [],
    transactions: [],
  }));
  const failed = await waitForSync(port, token, (data) => data?.error?.code === 'invalid_record_owner');
  assert.equal(failed.state, 'error');
  assert.deepEqual(failed.incoming, []);
  assert.equal(failed.retryAt, null);
  assert.equal(failed.error.message, 'The record is not owned by the publishing machine.');
  const settings = await call(port, 'GET', `/api/v1/settings?machine=${fixture.machine}`, { token });
  assert.equal(settings.status, 200);
  assert.equal(settings.json.data.selectedMachine, fixture.machine);
  assert.equal(settings.json.data.readOnly, false);
  assert.equal(settings.json.data.service.machine, fixture.machine);
  assert.equal(settings.json.data.service.state, 'running');
  const visible = await call(port, 'GET', '/api/v1/sync', { token });
  assert.equal(visible.status, 200);
  assert.equal(visible.json.data.state, 'error');
  assert.deepEqual(visible.json.data.error, failed.error);
  await assert.rejects(() => readFile(messagePath), (error) => error.code === 'ENOENT');
  await recordSyncFailure(core.runtime.sync, { code: 'sync_rate_limited', retryAt: '2026-10-10T12:05:00.000Z' });
  await clearSyncFailure(core.runtime.sync);
  const kept = await call(port, 'GET', '/api/v1/sync', { token });
  assert.equal(kept.status, 200);
  assert.equal(kept.json.data.state, 'error');
  assert.equal(kept.json.data.error.code, 'invalid_record_owner');
  await writeFile(path.join(fixture.paths.mind, 'user', 'relay', 'registrations', 'laptop.json'), `${JSON.stringify({
    kind: 'registration', sessionId: 'abababab-abab-4bab-8bab-abababababab', unitId, machine: 'LAPTOP',
  })}\n`);
  await writeFile(path.join(fixture.paths.origin, 'machines', 'LAPTOP', 'again.txt'), 'again\n');
  const cleared = await waitForSync(port, token, (data) => data?.state && data.error == null);
  assert.equal(cleared.state === 'error', false);
  assert.equal(cleared.error, null);
  assert.equal(await readFile(messagePath, 'utf8'), messageBytes.toString('utf8'));
});

test('home access expires, native login stays unverified, and stdio rejects an unknown protocol', async (t) => {
  const clock = { now: Date.parse(AT) };
  const listeners = [];
  const context = {
    now: () => clock.now,
    interfaces: () => [{ name: 'Ethernet', address: '10.8.0.8', netmask: '255.255.255.0', internal: false }],
    listen: (address) => new Promise((resolve, reject) => {
      const server = createServer((socket) => socket.destroy());
      listeners.push(server);
      server.unref();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve({
        address: address.address,
        netmask: address.netmask,
        port: server.address().port,
        close: () => new Promise((done) => server.close(() => done())),
      }));
    }),
    credentials: createCredentialStore({ now: () => clock.now }),
    schedule: (fn) => ({ fn, cleared: false }),
    bus: { emit() {} },
  };
  t.after(() => Promise.all(listeners.map((server) => new Promise((resolve) => server.close(() => resolve())))));
  const opened = await openHome(context);
  clock.now += 43200000;
  await assert.rejects(() => exchange(context, { key: opened.key }, '10.8.0.9'), { code: 'home_expired' });
  const reports = await probeClients({ env: { PATH: '' }, platform: 'win32' });
  assert.equal(reports.claude.nativeSupport, false);
  assert.equal(reports.codex.nativeSupport, false);
  assert.equal(reports.cursor.nativeSupport, false);
  const adapter = createNativeAdapter('claude', { verifiedLogin: false });
  await assert.rejects(() => adapter.create({}), { code: 'client_unavailable' });
  const relay = await makeCoreFixture();
  t.after(() => dispose(relay));
  const mindPath = await makeRelayMind(relay.root);
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const chunks = [];
  stdout.on('data', (chunk) => chunks.push(chunk));
  const server = serveRelayMcp({ mindPath, hostname: 'RELAYTEST', client: 'codex', sessionId: 'instance-a', stdin, stdout, stderr: new PassThrough() });
  stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 'future-version' } })}\n`);
  await server;
  const line = JSON.parse(Buffer.concat(chunks).toString('utf8').trim().split('\n')[0]);
  assert.equal(line.error.code, -32602);
  const fixtureService = await makeCoreFixture();
  t.after(() => dispose(fixtureService));
  const serviceOrigin = path.join(fixtureService.root, 'origin');
  await mkdir(serviceOrigin, { recursive: true });
  const guard = createServer();
  const guardPort = await new Promise((resolve) => guard.listen(0, '127.0.0.1', () => resolve(guard.address().port)));
  await new Promise((resolve) => guard.close(() => resolve()));
  const handle = await startService({
    store: fixtureService.store,
    paths: { ...fixtureService.paths, origin: serviceOrigin },
    now: () => fixtureService.clock.now,
    userKey: 'integration-user',
    guardPort,
    listener: async () => ({ close: async () => {} }),
  });
  assert.equal(handle.beat.state, 'running');
  assert.equal(handle.attached ?? false, false);
  const stopped = await stopService(handle);
  assert.equal(stopped.stopped, true);
  assert.deepEqual(stopped.signaled, []);
  const routes = routeTable();
  assert.equal(routes.some((route) => route.handler === 'unavailable'), false);
  for (const required of ['/view', '/units', '/chats', '/tasks', '/approvals', '/blueprint/boards', '/void/texts', '/watch', '/settings', '/auth/local', '/events']) {
    assert.equal(routes.some((route) => route.template === required), true);
  }
});

function importedChange(id, target, raw, transactionId, at = LATER) {
  return {
    format: 'hivem1nd-change-v1', // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    id,
    machine: 'LAPTOP',
    at,
    target,
    operation: 'put',
    hash: hashBytes(raw),
    size: raw.length,
    baseHash: null,
    messageId: null,
    transactionId,
  };
}

async function laptopOriginFor(fixture) {
  const laptopMind = path.join(fixture.root, 'localappdata', 'Cosmic', 'laptop-mind');
  await mkdir(path.join(laptopMind, 'user'), { recursive: true });
  const laptopPaths = servicePaths({
    platform: 'win32',
    env: fixture.env,
    home: fixture.home,
    machine: 'LAPTOP',
    mindPath: laptopMind,
    originPath: fixture.paths.origin,
  });
  await mkdir(laptopPaths.localDirectory, { recursive: true });
  const laptopStore = createStore({
    root: fixture.root,
    confineRoot: fixture.root,
    mindPath: laptopMind,
    localDirectory: laptopPaths.localDirectory,
    now: () => fixture.clock.now,
    events: [],
  });
  return openOrigin({ store: laptopStore, paths: laptopPaths, now: () => fixture.clock.now, machine: 'LAPTOP' });
}

function openEvents(port, token) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('event stream timed out')), 30000);
    const opened = { raw: '', req: null };
    const req = request({
      host: '127.0.0.1',
      port,
      method: 'GET',
      path: '/api/v1/events',
      headers: {
        host: `127.0.0.1:${port}`,
        origin: `http://127.0.0.1:${port}`,
        authorization: `Bearer ${token}`,
      },
    }, (res) => {
      res.on('data', (chunk) => {
        opened.raw += chunk.toString('utf8');
        if (opened.raw.includes('event: stream.ready')) {
          clearTimeout(timer);
          resolve(opened);
        }
      });
    });
    opened.req = req;
    req.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.end();
  });
}

function sseFrames(raw) {
  const frames = [];
  for (const block of raw.split('\n\n')) {
    let name = null;
    let data = null;
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) name = line.slice('event: '.length);
      if (line.startsWith('data: ')) data = line.slice('data: '.length);
    }
    if (!name || !data || name === 'stream.ready' || name === 'stream.reset') continue;
    try {
      frames.push({ name, data: JSON.parse(data) });
    } catch {
      continue;
    }
  }
  return frames;
}

// Imported frames, sync state and applied files are waited on, not sampled once. The ceiling covers a loaded suite.
function waitForFrames(opened, ready, runtime, timeout = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let value = null;
      try {
        value = ready();
      } catch (error) {
        reject(error);
        return;
      }
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() - start > timeout) {
        const error = runtime.lastError;
        reject(new Error(`timed out waiting for imported events${error ? `: ${error.code ?? ''} ${error.message}` : ''}\n${opened.raw}`));
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

async function waitForSync(port, token, ready, timeout = 30000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start <= timeout) {
    const response = await call(port, 'GET', '/api/v1/sync', { token });
    last = response.json?.data ?? null;
    if (ready(last)) return last;
    await delay(25);
  }
  return last;
}

async function waitForFile(file, runtime, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start <= timeout) {
    try {
      await readFile(file);
      return;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await delay(25);
  }
  const failure = runtime.lastError;
  throw new Error(`timed out waiting for ${path.basename(file)}${failure ? `: ${failure.code ?? ''} ${failure.message}` : ''}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('T064 inventory preserves both boards, all 108 references, 14 replacements and 193 capture destinations', async () => {
  const cases = finalVerificationCases();
  const plan = await readFile(new URL('../docs/3.0/integration.md', import.meta.url), 'utf8');
  const verification = plan.slice(plan.indexOf('##### GUI verification list for T064'), plan.indexOf('## Verified survey corrections'));
  const entries = [...verification.matchAll(/^- \*\*((?:start )?\d+\.\d+) ([^\n]+)$/gm)];
  assert.equal(entries.length, 108);
  assert.deepEqual(cases.map(item => item.reference), entries.map(match => match[1]));
  assert.equal(new Set(cases.map(item => item.reference)).size, 108);
  assert.equal(cases.filter(item => !item.replacements.length).length, 94);
  for (const item of cases) {
    const line = entries.find(match => match[1] === item.reference)[2];
    if (line.includes('REPLACED')) {
      const targets = [...line.slice(0, line.indexOf(';')).matchAll(/start \d+\.\d+/g)].map(match => match[0]);
      assert.deepEqual(item.replacements, targets, item.reference);
      assert.equal(item.captures.length, 0);
      assert.ok(targets.every(reference => cases.some(other => other.reference === reference && !other.replacements.length)));
    } else {
      assert.deepEqual(item.replacements, []);
      assert.deepEqual(item.captures.map(capture => capture.language), ['en', 'es']);
      assert.deepEqual(item.viewport, item.reference.startsWith('7.') ? [390, 844] : [1440, 900]);
    }
  }
  assert.equal(cases.filter(item => item.replacements.length).length, 14);
  const captures = [...cases.flatMap(item => item.captures), ...finalLookCaptures()];
  assert.equal(captures.length, 193);
  assert.equal(new Set(captures.map(item => item.path)).size, 193);
  assert.ok(captures.every(item => /^docs\/3\.0\/verification\/(?:start-)?\d+\.\d+-(?:en|es)-(?:modern|high-contrast|nebula|txmska|coffee-cat|ntk)\.png$/.test(item.path)));

  const flow = await readFile(new URL('../docs/flows/boards/hivem1nd-3-flow.mjs', import.meta.url), 'utf8'); // Historical: immutable 3.0 board references retain their file names.
  const desk = flow.slice(flow.indexOf('const DESK ='), flow.indexOf('const PHONE ='));
  const flowIds = [];
  let row;
  for (const line of desk.split('\n')) {
    const heading = /^  (\w+): \[/.exec(line), entry = /^    \["([^"]+)"/.exec(line);
    if (heading) row = heading[1];
    if (entry) flowIds.push(`${row}-${entry[1]}`);
  }
  const phone = flow.slice(flow.indexOf('const PHONE ='), flow.indexOf('// Each screen'));
  flowIds.push(...[...phone.matchAll(/^  \["([^"]+)"/gm)].map(match => `phone-${match[1]}`));
  assert.deepEqual(cases.filter(item => item.board === 'flow').map(item => item.screenId), flowIds);
  const start = await readFile(new URL('../docs/flows/boards/hivem1nd-3-start.mjs', import.meta.url), 'utf8'); // Historical: immutable 3.0 board references retain their file names.
  const startRows = start.slice(start.indexOf('const ROWS ='), start.indexOf('const STEP_X'));
  const startIds = [];
  for (const line of startRows.split('\n')) {
    const heading = /^  \["([^"]+)"/.exec(line), entry = /^    \["([^"]+)"/.exec(line);
    if (heading) row = heading[1];
    if (entry) startIds.push(`${row}-${entry[1]}`);
  }
  assert.deepEqual(cases.filter(item => item.board === 'start').map(item => item.screenId), startIds);
});

async function finalCall(fx, method, target, body, options = {}, expected = 200) {
  const result = await fx.request(method, target, { ...options, ...(body === undefined ? {} : { body }) });
  assert.equal(result.status, expected, `${method} ${target}: ${result.json?.error?.code ?? 'unexpected status'}`);
  return result.json?.data;
}

function createFinalCoreFixture(options = {}) {
  return openFinalCoreFixture(options, { makeCoreFixture, dispose, composeCore, createStore, createNativeAdapter });
}

async function finalCluster(fx, title = 'ideas') {
  return finalCall(fx, 'POST', '/clusters', { title, parentId: null, link: { kind: 'none' }, machine: 'DESKTOP', confirmed: true }, {}, 201);
}

const finalChoice = { client: 'codex', model: 'observed', effort: 'high', mode: null };
async function finalAgent(fx, clusterId, role = 'executor') {
  const cluster = await finalCall(fx, 'GET', `/clusters/${clusterId}?machine=DESKTOP`);
  return finalCall(fx, 'POST', `/clusters/${clusterId}/agents`, { machine: 'DESKTOP', role, runsIn: finalChoice, useAsDefault: false, expectedRevision: cluster.revision }, {}, 201);
}

for (const language of ['en', 'es']) test(`T064 ${language} discovery imports 26 canonical repositories only after consent and survives a cold store restart`, async t => {
  const fx = await createFinalCoreFixture({ language });
  t.after(() => fx.close());
  const before = await legacyTreeInventory(fx.fixture.home);
  const view = await finalCall(fx, 'GET', '/view');
  assert.deepEqual(view.groups, []);
  assert.equal(view.units.filter(unit => unit.role !== 'master').length, 0);
  const report = await finalCall(fx, 'GET', '/settings/projects?machine=DESKTOP');
  const offer = report.discoveryOffer;
  assert.deepEqual(offer.groups.map(group => [group.title, group.repositories.length]).sort(), [['Tools', 1], ['Unity', 6], ['Web', 19]]);
  const repositories = offer.groups.flatMap(group => group.repositories);
  assert.equal(repositories.length, 26);
  assert.equal(repositories.find(item => item.name === 'shop').worktrees.length, 2);
  assert.deepEqual(await legacyTreeInventory(fx.fixture.home), before);
  const input = { machine: 'DESKTOP', repositoryIds: repositories.map(item => item.id), confirmed: true, expectedRevision: offer.revision };
  const operation = randomUUID(), target = `/discovery/offers/${offer.id}/answer`;
  const accepted = await finalCall(fx, 'POST', target, input, { key: operation });
  assert.equal(accepted.clusters.filter(cluster => cluster.link.kind === 'repository').length, 26);
  const phone = fx.core.credentials.issue({ audience: 'phone', unitId: 'root:master' }).token;
  await finalCall(fx, 'POST', target, input, { key: operation, credential: phone }, 403);
  const shop = accepted.clusters.find(cluster => cluster.title === 'shop');
  const git = await finalCall(fx, 'GET', `/clusters/${shop.id}/git?machine=DESKTOP`);
  assert.equal(git.branch, 'main'); assert.equal(git.dirtyCount, 2);
  assert.equal(git.remote, 'https://example.test/acme/shop.git');
  const changes = await finalCall(fx, 'GET', `/clusters/${shop.id}/changes?machine=DESKTOP`);
  assert.deepEqual(changes.items.map(item => item.path), ['source.txt', 'new.txt']);
  const first = await finalCall(fx, 'GET', '/view');
  assert.equal(first.groups.length, 29);
  assert.ok(first.groups.every(cluster => cluster.members.length === 0));
  const oldStore = fx.fixture.store;
  await fx.control.restart();
  assert.notEqual(fx.fixture.store, oldStore);
  const reopened = await finalCall(fx, 'GET', '/view');
  assert.deepEqual(reopened.groups.map(cluster => cluster.id).sort(), first.groups.map(cluster => cluster.id).sort());
  assert.equal(reopened.units.filter(unit => unit.role !== 'master').length, 0);
  assert.equal((await finalCall(fx, 'GET', '/settings/projects?machine=DESKTOP')).discoveryOffer.dismissed, true);
  assert.deepEqual(await legacyTreeInventory(fx.fixture.home), before);
  assert.equal(fx.launches.length, 0);
});

test('T064 Later and Not now remain empty after restart; canonical agents, aliases and recipient reads retain their identities', async t => {
  const fx = await createFinalCoreFixture(); t.after(() => fx.close());
  const offer = (await finalCall(fx, 'GET', '/settings/projects?machine=DESKTOP')).discoveryOffer;
  await finalCall(fx, 'POST', `/discovery/offers/${offer.id}/answer`, { machine: 'DESKTOP', repositoryIds: [], confirmed: false, expectedRevision: offer.revision });
  await fx.control.restart();
  assert.deepEqual((await finalCall(fx, 'GET', '/view')).groups, []);
  assert.equal((await finalCall(fx, 'GET', '/settings/projects?machine=DESKTOP')).discoveryOffer.dismissed, true);
  const cluster = await finalCluster(fx), lead = await finalAgent(fx, cluster.id, 'overlord');
  const one = await finalAgent(fx, cluster.id), two = await finalAgent(fx, cluster.id);
  assert.equal(one.leadId, lead.id); assert.equal(two.leadId, lead.id); assert.notEqual(one.id, two.id);
  assert.deepEqual(two.runsIn, finalChoice); assert.equal(fx.launches.length, 0);
  const renamed = await finalCall(fx, 'PATCH', `/units/${one.id}/alias`, { alias: 'Blog', expectedRevision: one.revision });
  assert.equal(renamed.id, one.id); assert.equal(renamed.alias, 'Blog');
  const chat = await finalCall(fx, 'POST', '/chats', { members: [one.id, two.id], title: 'Authored messages' }, {}, 201);
  const messageKey = randomUUID(), target = `/chats/${chat.id}/messages`;
  const first = await finalCall(fx, 'POST', target, { body: 'Keep the illustration.' }, { key: messageKey }, 201);
  const replay = await finalCall(fx, 'POST', target, { body: 'Keep the illustration.' }, { key: messageKey }, 201);
  assert.equal(replay.message.id, first.message.id);
  await finalCall(fx, 'POST', target, { body: 'Keep the second decision.' }, {}, 201);
  const unread = async () => (await finalCall(fx, 'GET', '/view')).units.find(unit => unit.id === two.id).unread;
  assert.equal(await unread(), 2);
  const messages = (await finalCall(fx, 'GET', target)).items;
  await finalCall(fx, 'POST', `/chats/${chat.id}/read`, { messageIds: messages.map(message => message.id) });
  assert.equal(await unread(), 2);
  const recipient = fx.core.credentials.issue({ audience: 'agent', unitId: two.id, sessionId: randomUUID() }).token;
  await finalCall(fx, 'POST', `/chats/${chat.id}/read`, { messageIds: messages.map(message => message.id) }, { credential: recipient });
  assert.equal(await unread(), 0);
  assert.equal((await finalCall(fx, 'GET', '/view')).units.find(unit => unit.id === one.id).unread, 2);
  await fx.control.restart();
  assert.equal(await unread(), 0);
  assert.equal((await finalCall(fx, 'GET', `/units/${one.id}`)).alias, 'Blog');
  assert.deepEqual((await finalCall(fx, 'GET', target)).items.map(message => message.id), messages.map(message => message.id));
});

test('T064 an approved lead plan keeps authored chat and verified Work through service restart without opening a second run', async t => {
  const fx = await createFinalCoreFixture(); t.after(() => fx.close());
  const cluster = await finalCluster(fx, 'shop'), unit = await finalAgent(fx, cluster.id);
  await finalCall(fx, 'POST', `/chats/${cluster.chatId}/messages`, { body: 'Plan the cart empty state.' }, {}, 201);
  const taskId = 'root:064', taskFile = path.join(fx.fixture.paths.mind, 'user', 'tasks', '064.md');
  await mkdir(path.dirname(taskFile), { recursive: true });
  await writeFile(taskFile, `id: ${taskId}\ntitle: Cart empty state\nstatus: open\nfrom-id: root:master\nto-id: ${unit.id}\nfiles: ["cart.txt"]\n\n## Request\nPlan the cart.\n`);
  const chat = await finalCall(fx, 'GET', `/chats/${cluster.chatId}`);
  const assignment = { kind: 'unit', unitId: unit.id, runsIn: finalChoice };
  const plan = await finalCall(fx, 'POST', '/plans', { clusterId: cluster.id, chatId: cluster.chatId, machine: 'DESKTOP', title: 'Cart empty state', branch: 'cart-empty', mode: 'planning',
    tasks: [{ id: taskId, title: 'Cart empty state', assignment }], roles: { coordinator: assignment, planner: assignment, builder: assignment, reviewer: assignment }, expectedChatRevision: chat.revision }, {}, 201);
  assert.equal(fx.launches.length, 0);
  const runKey = randomUUID(), runTarget = `/plans/${plan.id}/run`, input = { confirmed: true, expectedRevision: plan.revision };
  const started = await finalCall(fx, 'POST', runTarget, input, { key: runKey }, 202);
  assert.equal((await finalCall(fx, 'POST', runTarget, input, { key: runKey }, 202)).runId, started.runId);
  const context = fx.core.runtime.settingsOwner;
  await drainRunLaunches(context);
  const run = await finalCall(fx, 'GET', `/runs/${started.runId}`), attempt = run.attempts[0];
  assert.equal(fx.launches.length, 1); assert.deepEqual(fx.launches[0].runsIn, finalChoice);
  assert.deepEqual(fx.launches[0].launchScope.writeRoots, []);
  await callPlanTool({ ...context, principal: { audience: 'agent', unitId: unit.id, sessionId: attempt.sessionId } }, 'plan_step', {
    runId: run.id, attemptId: attempt.id, eventId: 'read-board', step: 'plan', state: 'started', requestId: randomUUID(),
  });
  const work = await finalCall(fx, 'GET', `/sessions/${attempt.sessionId}/work`);
  assert.ok(work.items.length > 0);
  const messages = (await finalCall(fx, 'GET', `/chats/${cluster.chatId}/messages`)).items;
  assert.deepEqual(messages.map(message => message.body), ['Plan the cart empty state.']);
  const phone = fx.core.credentials.issue({ audience: 'phone', unitId: 'root:master' }).token;
  for (const resource of ['work', 'transcript', 'context']) await finalCall(fx, 'GET', `/sessions/${attempt.sessionId}/${resource}`, undefined, { credential: phone }, 403);
  await fx.control.restart();
  const persisted = await finalCall(fx, 'GET', `/runs/${run.id}`);
  assert.equal(persisted.id, run.id); assert.equal(persisted.planId, plan.id);
  assert.equal(fx.launches.length, 1);
  const reopenedWork = (await finalCall(fx, 'GET', `/sessions/${attempt.sessionId}/work`)).items;
  assert.deepEqual(reopenedWork.slice(0, work.items.length), work.items);
  assert.deepEqual(reopenedWork.slice(work.items.length).map(item => item.kind), ['exit', 'cleanup']);
  assert.equal(persisted.state, 'open', 'exit and cleanup alone cannot replace the agent report');
  assert.deepEqual((await finalCall(fx, 'GET', `/chats/${cluster.chatId}/messages`)).items.map(message => message.id), messages.map(message => message.id));
});

test('T064 cross-project Blueprint and bilingual Void bundles survive restart and guarded Undo restores their original bytes', async t => {
  const fx = await createFinalCoreFixture(); t.after(() => fx.close());
  const offer = (await finalCall(fx, 'GET', '/settings/projects?machine=DESKTOP')).discoveryOffer;
  const repositories = offer.groups.flatMap(group => group.repositories).filter(item => ['shop', 'blog'].includes(item.name));
  await finalCall(fx, 'POST', `/discovery/offers/${offer.id}/answer`, { machine: 'DESKTOP', repositoryIds: repositories.map(item => item.id), confirmed: true, expectedRevision: offer.revision });
  const sketch = newSketch('cart', 'Cart'); addScreen(sketch, { title: 'Empty cart', x: 0, y: 0 }); sketch.retained = { unknown: ['board'] };
  const text = { title: 'Release', rev: 0, retained: { unknown: ['text'] }, pages: [{ k: 'intro', en: '# Cart\n**Empty** 😀', es: '# Carrito\n**Vacío** 😀' }] };
  const editors = [], moves = [];
  for (const [kind, document] of [['blueprint', sketch], ['void', text]]) {
    const editor = await finalCall(fx, 'POST', kind === 'blueprint' ? '/blueprint/boards' : '/void/texts', { project: 'shop', document, ...(kind === 'void' ? { path: 'docs/release.json' } : {}) }, {}, 201);
    editors.push({ kind, editor });
  }
  for (const { kind, editor } of editors) {
    const source = await readFile(path.join(fx.repositories.shop, editor.path));
    const current = await finalCall(fx, 'GET', `/${kind === 'blueprint' ? 'blueprint/boards' : 'void/texts'}/${editor.id}`);
    const input = { project: 'blog', path: `docs/${kind}-moved.json`, folderId: null, confirmedRepositoryChange: true,
      expectedRevision: current.revision, expectedCommentsRevision: current.commentsRevision,
      expectedAttachmentRevision: current.attachmentRevision, expectedLibraryRevision: current.libraryRevision };
    await finalCall(fx, 'POST', `/editors/${editor.id}/move`, { ...input, confirmedRepositoryChange: false }, {}, 422);
    const moved = await finalCall(fx, 'POST', `/editors/${editor.id}/move`, input);
    assert.notEqual(moved.editor.id, editor.id);
    await assert.rejects(readFile(path.join(fx.repositories.shop, editor.path)), { code: 'ENOENT' });
    assert.deepEqual(await readFile(path.join(fx.fixture.home, 'Web', 'blog', moved.editor.path)), source);
    moves.push({ kind, editor, moved, source });
  }
  await fx.control.restart();
  for (const { kind, editor, moved, source } of moves.toReversed()) {
    const restored = await finalCall(fx, 'GET', `/${kind === 'blueprint' ? 'blueprint/boards' : 'void/texts'}/${moved.editor.id}`);
    assert.deepEqual(restored.document.retained, editor.document.retained);
    const history = await finalCall(fx, 'GET', `/editors/${moved.editor.id}/history`);
    assert.ok(history.items.length > 0);
    await finalCall(fx, 'POST', `/changes/${moved.changeId}/undo`, {});
    assert.deepEqual(await readFile(path.join(fx.repositories.shop, editor.path)), source);
    await assert.rejects(readFile(path.join(fx.fixture.home, 'Web', 'blog', moved.editor.path)), { code: 'ENOENT' });
  }
});

test('T064 checked Content pins, selected scope, repository acceptance and Remove/Undo persist across actual-core restarts', async t => {
  const fx = await createFinalCoreFixture(); t.after(() => fx.close());
  const cluster = await finalCluster(fx, 'Checkout launch'), agent = await finalAgent(fx, cluster.id);
  const archive = gzipSync(finalAdditionArchive()), owner = fx.core.runtime.settingsOwner;
  let pin = 'a'.repeat(40);
  owner.additionLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  owner.additionTransport = async url => ({ status: 200, bytes: url.pathname.includes('/commits/')
    ? Buffer.from(JSON.stringify({ sha: pin, commit: { committer: { date: '2026-10-01T00:00:00.000Z' } } })) : archive });
  owner.additionRunner = async (_command, args, options, input) => {
    assert.ok(args.includes('hash-object')); assert.equal(options.shell, false);
    return Buffer.from(createHash('sha1').update(`blob ${input.length}\0`).update(input).digest('hex') + '\n');
  };
  const before = await legacyTreeInventory(fx.fixture.home);
  const preview = await finalCall(fx, 'POST', '/additions/previews', { machine: 'DESKTOP', source: { kind: 'git', url: 'https://github.com/acme/final-source' }, updateOf: null }, {}, 202);
  await owner.additionJobs.get(preview.id)?.promise;
  const ready = await finalCall(fx, 'GET', `/additions/previews/${preview.id}`);
  assert.equal(ready.state, 'ready'); assert.equal(ready.candidates.filter(item => item.kind === 'skill').length, 2);
  assert.deepEqual(await legacyTreeInventory(fx.fixture.home), before);
  const scope = { everyUnit: false, units: [agent.id], groups: [cluster.id] };
  const acceptance = { machine: 'DESKTOP', previewId: ready.id, selections: ready.candidates.filter(item => item.name === 'pdf' || ['docs', 'repository'].includes(item.kind))
    .map(item => ({ candidateId: item.id, scope: item.kind === 'repository' ? { everyUnit: false, units: [], groups: [] } : scope })),
    expectedContentRevision: ready.contentRevision, expectedProjectRevision: ready.projectRevision, confirmed: true };
  const accepted = await finalCall(fx, 'POST', '/additions', acceptance, {}, 201);
  assert.deepEqual(accepted.items.map(item => [item.kind, item.unitCount]), [['skill', 1], ['docs', 1], ['repository', 0]]);
  const pdf = accepted.items.find(item => item.kind === 'skill');
  assert.equal(await readFile(path.join(fx.fixture.paths.mind, 'user', 'features', 'pdf', 'NOTICE'), 'utf8'), 'Retain this notice\n');
  pin = 'b'.repeat(40);
  const update = await finalCall(fx, 'POST', '/additions/previews', { machine: 'DESKTOP', source: { kind: 'git', url: 'https://github.com/acme/final-source' }, updateOf: pdf.id }, {}, 202);
  await owner.additionJobs.get(update.id)?.promise;
  assert.equal((await finalCall(fx, 'GET', `/additions/previews/${update.id}`)).pin.value, pin);
  assert.equal((await finalCall(fx, 'GET', '/additions?machine=DESKTOP')).items.find(item => item.id === pdf.id).pin.value, 'a'.repeat(40));
  await fx.control.restart();
  const persisted = await finalCall(fx, 'GET', '/additions?machine=DESKTOP');
  assert.equal(persisted.items.length, 3);
  const content = (await finalCall(fx, 'GET', '/settings/content')).features.find(item => item.additionId === pdf.id);
  assert.equal(content.unitCount, 1); assert.equal(content.pin.value, 'a'.repeat(40));
  const repository = accepted.items.find(item => item.kind === 'repository');
  const view = await finalCall(fx, 'GET', '/view');
  const repositoryCluster = view.groups.find(item => item.link.projectId === repository.projectId);
  assert.ok(repositoryCluster); assert.deepEqual(repositoryCluster.members, []); assert.equal(fx.launches.length, 0);
  const removed = await finalCall(fx, 'DELETE', `/additions/${pdf.id}`, { machine: 'DESKTOP', confirmed: true, expectedRevision: persisted.items.find(item => item.id === pdf.id).revision });
  await fx.control.restart();
  assert.equal((await finalCall(fx, 'GET', '/additions?machine=DESKTOP')).items.some(item => item.id === pdf.id), false);
  await finalCall(fx, 'POST', `/changes/${removed.changeId}/undo`, {});
  assert.equal((await finalCall(fx, 'GET', '/additions?machine=DESKTOP')).items.some(item => item.id === pdf.id), true);
  assert.equal(await readFile(path.join(fx.fixture.paths.mind, 'user', 'features', 'pdf', 'NOTICE'), 'utf8'), 'Retain this notice\n');
  assert.deepEqual(await legacyTreeInventory(fx.fixture.home), before);
});

test('an agent started in a repository cluster reports its folder and live branch, and a plan session in it does too', async t => {
  const fx = await createFinalCoreFixture(); t.after(() => fx.close());
  const offer = (await finalCall(fx, 'GET', '/settings/projects?machine=DESKTOP')).discoveryOffer;
  const shop = offer.groups.flatMap(group => group.repositories).find(item => item.name === 'shop');
  const accepted = await finalCall(fx, 'POST', `/discovery/offers/${offer.id}/answer`, { machine: 'DESKTOP', repositoryIds: [shop.id], confirmed: true, expectedRevision: offer.revision });
  const cluster = accepted.clusters.find(item => item.link.kind === 'repository'), unit = await finalAgent(fx, cluster.id);
  const started = await finalCall(fx, 'POST', `/units/${unit.id}/session`, { expectedRevision: unit.revision, prompt: 'Say ok.' }, {}, 202);
  await fx.fixture.store.sessionLaunches?.get(started.requestId);
  const request = await finalCall(fx, 'GET', `/session-requests/${started.requestId}`);
  assert.equal(request.state, 'started');
  const reading = await finalCall(fx, 'GET', `/sessions/${request.sessionId}/checkout`);
  assert.deepEqual([reading.path, reading.kind, reading.branch, reading.head, reading.detached, reading.live], [fx.repositories.shop, 'repository', 'main', 'a'.repeat(40), false, true]);
  assert.match(reading.repositoryId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.ok(fx.repositories.calls.some(call => call.args.includes('--absolute-git-dir')), 'The folder kind comes from Git, not from a guess.');
  const phone = fx.core.credentials.issue({ audience: 'phone', unitId: 'root:master' }).token;
  await finalCall(fx, 'GET', `/sessions/${request.sessionId}/checkout`, undefined, { credential: phone }, 403);
  const stopped = await finalCall(fx, 'POST', `/sessions/${request.sessionId}/stop`, { confirmed: true }, {}, 202);
  assert.equal(stopped.state, 'stopping');
  const last = await finalCall(fx, 'GET', `/sessions/${request.sessionId}/checkout`);
  assert.deepEqual([last.live, last.path, last.branch, last.observedAt], [false, reading.path, 'main', reading.observedAt]);
  await fx.control.restart();
  assert.deepEqual(await finalCall(fx, 'GET', `/sessions/${request.sessionId}/checkout`), last, 'The last reading survives a restart.');
  const lead = await finalAgent(fx, cluster.id, 'overlord');
  await finalCall(fx, 'POST', `/chats/${cluster.chatId}/messages`, { body: 'Plan the shop.' }, {}, 201);
  const taskId = 'root:066', taskFile = path.join(fx.fixture.paths.mind, 'user', 'tasks', '066.md');
  await mkdir(path.dirname(taskFile), { recursive: true });
  await writeFile(taskFile, `id: ${taskId}\ntitle: Shop plan\nstatus: open\nfrom-id: root:master\nto-id: ${lead.id}\nfiles: ["plan.txt"]\n\n## Request\nPlan the shop.\n`);
  const chat = await finalCall(fx, 'GET', `/chats/${cluster.chatId}`), assignment = { kind: 'unit', unitId: lead.id, runsIn: finalChoice };
  const plan = await finalCall(fx, 'POST', '/plans', { clusterId: cluster.id, chatId: cluster.chatId, machine: 'DESKTOP', title: 'Shop plan', branch: 'shop-plan', mode: 'planning',
    tasks: [{ id: taskId, title: 'Shop plan', assignment }], roles: { coordinator: assignment, planner: assignment, builder: assignment, reviewer: assignment }, expectedChatRevision: chat.revision }, {}, 201);
  const run = await finalCall(fx, 'POST', `/plans/${plan.id}/run`, { confirmed: true, expectedRevision: plan.revision }, {}, 202);
  await drainRunLaunches(fx.core.runtime.settingsOwner);
  const attempt = (await finalCall(fx, 'GET', `/runs/${run.runId}`)).attempts[0];
  const planned = await finalCall(fx, 'GET', `/sessions/${attempt.sessionId}/checkout`);
  assert.deepEqual([planned.path, planned.kind, planned.branch, planned.live, planned.repositoryId], [fx.repositories.shop, 'repository', 'main', true, reading.repositoryId]);
});
