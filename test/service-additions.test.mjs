import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { cancelAdditionPreview, closeAdditionJobs, inspectAddition, openAdditionUpload, readAdditionPreview, retryAdditionPreview, writeAdditionChunk } from '../engine/service/additions.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { createGroup } from '../engine/service/groups.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';
import { createGuiFixture } from './gui-fixture.mjs';

async function hashes(root) {
  const result = {};
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else result[path.relative(root, file)] = hashBytes(await readFile(file));
    }
  }
  await visit(root); return result;
}
async function setup(t) {
  const fixture = await makeCoreFixture();
  const context = { ...fixture, now: () => fixture.clock.now, principal: { audience: 'desktop', unitId: 'root:master', stableId: randomUUID() } };
  context.additionOwner = context;
  t.after(async () => { await closeAdditionJobs(context); await dispose(fixture); });
  const client = path.join(fixture.home, 'client.json'), source = path.join(fixture.root, 'source');
  await mkdir(source); await writeFile(client, '{"foreign":"preserved"}'); await writeFile(path.join(source, 'SKILL.md'), 'Original source');
  const unchanged = async () => ({ mind: await hashes(fixture.paths.mind), client: hashBytes(await readFile(client)), source: await hashes(source) });
  return { fixture, context, unchanged };
}
async function folder(context, { name = 'folder', text = '---\nname: pdf\ndescription: PDF skill\nruntime: none\n---\n# PDF\n' } = {}) {
  const upload = await openAdditionUpload(context, { machine: context.paths.machine, name });
  for (const [relative, data] of [['SKILL.md', text], ['LICENSE', 'MIT License'], ['image.png', Buffer.from([0, 255, 128])]]) {
    await writeAdditionChunk(context, upload.uploadId, { path: relative, index: 0, total: 1, base64: Buffer.from(data).toString('base64') });
  }
  return { upload, input: { machine: context.paths.machine, source: { kind: 'folder', uploadId: upload.uploadId }, updateOf: null } };
}
async function settle(context, id) {
  await context.additionOwner.additionJobs.get(id)?.promise;
  return readAdditionPreview(context, id);
}

test('uploads produce an asynchronous owner-bound preview without altering M1ND client or source bytes', async t => {
  const { context, unchanged } = await setup(t), before = await unchanged();
  const { input, upload } = await folder(context);
  const preview = await inspectAddition(context, input);
  assert.equal(preview.state, 'inspecting'); assert.deepEqual(preview.candidates, []);
  const ready = await settle(context, preview.id);
  assert.equal(ready.state, 'ready'); assert.equal(ready.id, preview.id); assert.equal(ready.pin.kind, 'snapshot');
  assert.equal(ready.candidates[0].check.age.ok, false); assert.equal(ready.candidates[0].check.age.publishedAt, null);
  assert.equal(ready.candidates[0].check.runtime.verified, true);
  assert.equal(ready.scopeRevision.length, 64); assert.deepEqual(ready.choices, { units: [], groups: [] });
  await assert.rejects(writeAdditionChunk(context, upload.uploadId, { path: 'new.txt', index: 0, total: 1, base64: '' }), { code: 'source_changed' });
  await cancelAdditionPreview(context, preview.id);
  await assert.rejects(readAdditionPreview(context, preview.id), { code: 'preview_not_found' });
  await assert.rejects(access(path.join(context.paths.localDirectory, 'additions', 'sources', preview.id)), { code: 'ENOENT' });
  assert.deepEqual(await unchanged(), before);
});

