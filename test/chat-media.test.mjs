import './relay-local-state.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createChat, postChat, postChatAsset, readChatAsset } from '../engine/service/chats.mjs';
import { messagePart } from '../engine/service/message-parts.mjs';
import { openLedger } from '../engine/sync/limits.mjs';
import { createRelay } from '../engine/relay/store.mjs';
import { validateToolArguments } from '../engine/relay/mcp.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const ASSET = '0b1f6c1e-6f4e-4a4b-9a4c-2f1d3c5b7a90.png';
const BOARD = '6b1d2c3e-4f5a-8b6c-9d7e-0f1a2b3c4d5e';

function fail(reason) {
  throw Object.assign(new Error(reason), { code: 'invalid' });
}

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
  const context = { store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, ledger,
    principal: { stableId: 'desktop', audience: 'desktop', unitId: 'root:master' } };
  return { fixture, context };
}

test('message parts keep the five kinds strict and every other reference as it was', () => {
  assert.deepEqual(messagePart({ kind: 'image', path: ASSET, label: '  Checkout  ' }, fail), { kind: 'image', path: ASSET, label: 'Checkout' });
  assert.deepEqual(messagePart({ kind: 'link', path: 'https://github.com/TXMSKA/HIVEM1ND/pull/61', label: '' }, fail), { kind: 'link', path: 'https://github.com/TXMSKA/HIVEM1ND/pull/61' }); // Compatibility: repository URLs retain their existing hosting location.
  assert.deepEqual(messagePart({ kind: 'link', path: 'mailto:team@example.com' }, fail), { kind: 'link', path: 'mailto:team@example.com' });
  assert.deepEqual(messagePart({ kind: 'board', path: BOARD }, fail), { kind: 'board', path: BOARD });
  assert.deepEqual(messagePart({ kind: 'task', path: 'project:shop:029' }, fail), { kind: 'task', path: 'project:shop:029' });
  assert.deepEqual(messagePart({ kind: 'task', path: 'root:7' }, fail), { kind: 'task', path: 'root:7' });
  assert.deepEqual(messagePart({ path: 'docs/flows/comments/checkout.json' }, fail), { path: 'docs/flows/comments/checkout.json', kind: null });
  assert.deepEqual(messagePart({ path: 'docs/a.md', kind: 'blueprint-comments' }, fail), { path: 'docs/a.md', kind: 'blueprint-comments' });
  assert.deepEqual(messagePart({ path: 'user/projects/shop/tasks/029.md', kind: 'task' }, fail), { path: 'user/projects/shop/tasks/029.md', kind: 'task' }, 'an older task reference names its file');
  for (const bad of [
    { kind: 'image', path: 'shot.png' },
    { kind: 'image', path: `../${ASSET}` },
    { kind: 'link', path: 'javascript:alert(1)' },
    { kind: 'link', path: 'https://user@evil.example/' },
    { kind: 'link', path: 'https://example.com/a b' },
    { kind: 'link', path: 'file:///C:/secret.txt' },
    { kind: 'board', path: 'checkout' },
    { kind: 'text', path: `${BOARD}x` },
    { kind: 'link', path: 'https://example.com', label: 'x'.repeat(121) },
    { kind: 'link', path: 'https://example.com', label: 'two\nlines' },
    { kind: 7, path: 'docs/a.md' },
    { path: '' },
    'docs/a.md',
  ]) assert.throws(() => messagePart(bad, fail), { code: 'invalid' }, JSON.stringify(bad));
});

