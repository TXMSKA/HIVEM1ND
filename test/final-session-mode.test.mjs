import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../gui/app/api.mjs';
import { startSession } from '../gui/app/actions.mjs';

test('session operations keep mode task and revision through retries', async () => {
  const bodies = [];
  const api = createApi({ location: { origin: 'http://127.0.0.1:12345', hash: '#session=fixture' }, history: { replaceState() {} },
    fetch: async (url, options) => { bodies.push(JSON.parse(options.body)); return new Response(JSON.stringify({ contract: 'hivem1nd-gui-v3', data: { state: 'queued' }, meta: { requestId: 'fixture', readAt: '2026-10-13T00:00:00.000Z', eventCursor: 'fixture:1', sync: 'local' } }), { status: 202 }); } });
  const unit = { id: 'root:executor-shop', revision: 'a'.repeat(64) };
  const first = await startSession(api, unit, 'codex', 'Finish the task', null, { runMode: 'task', taskId: 'project:shop:029' });
  await startSession(api, unit, 'codex', 'Changed input', first.operation, { runMode: 'chat' });
  assert.deepEqual(bodies[0], { prompt: 'Finish the task', runMode: 'task', taskId: 'project:shop:029', expectedRevision: 'a'.repeat(64) });
  assert.deepEqual(bodies[1], bodies[0]);
});