test('repeating an initial operation after a lost receipt retains upload and preview identity', async t => {
  const { context, unchanged } = await setup(t), before = await unchanged();
  const principalHash = hashBytes(Buffer.from(context.principal.stableId));
  context.receipt = { key: randomUUID(), principalHash, bodyHash: hashBytes(Buffer.from('upload request')) };
  const firstUpload = await openAdditionUpload(context, { machine: context.paths.machine, name: 'folder' });
  assert.deepEqual(await openAdditionUpload(context, { machine: context.paths.machine, name: 'folder' }), firstUpload);
  context.receipt = null;
  await writeAdditionChunk(context, firstUpload.uploadId, { path: 'SKILL.md', index: 0, total: 1, base64: Buffer.from('---\nname: pdf\nruntime: none\n---\n').toString('base64') });
  context.receipt = { key: randomUUID(), principalHash, bodyHash: hashBytes(Buffer.from('inspect request')) };
  const input = { machine: context.paths.machine, source: { kind: 'folder', uploadId: firstUpload.uploadId }, updateOf: null };
  const preview = await inspectAddition(context, input);
  const replay = await inspectAddition(context, input); assert.equal(replay.id, preview.id);
  const ready = await settle(context, preview.id);
  assert.deepEqual(await inspectAddition(context, input), ready);
  context.receipt = { ...context.receipt, bodyHash: hashBytes(Buffer.from('different request')) };
  await assert.rejects(inspectAddition(context, input), { code: 'idempotency_conflict' });
  context.receipt = null;
  await cancelAdditionPreview(context, preview.id); await cancelAdditionPreview(context, preview.id);
  assert.deepEqual(await unchanged(), before);
});

test('private choices and scope revision come from canonical alias group and member records', async t => {
  const { context } = await setup(t);
  await mkdir(path.join(context.paths.mind, 'user', 'state'), { recursive: true });
  for (const unit of ['one', 'two']) await writeFile(path.join(context.paths.mind, 'user', 'state', `${unit}.md`), `unit: ${unit}\nunit-id: root:${unit}\nrole: executor\nstate: out\nlead-id: root:overseer\n`);
  const one = { id: 'root:one' }, two = { id: 'root:two' };
  const group = await createGroup(context, { title: 'Working cluster', members: [one.id, two.id] });
  const { input } = await folder(context), preview = await inspectAddition(context, input);
  assert.deepEqual(preview.choices.units.map(item => item.id), [one.id, two.id]);
  assert.deepEqual(preview.choices.groups, [{ id: group.id, title: group.title, members: [one.id, two.id] }]);
  const record = JSON.parse(await readFile(path.join(context.paths.localDirectory, 'additions', 'previews', `${preview.id}.json`)));
  assert.deepEqual(record.scopeSnapshot, preview.choices);
  await settle(context, preview.id);
});