test('a chat picture is uploaded, sent and read only through a chat that shows it', async (t) => {
  const { fixture, context } = await world(t);
  const chat = (await createChat(context, { members: ['project:shop:executor-shop'] })).chat;
  const other = (await createChat(context, { members: ['env:web:overlord-web'] })).chat;
  const asset = await postChatAsset(context, chat.id, { contentType: 'image/png', bytesBase64: PNG.toString('base64') });
  assert.match(asset.id, /^[0-9a-f-]{36}\.png$/);
  assert.deepEqual({ ...asset, id: null }, { id: null, contentType: 'image/png', bytes: PNG.length, width: 1, height: 1, url: `/api/v1/chats/${chat.id}/assets/${asset.id}` });
  assert.deepEqual(await readFile(path.join(fixture.paths.mind, 'user', 'relay', 'assets', asset.id)), PNG);
  await assert.rejects(readChatAsset(context, chat.id, asset.id), { code: 'not_found' }, 'a picture no message shows is not served');

  const parts = [{ kind: 'image', path: asset.id, label: 'Checkout' }, { kind: 'link', path: 'https://example.com/pr/1', label: 'Pull request' },
    { kind: 'board', path: BOARD }, { kind: 'task', path: 'project:shop:029' }];
  const posted = await postChat(context, chat.id, { body: '', attachments: parts });
  assert.deepEqual(posted.message.attachments, parts);
  const read = await readChatAsset(context, chat.id, asset.id);
  assert.equal(read.type, 'image/png');
  assert.deepEqual(read.bytes, PNG);
  await assert.rejects(readChatAsset(context, other.id, asset.id), { code: 'not_found' }, 'another chat does not serve it');
  await assert.rejects(readChatAsset(context, chat.id, '../secret.png'), { code: 'not_found' });

  await assert.rejects(postChat(context, chat.id, { body: 'x', attachments: [{ kind: 'image', path: ASSET }] }), { code: 'unknown_asset' });
  await assert.rejects(postChat(context, chat.id, { body: 'x', attachments: [{ kind: 'link', path: 'javascript:alert(1)' }] }), { code: 'invalid_body' });
  await assert.rejects(postChatAsset(context, chat.id, { contentType: 'image/gif', bytesBase64: PNG.toString('base64') }), { code: 'invalid_asset' });
  await assert.rejects(postChatAsset(context, chat.id, { contentType: 'image/jpeg', bytesBase64: PNG.toString('base64') }), { code: 'invalid_asset' }, 'the bytes must be the type they claim');
  await assert.rejects(postChatAsset(context, chat.id, { contentType: 'image/png', bytesBase64: Buffer.from('<svg/>').toString('base64') }), { code: 'invalid_asset' });
  await assert.rejects(postChatAsset(context, chat.id, { contentType: 'image/png', bytesBase64: 'not base64!' }), { code: 'invalid_asset' });

  const phone = { ...context, principal: { stableId: 'phone', audience: 'phone', unitId: 'root:master' } };
  assert.match((await postChatAsset(phone, chat.id, { contentType: 'image/png', bytesBase64: PNG.toString('base64') })).id, /\.png$/);
  const stranger = { ...context, principal: { stableId: 'agent', audience: 'agent', unitId: 'env:web:overlord-web' } };
  await assert.rejects(postChatAsset(stranger, chat.id, { contentType: 'image/png', bytesBase64: PNG.toString('base64') }), { code: 'not_chat_member' });
});

test('a picture an agent sent to the person shows in their direct chat', async (t) => {
  const { fixture, context } = await world(t);
  const chat = (await createChat(context, { members: ['project:shop:executor-shop'] })).chat;
  const id = `${randomUUID()}.png`;
  const assets = path.join(fixture.paths.mind, 'user', 'relay', 'assets');
  await mkdir(assets, { recursive: true });
  await writeFile(path.join(assets, id), PNG);
  const inbox = path.join(fixture.paths.mind, 'user', 'inbox', 'master');
  await mkdir(inbox, { recursive: true });
  const messageId = randomUUID();
  await writeFile(path.join(inbox, `20261020-120000-DESKTOP-${messageId}.md`), [
    `id: ${messageId}`, 'from: executor-shop', 'to: master', 'machine: DESKTOP', 'timestamp: 2026-10-20T12:00:00.000Z',
    'priority: normal', 'subject: Screens', `thread-id: ${messageId}`, 'reply-to: ', 'reply-requested: false',
    `attachments: ${JSON.stringify([{ path: id, kind: 'image', label: 'Checkout' }])}`, '', 'The checkout screens.'].join('\n'));
  const read = await readChatAsset(context, chat.id, id);
  assert.deepEqual(read.bytes, PNG);
});

