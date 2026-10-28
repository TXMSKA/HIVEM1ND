import assert from 'node:assert/strict';
import test from 'node:test';
import { acknowledgeVisible, applyMessageRead, authoredMessages, createThread, incomingMessage, loadMessages, postMessage } from '../gui/app/chats.mjs';
import { createApi, dispose } from '../gui/app/api.mjs';

test('Chat keeps authored Relay messages, deduplicates shared copies and ignores preload and tool records', () => {
  const authored = { id: 'one', channel: 'message', authorId: 'root:master', recipientIds: ['root:agent'], body: 'Please check.' };
  const bootstrap = { ...authored, id: 'boot', channel: 'bootstrap', body: 'Private launch input' };
  const step = { ...authored, id: 'tool', channel: 'work', body: 'Tool output' };
  assert.deepEqual(authoredMessages([authored, bootstrap, step, { ...authored }]), [authored]);
  const thread = createThread({ id: 'chat' });
  for (const message of [authored, bootstrap, step, authored]) incomingMessage(thread, message);
  assert.deepEqual(thread.messages.map(message => message.id), ['one']);
  thread.composer = 'Unsent draft'; thread.anchorId = 'one';
  assert.equal(thread.messages[0].recipientIds[0], 'root:agent');
  assert.equal(thread.composer, 'Unsent draft');
});

test('visible sent lines never infer their recipient acknowledgment', () => {
  const thread = createThread({ id: 'chat' });
  thread.messages = [{ id: 'sent', channel: 'message', authorId: 'root:master', fromId: 'root:master', read: false },
    { id: 'reply', channel: 'message', authorId: 'root:agent', fromId: 'root:agent', read: false }];
  thread.visibleIds = new Set(['sent', 'reply']);
  assert.deepEqual(acknowledgeVisible(thread), ['reply']);
  assert.equal(applyMessageRead(thread, { chatId: 'chat', readerId: 'root:other', messageIds: ['reply'] }), false);
  assert.equal(thread.messages[1].read, false);
  applyMessageRead(thread, { chatId: 'chat', readerId: 'root:master', messageIds: ['reply'] });
  assert.equal(thread.messages[1].read, true);
  assert.equal(thread.messages[0].read, false);
});

test('a late authoritative chat read clears only the confirmed send uncertainty', async t => {
  let finishRead, noteRead;
  const readHeld = new Promise(resolve => { finishRead = resolve; });
  const readStarted = new Promise(resolve => { noteRead = resolve; });
  const sends = [];
  const api = createApi({ location: { origin: 'http://127.0.0.1:9', hash: '' }, fetch: async (_input, init) => {
    if (init.method === 'POST') {
      sends.push({ id: init.headers['Idempotency-Key'], body: JSON.parse(init.body).body });
      throw new Error('The send response was lost.');
    }
    noteRead(); await readHeld;
    const first = sends[0];
    return new Response(JSON.stringify({ contract: 'hivem1nd-gui-v3', data: { items: [{ id: 'committed-first', operationId: first.id, // Compatibility: stored schemas and wire contracts retain their existing identifiers.
      channel: 'message', authorId: 'root:master', body: first.body }], nextCursor: null, total: 1 },
    meta: { requestId: 'fixture-read', readAt: '2026-10-15T00:00:00.000Z', eventCursor: '1', sync: 'local' } }), { status: 200 });
  } });
  api.token = 'fixture-viewer';
  t.after(() => { finishRead(); dispose(api); });
  const thread = createThread({ id: 'chat-one' });
  const reading = loadMessages(api, thread);
  await readStarted;
  await assert.rejects(postMessage(api, thread, { body: 'First message' }), /send response was lost/);
  await assert.rejects(postMessage(api, thread, { body: 'Second message' }), /send response was lost/);
  const [first, second] = sends;
  assert.equal(api.uncertain.size, 2);
  assert.equal(thread.pendingSends.size, 2);
  const retainedSecond = thread.pendingSends.get(second.id);
  thread.composer = 'Keep the next draft';
  finishRead(); await reading;
  assert.equal(api.uncertain.has(first.id), false);
  assert.equal(api.uncertain.has(second.id), true);
  assert.equal(thread.pendingSends.has(first.id), false);
  assert.equal(thread.pendingSends.get(second.id), retainedSecond);
  assert.equal(thread.messages.filter(message => message.operationId === first.id).length, 1);
  assert.equal(thread.messages.find(message => message.operationId === first.id).id, 'committed-first');
  assert.equal(Boolean(thread.messages.find(message => message.operationId === first.id).failed), false);
  assert.equal(thread.composer, 'Keep the next draft');
});