test('wrong principal audience owner and selected offline machine fail before acquisition and receipt lookup', async t => {
  const { context, unchanged } = await setup(t), before = await unchanged();
  const { input, upload } = await folder(context), preview = await inspectAddition(context, input);
  await settle(context, preview.id);
  for (const principal of [{ ...context.principal, stableId: randomUUID() }, { ...context.principal, audience: 'phone' }, { ...context.principal, audience: 'agent' }]) {
    const other = { ...context, principal };
    await assert.rejects(readAdditionPreview(other, preview.id), { code: 'forbidden' });
    await assert.rejects(writeAdditionChunk(other, upload.uploadId, { path: 'a.txt', index: 0, total: 1, base64: '' }), { code: 'forbidden' });
  }
  await assert.rejects(readAdditionPreview({ ...context, paths: { ...context.paths, mindKey: 'other' } }, preview.id), { code: 'forbidden' });
  await assert.rejects(readAdditionPreview({ ...context, paths: { ...context.paths, machine: 'OTHER' } }, preview.id), { code: 'forbidden' });
  await assert.rejects(inspectAddition(context, { ...input, machine: 'OFFLINE' }), { code: 'machine_unavailable' });
  assert.deepEqual(await unchanged(), before);
});
test('unknown fields absolute HTTP folder paths and incomplete source snapshots cannot enter recognition', async t => {
  const { context, unchanged } = await setup(t), before = await unchanged();
  await assert.rejects(openAdditionUpload(context, { machine: context.paths.machine, name: 'folder', path: 'C:/source' }), { code: 'unknown_field' });
  const { input } = await folder(context);
  for (const source of [{ kind: 'folder', path: 'C:/source' }, { ...input.source, path: 'C:/source' }, { ...input.source, filePath: 'C:/source' }]) {
    await assert.rejects(inspectAddition(context, { ...input, source }), error => ['unknown_field', 'invalid_source'].includes(error.code));
  }
  await assert.rejects(inspectAddition(context, { ...input, extra: true }), { code: 'unknown_field' });
  const upload = await openAdditionUpload(context, { machine: context.paths.machine, name: 'interrupted' });
  await writeAdditionChunk(context, upload.uploadId, { path: 'SKILL.md', index: 0, total: 2, base64: Buffer.alloc(65536).toString('base64') });
  const preview = await inspectAddition(context, { ...input, source: { kind: 'folder', uploadId: upload.uploadId } });
  const failed = await settle(context, preview.id);
  assert.equal(failed.state, 'failed'); assert.deepEqual(failed.candidates, []); assert.equal(failed.error.code, 'source_changed');
  assert.deepEqual(await unchanged(), before);
});
test('failed inspections use safe diagnostics and retry the same preview without changing the resolved commit', async t => {
  const { context, unchanged } = await setup(t), before = await unchanged();
  const immutable = 'b'.repeat(40), resolved = [], privateMessage = `private-${randomUUID()}`;
  context.additionLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  context.additionTransport = async url => {
    resolved.push(url.pathname);
    if (url.pathname.includes('/commits/')) return { status: 200, bytes: Buffer.from(JSON.stringify({ sha: immutable, commit: { committer: { date: '2026-10-01T00:00:00.000Z' } } })) };
    throw new Error(privateMessage);
  };
  const preview = await inspectAddition(context, { machine: context.paths.machine, source: { kind: 'link', url: 'https://github.com/acme/example' }, updateOf: null });
  const failed = await settle(context, preview.id);
  assert.equal(failed.state, 'failed'); assert.equal(failed.error.code, 'source_unavailable');
  assert.equal(JSON.stringify(failed).includes(privateMessage), false);
  const firstRecord = JSON.parse(await readFile(path.join(context.paths.localDirectory, 'additions', 'previews', `${preview.id}.json`)));
  const retried = await retryAdditionPreview(context, preview.id);
  assert.equal(retried.id, preview.id); assert.equal(retried.state, 'inspecting');
  const duplicate = await retryAdditionPreview(context, preview.id); assert.equal(duplicate.id, preview.id);
  await settle(context, preview.id);
  assert.equal(resolved.filter(value => value.includes(`/commits/${immutable}`)).length, 1);
  const secondRecord = JSON.parse(await readFile(path.join(context.paths.localDirectory, 'additions', 'previews', `${preview.id}.json`)));
  assert.notEqual(secondRecord.attemptId, firstRecord.attemptId); assert.equal(secondRecord.resolvedPin.value, immutable);
  await cancelAdditionPreview(context, preview.id); assert.deepEqual(await unchanged(), before);
});
test('canceling an in-flight job aborts transport and prevents late preview publication', async t => {
  const { context, unchanged } = await setup(t), before = await unchanged(); let observed;
  context.additionLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  context.additionTransport = async (_url, { signal }) => { observed = signal; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); };
  const preview = await inspectAddition(context, { machine: context.paths.machine, source: { kind: 'git', url: 'https://github.com/acme/example' }, updateOf: null });
  while (!observed) await new Promise(resolve => setImmediate(resolve));
  await cancelAdditionPreview(context, preview.id); await context.additionJobs.get(preview.id)?.promise;
  assert.equal(observed.aborted, true);
  await assert.rejects(readAdditionPreview(context, preview.id), { code: 'preview_not_found' });
  assert.deepEqual(await unchanged(), before);
});
test('15-minute expiry disposes unaccepted resources while consumed bindings survive 24 hours', async t => {
  const { context, fixture, unchanged } = await setup(t), before = await unchanged();
  const one = await folder(context), first = await inspectAddition(context, one.input); await settle(context, first.id);
  const two = await folder(context), accepted = await inspectAddition(context, two.input); await settle(context, accepted.id);
  const file = path.join(context.paths.localDirectory, 'additions', 'previews', `${accepted.id}.json`);
  const record = JSON.parse(await readFile(file));
  record.preview.state = 'accepted'; record.preview.result = { items: [], changeId: randomUUID(), undoUntil: null, contentRevision: null, projectRevision: null };
  record.acceptedAt = context.now(); record.retainedUntil = context.now() + 86400000;
  record.acceptance = { requestId: randomUUID(), hash: hashBytes(Buffer.from('consumed')), ownerHash: record.ownerHash, result: record.preview.result };
  await writeFile(file, JSON.stringify(record));
  fixture.clock.now += 900000;
  await assert.rejects(readAdditionPreview(context, first.id), { code: 'preview_expired' });
  await assert.rejects(retryAdditionPreview(context, first.id), { code: 'preview_expired' });
  await assert.rejects(writeAdditionChunk(context, one.upload.uploadId, { path: 'new', index: 0, total: 1, base64: '' }), { code: 'preview_expired' });
  assert.equal((await readAdditionPreview(context, accepted.id)).state, 'accepted');
  await cancelAdditionPreview(context, accepted.id);
  assert.deepEqual((await readAdditionPreview(context, accepted.id)).result, record.preview.result);
  assert.deepEqual(JSON.parse(await readFile(file)).acceptance, record.acceptance);
  fixture.clock.now = record.retainedUntil;
  await assert.rejects(readAdditionPreview(context, accepted.id), { code: 'preview_expired' });
  assert.deepEqual(await unchanged(), before);
});
test('an update binds kind name and origin and keeps prior accepted bytes active during review', async t => {
  const { context, unchanged } = await setup(t);
  const id = randomUUID();
  await mkdir(path.join(context.paths.mind, 'user', 'additions'), { recursive: true });
  await mkdir(path.join(context.paths.mind, 'user', 'features', 'pdf'), { recursive: true });
  await writeFile(path.join(context.paths.mind, 'user', 'features', 'pdf', 'SKILL.md'), 'Prior accepted bytes');
  await writeFile(path.join(context.paths.mind, 'user', 'additions', `${id}.json`), JSON.stringify({ id, kind: 'skill', name: 'pdf', machine: context.paths.machine,
    source: { kind: 'folder', display: 'folder', url: null }, sourcePath: '.', removed: false, pin: { kind: 'snapshot', value: 'a'.repeat(64), digest: 'a'.repeat(64) } }));
  const before = await unchanged(), { input } = await folder(context);
  const preview = await inspectAddition(context, { ...input, updateOf: id });
  const ready = await settle(context, preview.id); assert.equal(ready.state, 'ready');
  const record = JSON.parse(await readFile(path.join(context.paths.localDirectory, 'additions', 'previews', `${preview.id}.json`)));
  assert.equal(record.updateTarget.name, 'pdf'); assert.equal(record.updateTarget.revision.length, 64);
  await cancelAdditionPreview(context, preview.id);
  const wrong = await folder(context, { text: '---\nname: different\nruntime: none\n---\n' });
  const rejected = await inspectAddition(context, { ...wrong.input, updateOf: id });
  assert.equal((await settle(context, rejected.id)).error.code, 'source_changed');
  await cancelAdditionPreview(context, rejected.id);
  assert.deepEqual(await unchanged(), before);
});