async function relayWorld(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'onem1nd-chat-media-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const mind = path.join(root, 'mind');
  await mkdir(path.join(mind, 'user', 'projects', 'alpha', 'state'), { recursive: true });
  await mkdir(path.join(mind, 'user', 'projects', 'beta', 'state'), { recursive: true });
  await writeFile(path.join(mind, 'user', 'routes.md'), '## Projects\n- alpha\n- beta\n');
  await writeFile(path.join(mind, 'user', 'projects', 'alpha', 'state', 'executor-alpha.md'), 'unit: executor-alpha\nstate: in\nmachine: TESTBOX\n\nWorking.\n');
  await writeFile(path.join(mind, 'user', 'projects', 'beta', 'state', 'executor-beta.md'), 'unit: executor-beta\nstate: in\nmachine: TESTBOX\n\nWorking.\n');
  const bind = async (unit) => {
    const relay = await createRelay({ mindPath: mind, hostname: 'TESTBOX', sessionId: `${unit}-session`, client: 'codex' });
    await relay.register({ unit, nativeSessionId: `${unit}-native` });
    return relay;
  };
  return { root, mind, alice: await bind('executor-alpha'), bob: await bind('executor-beta') };
}

test('an agent sends a picture from a file and buttons through Relay, and the picture is kept as a copy', async (context) => {
  const { root, mind, alice, bob } = await relayWorld(context);
  const shot = path.join(root, 'shot.png');
  await writeFile(shot, PNG);
  await alice.send({ to: 'executor-beta', subject: 'Screens', body: 'Done.', attachments: [
    { kind: 'image', path: shot, label: 'Checkout' }, { kind: 'link', path: 'https://example.com/pr/1' }, { kind: 'task', path: 'project:beta:004', label: 'Release' }, 'docs/notes.md'] });
  const assets = path.join(mind, 'user', 'relay', 'assets');
  const [stored] = await readdir(assets);
  assert.match(stored, /^[0-9a-f-]{36}\.png$/);
  assert.deepEqual(await readFile(path.join(assets, stored)), PNG);
  const [message] = (await bob.read({})).messages;
  assert.deepEqual(message.attachments, [{ path: stored, kind: 'image', label: 'Checkout' }, { path: 'https://example.com/pr/1', kind: 'link' },
    { path: 'project:beta:004', kind: 'task', label: 'Release' }, 'docs/notes.md']);
  await alice.send({ to: 'executor-beta', subject: 'Again', body: 'The same picture.', attachments: [{ kind: 'image', path: stored }] });
  assert.equal((await readdir(assets)).length, 1, 'a stored picture is named, not copied again');

  const text = path.join(root, 'notes.txt');
  await writeFile(text, 'not a picture');
  for (const attachments of [[{ kind: 'image', path: 'shot.png' }], [{ kind: 'image', path: text }], [{ kind: 'image', path: path.join(root, 'missing.png') }],
    [{ kind: 'image', path: ASSET }], [{ kind: 'link', path: 'https://example.com/a/../b' }], [{ kind: 'link', path: 'javascript:alert(1)' }],
    [{ kind: 'image', path: shot, label: 'x'.repeat(121) }]]) {
    await assert.rejects(alice.send({ to: 'executor-beta', subject: 'Bad', body: '', attachments }), { code: 'INVALID_ATTACHMENTS' }, JSON.stringify(attachments));
  }
  await assert.rejects(alice.send({ to: 'executor-beta', subject: 'Reply', body: '', replyTo: 'missing-message', attachments: [{ kind: 'image', path: shot }] }), { code: 'UNKNOWN_REPLY' });
  assert.equal((await readdir(assets)).length, 1, 'a refused message copies nothing');
});

test('the send_message schema lets parts through and refuses what is not a part', async () => {
  const call = (attachments) => validateToolArguments('send_message', { to: 'executor-beta', subject: 's', body: 'b', attachments });
  await call(['docs/notes.md', { kind: 'image', path: 'C:\\shots\\checkout.png', label: 'Checkout' }, { kind: 'link', path: 'https://example.com' }]);
  await assert.rejects(call([42]), { code: 'INVALID_ARGUMENTS' });
  await assert.rejects(call([['nested']]), { code: 'INVALID_ARGUMENTS' });
  await assert.rejects(call(['a'.repeat(2049)]), { code: 'INVALID_ARGUMENTS' });
});
