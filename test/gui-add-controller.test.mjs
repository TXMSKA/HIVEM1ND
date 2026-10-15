import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../gui/app/api.mjs';
import { acceptAdd, additionFiles, continueAdd, createAddController, disposeAdd, inspectAdd, retryAdd, scopeAddition, selectAddition, uploadAdd } from '../gui/app/add-controller.mjs';

const previewId = '11111111-1111-4111-8111-111111111111';
const uploadId = '22222222-2222-4222-8222-222222222222';
const candidateId = '33333333-3333-4333-8333-333333333333';
const preview = (kind = 'skill') => ({ id: previewId, state: 'ready', sourceDisplay: 'acme/example', contentRevision: 'a'.repeat(64), projectRevision: null,
  choices: { groups: [{ id: 'parent', title: 'Parent', members: ['root:one', 'root:two'] }], units: [{ id: 'root:one', title: 'one' }] },
  candidates: [{ id: candidateId, name: 'pdf', title: 'pdf', kind, supported: true, check: { eligible: true } }], error: null });
function fixture(respond) {
  const calls = [], jobs = new Map(); let next = 0;
  const api = createApi({ location: { origin: 'http://127.0.0.1:43210' }, fetch: async (url, options) => {
    const call = { path: new URL(url).pathname.replace('/api/v1', ''), method: options.method, key: options.headers['Idempotency-Key'], body: options.body && JSON.parse(options.body) };
    calls.push(call);
    const data = await respond(call, calls.length);
    return new Response(JSON.stringify({ contract: 'hivem1nd-gui-v3', data, meta: { requestId: 'fixture', readAt: '2026-10-15T00:00:00Z', eventCursor: '', sync: 'local' } }), { status: 200 });
  } }); api.token = 'public-fixture';
  const state = { machine: 'DESKTOP' }, accepted = [];
  const controller = createAddController(api, { state, schedule: (action, delay) => { jobs.set(++next, { action, delay }); return next; }, cancel: id => jobs.delete(id), onAccepted: async result => accepted.push(result) });
  return { controller, calls, jobs, accepted };
}

