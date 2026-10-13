import assert from 'node:assert/strict';
import test from 'node:test';
import { sentLineState } from '../gui/app/chats.mjs';

test('sent-line state never turns local storage or own read into delivery', () => {
  assert.deepEqual(sentLineState({ read: true }), { key: 'storedReceipt', at: null });
  assert.deepEqual(sentLineState({ pending: true }), { key: 'sending', at: null });
  assert.deepEqual(sentLineState({ pending: true, failed: true }), { key: 'notConfirmed', at: null });
  assert.deepEqual(sentLineState({ delivery: { state: 'delivered', deliveredAt: 'time' } }), { key: 'deliveredReceipt', at: 'time' });
  assert.deepEqual(sentLineState({ delivery: { state: 'read', readAt: 'later' } }), { key: 'readReceipt', at: 'later' });
});
