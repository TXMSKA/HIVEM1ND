import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../gui/app/api.mjs';
import { beginAdditionUpload, sendAdditionChunk, cancelAdditionUpload, inspectAdditionSource, getAdditionPreview, retryAdditionPreview,
  cancelAdditionPreview, acceptAdditions, getAdditions, removeAddition } from '../gui/app/add-api.mjs';
function fixture(statuses = []) {
  const calls = [];
  const api = createApi({ location: { origin: 'http://127.0.0.1:43210' },
    fetch: async (url, options) => {
      calls.push({ path: new URL(url).pathname + new URL(url).search, method: options.method,
        body: options.body == null ? null : JSON.parse(options.body), key: options.headers['Idempotency-Key'] });
      const status = statuses.shift() ?? 200;
      return new Response(JSON.stringify(status < 400 ? { contract: 'hivem1nd-gui-v3', data: { accepted: true }, // Compatibility: stored schemas and wire contracts retain their existing identifiers.
        meta: { requestId: 'fixture-request', readAt: '2026-10-13T12:00:00.000Z', eventCursor: '0', sync: 'local' } }
        : { error: { code: 'source_unavailable', message: 'The source did not answer.' } }),
        { status, headers: { 'Content-Type': 'application/json' } });
    } });
  api.token = 'public-fixture-token';
  return { api, calls };
}
test('Add operations send the exact contract fields and reject unsafe IDs', async () => {
  const { api, calls } = fixture();
  const uploadId = '11111111-1111-4111-8111-111111111111';
  const previewId = '22222222-2222-4222-8222-222222222222';
  const additionId = '33333333-3333-4333-8333-333333333333';
  await assert.rejects(sendAdditionChunk(api, '../foreign', { path: 'docs/a.md', index: 0, total: 1, base64: 'YQ==' }), error => error.code === 'invalid_path');
  await beginAdditionUpload(api, 'DESKTOP', 'folder');
  await sendAdditionChunk(api, uploadId, { path: 'docs/a.md', index: 0, total: 1, base64: 'YQ==' });
  await cancelAdditionUpload(api, uploadId);
  await inspectAdditionSource(api, 'DESKTOP', { kind: 'git', url: 'https://example.com/skills.git' });
  await getAdditionPreview(api, previewId);
  await retryAdditionPreview(api, previewId);
  await cancelAdditionPreview(api, previewId);
  await acceptAdditions(api, { machine: 'DESKTOP', previewId: 'preview', selections: [], expectedContentRevision: null, expectedProjectRevision: null });
  await getAdditions(api, 'DESKTOP');
  await removeAddition(api, 'DESKTOP', additionId, 'revision');
  assert.deepEqual(calls.map(call => [call.method, call.path]), [
    ['POST', '/api/v1/additions/uploads'], ['PUT', '/api/v1/additions/uploads/11111111-1111-4111-8111-111111111111/chunks'],
    ['DELETE', '/api/v1/additions/uploads/11111111-1111-4111-8111-111111111111'], ['POST', '/api/v1/additions/previews'],
    ['GET', '/api/v1/additions/previews/22222222-2222-4222-8222-222222222222'], ['POST', '/api/v1/additions/previews/22222222-2222-4222-8222-222222222222/retry'], ['DELETE', '/api/v1/additions/previews/22222222-2222-4222-8222-222222222222'],
    ['POST', '/api/v1/additions'], ['GET', '/api/v1/additions?machine=DESKTOP'], ['DELETE', '/api/v1/additions/33333333-3333-4333-8333-333333333333'],
  ]);
  assert.deepEqual(calls[3].body, { machine: 'DESKTOP', source: { kind: 'git', url: 'https://example.com/skills.git' }, updateOf: null });
  assert.deepEqual(calls[7].body, { machine: 'DESKTOP', previewId: 'preview', selections: [], expectedContentRevision: null,
    expectedProjectRevision: null, confirmed: true });
  assert.deepEqual(calls[9].body, { machine: 'DESKTOP', confirmed: true, expectedRevision: 'revision' });
  assert.equal(calls[4].key, undefined); assert.equal(calls[8].key, undefined);
});
test('Retry preserves the original Add operation body and idempotency identity', async () => {
  const { api, calls } = fixture([503, 201]);
  const input = { machine: 'DESKTOP', previewId: 'preview', selections: [{ candidateId: 'pdf',
    scope: { everyUnit: false, units: ['root:adjutant'], groups: [] } }], expectedContentRevision: 'before', expectedProjectRevision: null };
  let retained;
  try { await acceptAdditions(api, input); } catch (error) { retained = error.operation; }
  assert.ok(retained); input.selections[0].scope.units = ['root:other'];
  await acceptAdditions(api, input, retained);
  assert.equal(calls[0].key, calls[1].key); assert.deepEqual(calls[0].body, calls[1].body);
  assert.deepEqual(calls[1].body.selections[0].scope.units, ['root:adjutant']);
});