test('source input debounces 300 ms and Enter flushes without a second operation', async t => {
  const { controller, calls, jobs } = fixture(() => preview()); t.after(() => disposeAdd(controller));
  inspectAdd(controller, 'https://example.com/a'); inspectAdd(controller, 'https://example.com/b');
  assert.equal(calls.length, 0); assert.equal(jobs.size, 1); assert.equal([...jobs.values()][0].delay, 300);
  await inspectAdd(controller, 'https://example.com/b', true);
  assert.equal(jobs.size, 0); assert.equal(calls.length, 1); assert.equal(calls[0].body.source.url, 'https://example.com/b');
  assert.deepEqual(controller.model.selected, []);
});
test('Continue rechecks the immutable preview; canonical cluster and direct scope stay explicit', async t => {
  const { controller, calls } = fixture(() => preview()); t.after(() => disposeAdd(controller));
  await inspectAdd(controller, 'https://example.com', true); selectAddition(controller, candidateId, true);
  scopeAddition(controller, candidateId, 'group', 'parent', true); scopeAddition(controller, candidateId, 'unit', 'root:one', true);
  await continueAdd(controller); assert.equal(controller.model.stage, 'check');
  assert.deepEqual(controller.model.scopes[candidateId], { everyUnit: false, units: ['root:one'], groups: ['parent'] });
  assert.deepEqual(calls.map(call => call.method), ['POST', 'GET']);
  scopeAddition(controller, candidateId, 'everyUnit', null, true);
  assert.deepEqual(controller.model.scopes[candidateId], { everyUnit: true, units: [], groups: [] });
});
test('lost acceptance reconciles its original identity and cannot grant an edited selection', async t => {
  const result = { items: [{ title: 'pdf' }] }; let accepted = false;
  const { controller, calls, accepted: outcomes } = fixture(call => {
    if (call.method === 'POST' && call.path === '/additions') { accepted = true; throw new Error('lost response'); }
    return accepted ? { ...preview(), state: 'accepted', result } : preview();
  }); t.after(() => disposeAdd(controller));
  await inspectAdd(controller, 'https://example.com', true); selectAddition(controller, candidateId, true);
  scopeAddition(controller, candidateId, 'unit', 'root:one', true); await continueAdd(controller); await acceptAdd(controller);
  assert.ok(controller.state.operation); selectAddition(controller, candidateId, false); assert.deepEqual(controller.model.selected, [candidateId]);
  await retryAdd(controller);
  assert.equal(calls.filter(call => call.path === '/additions').length, 1); assert.deepEqual(outcomes, [result]);
});
test('zero-agent repository acceptance sends empty scope and creates no agent or session', async t => {
  const { controller, calls } = fixture(call => call.path === '/additions' ? { items: [{ kind: 'repository', projectId: 'pdf' }] } : preview('repository'));
  t.after(() => disposeAdd(controller));
  await inspectAdd(controller, 'https://example.com', true); selectAddition(controller, candidateId, true); await continueAdd(controller); await acceptAdd(controller);
  const request = calls.find(call => call.path === '/additions');
  assert.deepEqual(request.body.selections, [{ candidateId, scope: { everyUnit: false, units: [], groups: [] } }]);
  assert.equal(calls.some(call => /units|session|clusters/.test(call.path)), false);
});
test('folder chunks are ordered, bounded to 64 KiB, and retry the identical failed chunk', async t => {
  let failed = false;
  const { controller, calls } = fixture(call => {
    if (call.path === '/additions/uploads') return { uploadId };
    if (call.method === 'PUT') { if (!failed && call.body.index === 1) { failed = true; throw new Error('lost'); } return {}; }
    return preview();
  }); t.after(() => disposeAdd(controller));
  const blob = new Blob([new Uint8Array(65537)]);
  Object.defineProperty(blob, 'webkitRelativePath', { value: 'folder/SKILL.md' });
  Object.defineProperty(blob, 'path', { get() { throw new Error('File.path must never be read'); } });
  await uploadAdd(controller, { files: [blob] }); assert.ok(controller.state.operation); await retryAdd(controller);
  const chunks = calls.filter(call => call.method === 'PUT');
  assert.deepEqual(chunks.map(call => call.body.index), [0, 1, 1]); assert.equal(chunks[1].key, chunks[2].key);
  assert.deepEqual(chunks[1].body, chunks[2].body); assert.equal(Buffer.from(chunks[0].body.base64, 'base64').length, 65536);
  assert.equal(calls.at(-1).body.source.uploadId, uploadId);
});
test('folder validation rejects traversal, path-only drops, collisions and limits before HTTP', async () => {
  for (const files of [[{ webkitRelativePath: 'folder/../secret', size: 1 }], [{ name: 'secret', path: 'C:/secret', size: 1 }],
    [{ webkitRelativePath: 'folder/SKILL.md', size: 16777217 }], [{ webkitRelativePath: 'folder/a', size: 1 }, { webkitRelativePath: 'folder/A', size: 1 }]]) {
    await assert.rejects(additionFiles({ files }), error => ['invalid_path', 'addition_too_large'].includes(error.code));
  }
});
test('expiry and changed scopes require a new review with retained choices and no implicit acceptance', async t => {
  let expired = true, inspections = 0;
  const { controller, calls } = fixture(call => {
    if (call.method === 'POST') { inspections++; const result = { ...preview(), id: inspections === 1 ? previewId : uploadId };
      if (inspections > 1) result.choices.groups = []; return result; }
    if (expired) { expired = false; const error = new Error('expired'); error.code = 'preview_expired'; error.status = 409; throw error; }
    return preview();
  }); t.after(() => disposeAdd(controller));
  await inspectAdd(controller, 'https://example.com', true); selectAddition(controller, candidateId, true);
  scopeAddition(controller, candidateId, 'unit', 'root:one', true); scopeAddition(controller, candidateId, 'group', 'parent', true); await continueAdd(controller);
  await retryAdd(controller);
  assert.equal(controller.model.stage, 'source'); assert.equal(controller.model.preview.id, uploadId);
  assert.deepEqual(controller.model.selected, [candidateId]); assert.deepEqual(controller.model.scopes[candidateId].units, ['root:one']);
  assert.deepEqual(controller.model.scopes[candidateId].groups, []);
  assert.equal(calls.some(call => call.path === '/additions'), false);
});

test('the polling deadline retains the resolved preview and Retry reads that identity without resolving a new pin', async t => {
  let now = 0;
  const { controller, calls, jobs } = fixture((_call, count) => ({ ...preview(), state: count < 3 ? 'inspecting' : 'ready' }));
  t.after(() => disposeAdd(controller)); controller.api.now = () => now;
  await inspectAdd(controller, 'https://example.com', true);
  const scheduled = [...jobs.values()].at(-1); now = 30000; await scheduled.action();
  assert.equal(controller.model.errorCode, 'source_timeout'); assert.equal(controller.model.busy, false);
  await retryAdd(controller);
  assert.equal(controller.model.preview.id, previewId); assert.equal(controller.model.preview.state, 'ready');
  assert.deepEqual(calls.map(call => call.method), ['POST', 'GET', 'GET']);
});
