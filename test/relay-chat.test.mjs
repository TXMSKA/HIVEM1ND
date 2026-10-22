import './relay-local-state.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRelay, queueChatNotice } from '../engine/relay/store.mjs';
import { makeRelayMind } from './relay-test-fixture.mjs';

const CHAT = '0b3e5c1a-1111-8222-9333-444455556666';

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-chat-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const mindPath = await makeRelayMind(root);
  const chat = path.join(mindPath, 'user', 'relay', 'chats', CHAT);
  await mkdir(chat, { recursive: true });
  await writeFile(path.join(chat, 'chat.md'), `id: ${CHAT}\ntitle: overseer\nmembers: ["root:master","root:overseer"]\npinned: false\nlisted: true\ncreated: 2026-10-20T18:10:17.575Z\ncreated-by: root:master\nkind: direct\n\n`);
  return { mindPath, chat };
}

test('a chat message of the app reaches the agent inbox, and the agent answers into the chat', async (context) => {
  const { mindPath, chat } = await fixture(context);
  const relay = await createRelay({ mindPath, hostname: os.hostname(), sessionId: 'chat-session', client: 'claude' });
  await relay.register({ unit: 'overseer', nativeSessionId: 'native-chat' });
  const notice = { recipientId: 'root:overseer', chatId: CHAT, chatTitle: 'overseer', messageId: '87df1be8-23e9-4153-9c48-ba0e449b82bb',
    fromUnit: 'master', subject: '', body: 'Hola', attachments: [], priority: 'normal', at: '2026-10-20T18:10:18.777Z' };
  assert.deepEqual(await queueChatNotice({ paths: { mind: mindPath, machine: os.hostname() } }, notice), { state: 'submitted' });
  // Delivering the same chat message again writes nothing new.
  await queueChatNotice({ paths: { mind: mindPath, machine: os.hostname() } }, notice);
  const listed = await relay.inbox({});
  assert.equal(listed.messages.length, 1);
  const read = await relay.read({});
  assert.equal(read.messages.length, 1);
  assert.match(read.messages[0].body, /^Hola/);
  assert.match(read.messages[0].body, new RegExp(`send_message to "chat:${CHAT}"`));
  assert.equal(read.messages[0].from, 'master');
  // Reading the copy leaves the agent's read receipt in the chat, in the form the service reads.
  const readerDir = path.join(chat, 'read', Buffer.from('root:overseer').toString('base64url'), os.hostname());
  const receipts = await readdir(readerDir);
  assert.equal(receipts.length, 1);
  const receipt = JSON.parse(await readFile(path.join(readerDir, receipts[0]), 'utf8'));
  assert.deepEqual(receipt.messageIds, [notice.messageId]);
  assert.equal(receipt.unitId, 'root:overseer');

  const sent = await relay.send({ to: `chat:${CHAT}`, subject: '', body: 'OK' });
  assert.equal(sent.to, `chat:${CHAT}`);
  const written = (await readdir(chat)).filter((name) => name.endsWith('.md') && name !== 'chat.md');
  assert.deepEqual(written, [`${sent.id}.md`]);
  const bytes = await readFile(path.join(chat, written[0]), 'utf8');
  assert.match(bytes, /^from-id: root:overseer$/m);
  assert.match(bytes, new RegExp(`^to-id: chat:${CHAT}$`, 'm'));
  assert.match(bytes, /^recipient-ids: \["root:master"\]$/m);
  assert.ok(bytes.endsWith('\n\nOK'));

  await assert.rejects(relay.send({ to: 'chat:0b3e5c1a-1111-8222-9333-000000000000', subject: '', body: 'Nobody' }), { code: 'UNKNOWN_CHAT' });
});

test('an agent that is not a member of the chat cannot write into it', async (context) => {
  const { mindPath } = await fixture(context);
  const relay = await createRelay({ mindPath, hostname: os.hostname(), sessionId: 'outsider', client: 'claude' });
  await relay.register({ unit: 'executor', nativeSessionId: 'native-outsider' }).catch(() => null);
  await assert.rejects(relay.send({ to: `chat:${CHAT}`, subject: '', body: 'Hi' }), (error) => ['NOT_CHAT_MEMBER', 'NOT_REGISTERED', 'UNKNOWN_UNIT'].includes(error.code));
});
