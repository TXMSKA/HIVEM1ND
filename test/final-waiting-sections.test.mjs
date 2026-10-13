import assert from 'node:assert/strict';
import test from 'node:test';
import { waitingSections } from '../gui/app/inspector.mjs';

test('Waiting sections separate expired asks from active asks and reviews', () => {
  const ask = { id: 'a', kind: 'approval', state: 'answering' };
  const review = { id: 'b', kind: 'review', state: 'pending' };
  const ended = { id: 'c', kind: 'approval', state: 'expired' };
  assert.deepEqual(waitingSections([ask, review, ended]), [
    { key: 'asks', items: [ask] }, { key: 'reviews', items: [review] }, { key: 'endedWithoutAnswer', items: [ended] },
  ]);
});
