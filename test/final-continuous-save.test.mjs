import assert from 'node:assert/strict';
import test from 'node:test';
import { continuousSave } from '../gui/app/void.mjs';

test('continuous saving preserves typing during an earlier in-flight save', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const editor = continuousSave({ revision: 'first', delayMs: 60000, save: async (value, revision) => {
    calls.push({ value, revision });
    if (calls.length === 1) await gate;
    return { revision: 'revision-' + calls.length };
  } });
  editor.queue('First draft');
  const pending = editor.flush();
  editor.queue('Later draft');
  release();
  await pending;
  assert.deepEqual(calls, [{ value: 'First draft', revision: 'first' }, { value: 'Later draft', revision: 'revision-1' }]);
  assert.equal(editor.dirty, false);
  editor.dispose();
});

test('Retry retains an uncertain save operation while later typing remains queued', async () => {
  const retained = { id: 'same-operation' };
  const calls = [];
  let failed = false;
  const editor = continuousSave({ revision: 'first', delayMs: 60000, save: async (value, revision, operation) => {
    calls.push({ value, revision, operation });
    if (!failed) { failed = true; throw Object.assign(new Error('Unconfirmed'), { operation: retained }); }
    return { revision: 'saved' };
  } });
  editor.queue('Failed draft');
  await assert.rejects(editor.flush());
  editor.queue('Later draft');
  await editor.retry();
  assert.equal(calls[1].operation, retained);
  assert.equal(calls[1].value, 'Failed draft');
  assert.equal(calls[2].value, 'Later draft');
  assert.equal(calls[2].revision, 'saved');
  assert.equal(editor.dirty, false);
  editor.dispose();
});
