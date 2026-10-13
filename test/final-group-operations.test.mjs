import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../gui/app/api.mjs';
import { createGroup, removeGroup, undoChange } from '../gui/app/actions.mjs';

test('group writes carry exact bodies and deletion undo uses its own route', async () => {
  const calls = [];
  const api = createApi({ location: { origin: 'http://127.0.0.1:12345', hash: '#session=fixture' }, history: { replaceState() {} },
    fetch: async (url, options) => {
      calls.push({ url, method: options.method, body: JSON.parse(options.body), key: options.headers['Idempotency-Key'] });
      return new Response(JSON.stringify({ contract: 'hivem1nd-gui-v3', data: {}, meta: { requestId: 'fixture', readAt: '2026-10-13T00:00:00.000Z', eventCursor: 'fixture:1', sync: 'local' } }), { status: 200 });
    } });
  await createGroup(api, 'Checkout launch', ['root:executor-shop']);
  await removeGroup(api, { id: '11111111-1111-4111-8111-111111111111', revision: 'a'.repeat(64) });
  await undoChange(api, '22222222-2222-4222-8222-222222222222');
  assert.deepEqual(calls[0].body, { title: 'Checkout launch', members: ['root:executor-shop'] });
  assert.deepEqual(calls[1].body, { confirmed: true, expectedRevision: 'a'.repeat(64) });
  assert.deepEqual(calls[2].body, {});
  assert.ok(calls[2].url.endsWith('/changes/22222222-2222-4222-8222-222222222222/undo'));
  assert.equal(new Set(calls.map((call) => call.key)).size, 3);
});
