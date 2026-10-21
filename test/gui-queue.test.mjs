import assert from 'node:assert/strict';
import test from 'node:test';
import { createQueue } from '../gui/app/queue.mjs';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('the queue runs one item at a time, in order, and moves its bar', async () => {
  const order = [], states = [];
  let releaseFirst;
  const queue = createQueue({ onChange: items => states.push(items.map(item => item.state).join(',')) });
  const first = queue.add({ label: 'first', steps: 2, run: async report => { order.push('first:start'); report(1); await new Promise(resolve => { releaseFirst = resolve; }); report(2); order.push('first:end'); return 'one'; } });
  const second = queue.add({ label: 'second', run: async () => { order.push('second'); } });
  await settle();
  assert.equal(first.state, 'running');
  assert.equal(second.state, 'waiting');
  assert.deepEqual(first.progress, { done: 1, total: 2 });
  assert.equal(queue.busy, true);
  releaseFirst();
  await settle(); await settle();
  assert.deepEqual(order, ['first:start', 'first:end', 'second']);
  assert.equal(first.state, 'done'); assert.equal(first.result, 'one'); assert.equal(second.state, 'done');
  assert.equal(queue.busy, false);
  assert.equal(queue.open.length, 0);
  assert.ok(states.some(line => line === 'running,waiting'));
});

test('a failed item keeps its error, does not stop the next one, and retries with the same run', async () => {
  let attempts = 0;
  const done = [];
  const queue = createQueue();
  const failing = queue.add({ label: 'flaky', run: async () => { attempts += 1; if (attempts === 1) throw Object.assign(new Error('lost'), { code: 'timeout' }); return attempts; }, onDone: result => done.push(result) });
  const next = queue.add({ label: 'next', run: async () => 'ok' });
  await settle(); await settle();
  assert.equal(failing.state, 'failed'); assert.equal(failing.error.code, 'timeout');
  assert.equal(next.state, 'done');
  assert.equal(queue.open.length, 1);
  queue.retry(failing.id);
  await settle(); await settle();
  assert.equal(failing.state, 'done'); assert.equal(attempts, 2); assert.deepEqual(done, [2]);
  queue.dismiss(failing.id);
  assert.equal(queue.items.some(item => item.id === failing.id), false);
  queue.clearFinished();
  assert.equal(queue.items.length, 0);
});