test('the GUI fixture independently implements upload and preview records with polling and desktop boundaries', async t => {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  async function request(method, target, body, headers = {}) {
    const response = await fetch(`${fixture.origin}/api/v1${target}`, { method, headers: { ...fixture.headers, 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  }
  const upload = await request('POST', '/additions/uploads', { machine: 'DESKTOP', name: 'folder' });
  assert.equal(upload.status, 201);
  const chunk = await request('PUT', `/additions/uploads/${upload.data.data.uploadId}/chunks`, { path: 'SKILL.md', index: 0, total: 1, base64: Buffer.from('fixture bytes').toString('base64') });
  assert.equal(chunk.status, 200);
  const preview = await request('POST', '/additions/previews', { machine: 'DESKTOP', source: { kind: 'folder', uploadId: upload.data.data.uploadId }, updateOf: null });
  assert.equal(preview.status, 202); assert.equal(preview.data.data.state, 'inspecting');
  const ready = await request('GET', `/additions/previews/${preview.data.data.id}`);
  assert.equal(ready.status, 200); assert.equal(ready.data.data.state, 'ready');
  assert.equal(ready.data.data.candidates[0].name, 'pdf');
  assert.equal(ready.data.data.candidates[0].check.age.ok, false);
  assert.equal((await request('DELETE', `/additions/previews/${preview.data.data.id}`, {})).status, 204);
});
