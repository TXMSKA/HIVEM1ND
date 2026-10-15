import assert from 'node:assert/strict';
import test from 'node:test';
import { acknowledgeVisible, applyMessageRead, authoredMessages, createThread, incomingMessage } from '../gui/app/chats.mjs';

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
