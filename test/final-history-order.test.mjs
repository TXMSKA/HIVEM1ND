import assert from 'node:assert/strict';
import test from 'node:test';
import { historyOperationKey, newestHistory } from '../gui/app/editors.mjs';

test('History sorts snapshots newest first without mutating the source', () => {
  const items = [{ id: 'a', at: '2026-10-13T00:00:00.000Z' }, { id: 'b', at: '2026-10-13T01:00:00.000Z' }];
  assert.deepEqual(newestHistory(items).map((item) => item.id), ['b', 'a']);
  assert.deepEqual(items.map((item) => item.id), ['a', 'b']);
  assert.equal(historyOperationKey('comment'), 'historyCommentAdded');
  assert.equal(historyOperationKey('unknown-legacy-change'), 'historyChanged');
  assert.equal(historyOperationKey('toString'), 'historyChanged');
});
