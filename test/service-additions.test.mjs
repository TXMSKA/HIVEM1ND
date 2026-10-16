import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { applyAdditions, cancelAdditionPreview, closeAdditionJobs, inspectAddition, openAdditionUpload, readAdditions, readAdditionPreview, readScopedAdditions, removeAddition, retryAdditionPreview, writeAdditionChunk } from '../engine/service/additions.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { createGroup, patchGroup, removeGroup } from '../engine/service/groups.mjs';
import { createCluster, patchCluster, rawClusters } from '../engine/service/clusters.mjs';
import { createStore, recoverTransactions, undoChange, withReceipt } from '../engine/service/store.mjs';
import { readContent, readPublishedSettings, writeContent } from '../engine/service/settings.mjs';
import { readProjection } from '../engine/service/projection.mjs';
import { registerNative } from '../engine/service/adapters.mjs';
import { createHttpServer } from '../engine/service/http.mjs';
import { createCredentialStore } from '../engine/service/security.mjs';
import { listStaged, openSync } from '../engine/sync/store.mjs';
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
  await writeFile(path.join(context.paths.mind, 'user', 'additions', `${id}.json`), JSON.stringify({ format: 'hivem1nd-addition-v1', id, kind: 'skill', name: 'pdf', title: 'pdf', machine: context.paths.machine,
    source: { kind: 'folder', display: 'folder', url: null }, sourcePath: '.', removed: false, pin: { kind: 'snapshot', value: 'a'.repeat(64), digest: 'a'.repeat(64) },
    license: 'MIT', publishedAt: '2026-10-01T00:00:00.000Z', requirements: [], scope: { everyUnit: true, units: [], groups: [] }, unitCount: 0, projectId: null,
    installedAt: new Date(context.now()).toISOString(), updatedAt: new Date(context.now()).toISOString(), files: [{ path: 'user/features/pdf/SKILL.md', hash: hashBytes(Buffer.from('Prior accepted bytes')), bytes: 20 }] }));
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

function additionArchive(entries) {
  const chunks = [];
  for (const [relative, content] of entries) {
    const data = Buffer.from(content), header = Buffer.alloc(512);
    header.write(`package/${relative}`, 0, 100); header.write('0000644\0', 100);
    header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136);
    header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257);
    header.write([...header].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    chunks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
async function reviewed(t, { context: supplied, pin = 'a'.repeat(40), updateOf = null, text = '# PDF\n', date = '2026-10-01T00:00:00.000Z', runtime = 'none' } = {}) {
  const world = supplied ? { context: supplied } : await setup(t), { context } = world;
  const archive = additionArchive([
    ['LICENSE', 'MIT License\n'], ['NOTICE', 'Reviewed notice\n'],
    ['skills/pdf/SKILL.md', `---\nname: pdf\ncategory: quality\nruntime: ${runtime}\n---\n${text}`],
    ['skills/pdf/help.md', 'Skill support\n'], ['skills/pdf/image.png', Buffer.from([0, 255, 128])], ['docs/guide.md', 'Knowledge guide\n'],
    ['package.json', JSON.stringify({ name: 'example', license: 'MIT', scripts: { postinstall: 'node sentinel.mjs' } })],
    ['sentinel.mjs', 'throw new Error("An imported script must never run");\n'],
  ]);
  context.additionLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  context.additionTransport = async url => ({ status: 200, bytes: url.pathname.includes('/commits/')
    ? Buffer.from(JSON.stringify({ sha: pin, commit: { committer: { date } } })) : archive });
  context.additionRunner = async (command, args, options, input) => {
    assert.equal(command, 'git'); assert.ok(args.includes('hash-object')); assert.equal(options.shell, false);
    return Buffer.from(createHash('sha1').update(`blob ${input.length}\0`).update(input).digest('hex') + '\n');
  };
  const preview = await inspectAddition(context, { machine: context.paths.machine, source: { kind: 'git', url: 'https://github.com/acme/example' }, updateOf });
  const ready = await settle(context, preview.id); assert.equal(ready.state, 'ready');
  return { ...world, ready, archive };
}
const emptyScope = () => ({ everyUnit: false, units: [], groups: [] });
const unitScope = (...units) => ({ everyUnit: false, units, groups: [] });
function acceptance(ready, kinds = ['skill'], scope = { everyUnit: true, units: [], groups: [] }) {
  return { machine: ready.machine, previewId: ready.id, selections: ready.candidates.filter(item => kinds.includes(item.kind)).map(item => ({ candidateId: item.id, scope: item.kind === 'repository' ? emptyScope() : scope })),
    expectedContentRevision: ready.contentRevision, expectedProjectRevision: ready.projectRevision, confirmed: true };
}
async function agents(context, names = ['one', 'two', 'three', 'four']) {
  const root = path.join(context.paths.mind, 'user', 'state'); await mkdir(root, { recursive: true });
  for (const name of names) await writeFile(path.join(root, `${name}.md`), `unit: ${name}\nunit-id: root:${name}\nrole: executor\nstate: out\nmachine: DESKTOP\n\nReady.\n`);
}

test('mixed acceptance places owned support and knowledge with four actual users, keeps C09 fields and never writes a client or source', async t => {
  const { context, unchanged } = await setup(t); await agents(context);
  await mkdir(path.join(context.paths.mind, 'features', 'plan'), { recursive: true });
  await writeFile(path.join(context.paths.mind, 'features', 'plan', 'SKILL.md'), '---\nname: plan\ncategory: planning\n---\nPlan\n');
  const base = await readContent(context);
  await writeContent(context, { includedFeatures: ['feature:plan'], includedKnowledge: [], preferences: { ...base.preferences, addressStyle: 'formal', additionalInstructions: 'Retain this preference.' }, expectedRevision: base.revision });
  const group = await createGroup(context, { title: 'Checkout launch', members: ['root:one', 'root:two', 'root:three'] });
  const { ready } = await reviewed(t, { context }), before = await unchanged();
  const input = acceptance(ready, ['skill', 'docs', 'repository'], { everyUnit: false, units: ['root:four', 'root:one'], groups: [group.id] });
  const accepted = await applyAdditions(context, input);
  assert.deepEqual(accepted.items.map(item => [item.kind, item.unitCount]), [['skill', 4], ['docs', 4], ['repository', 0]]);
  for (const [relative, bytes] of [['features/pdf/help.md', Buffer.from('Skill support\n')], ['features/pdf/image.png', Buffer.from([0, 255, 128])],
    ['features/pdf/LICENSE', Buffer.from('MIT License\n')], ['features/pdf/NOTICE', Buffer.from('Reviewed notice\n')], ['knowledge/docs/guide.md', Buffer.from('Knowledge guide\n')]]) {
    assert.deepEqual(await readFile(path.join(context.paths.mind, 'user', relative)), bytes);
  }
  const content = await readContent(context), pdf = content.features.find(item => item.id === 'feature:pdf');
  assert.equal(pdf.category, 'quality'); assert.equal(pdf.included, true); assert.equal(pdf.unitCount, 4); assert.equal(pdf.removable, true);
  assert.equal(content.features.find(item => item.id === 'feature:plan').category, 'planning');
  assert.equal(content.features.find(item => item.id === 'feature:plan').removable, false);
  assert.deepEqual(content.preferences, { ...base.preferences, addressStyle: 'formal', additionalInstructions: 'Retain this preference.' });
  assert.equal((await readContent(context)).knowledge[0].origin, 'acme/example');
  const after = await unchanged(); assert.deepEqual(after.client, before.client); assert.deepEqual(after.source, before.source);
  const view = await readProjection(context), project = view.projects.find(item => item.id === 'example');
  assert.deepEqual(project.unitIds, []); assert.equal(project.available, true); assert.equal(project.additionId, accepted.items[2].id);
  assert.equal(view.units.length, 4); assert.equal(view.leads.length, 0);
  const mapping = context.projects.find(item => item.name === 'example'); assert.ok(mapping.localPath.startsWith(path.join(context.paths.localDirectory, 'additions', 'repositories')));
  assert.deepEqual(await applyAdditions(context, input), accepted); assert.deepEqual((await readAdditionPreview(context, ready.id)).result, accepted);
  assert.equal((await readAdditions(context)).items.length, 3);
  assert.equal((await readAdditions(context, 'OFFLINE')).readOnly, true);
  await cancelAdditionPreview(context, ready.id); assert.equal((await readAdditionPreview(context, ready.id)).state, 'accepted');
  const sync = openSync(context), staged = await listStaged(sync);
  assert.ok(staged.some(item => item.target.path.startsWith('user/additions/')));
  assert.equal(staged.some(item => item.target.path.startsWith('user/machines/') && item.target.path.endsWith('.md')), false);
  assert.equal(JSON.stringify(context.events).includes(context.paths.localDirectory), false);
});

test('repository-only acceptance allows canonical empty scope and no agents, and Remove and Undo preserve all checkout bytes', async t => {
  const { context, ready } = await reviewed(t), input = acceptance(ready, ['repository']);
  const accepted = await applyAdditions(context, input), addition = accepted.items[0];
  const cluster = (await rawClusters(context)).find(item => item.cluster.link.projectId === addition.projectId).cluster;
  assert.deepEqual(cluster.members, []); assert.equal(cluster.deleted, false);
  // The checkout is a working Git repository of the pinned tree, so its cluster can show Git.
  const { readRepositoryIdentity } = await import('../engine/service/cluster-git.mjs');
  const checkout = path.join(context.paths.localDirectory, 'additions', 'repositories', addition.id);
  const [digest] = await readdir(checkout);
  const repository = await readRepositoryIdentity(path.join(checkout, digest));
  assert.ok(repository.id, 'the accepted repository has a Git identity');
  const before = await hashes(path.join(context.paths.localDirectory, 'additions', 'repositories'));
  assert.equal(addition.unitCount, 0); assert.deepEqual((await readProjection(context)).units, []);
  const removed = await removeAddition(context, addition.id, { machine: context.paths.machine, confirmed: true, expectedRevision: addition.revision });
  const retained = (await rawClusters(context)).find(item => item.cluster.id === cluster.id).cluster;
  assert.equal(retained.deleted, false); assert.deepEqual(retained.link, { kind: 'none' }); assert.equal(retained.chatId, cluster.chatId);
  assert.deepEqual((await readProjection(context)).projects, []); assert.equal(context.projects.length, 0);
  assert.deepEqual(await hashes(path.join(context.paths.localDirectory, 'additions', 'repositories')), before);
  await undoChange(context, removed.changeId); assert.equal(context.projects.length, 1);
  assert.deepEqual((await rawClusters(context)).find(item => item.cluster.id === cluster.id).cluster, cluster);
  assert.equal((await readProjection(context)).projects[0].available, true);
  assert.deepEqual(await hashes(path.join(context.paths.localDirectory, 'additions', 'repositories')), before);
  const record = (await readAdditions(context)).items[0];
  const expired = await removeAddition(context, record.id, { machine: context.paths.machine, confirmed: true, expectedRevision: record.revision });
  context.clock.now += 10000;
  await assert.rejects(undoChange(context, expired.changeId), { code: 'undo_expired' });
  assert.deepEqual(await hashes(path.join(context.paths.localDirectory, 'additions', 'repositories')), before);
});

for (const cause of ['hash', 'scope', 'name', 'content', 'check', 'unsupported', 'empty']) test(`rejected mixed acceptance has no partial content or project visibility: ${cause}`, async t => {
  const { context } = await setup(t); await agents(context);
  const { ready } = await reviewed(t, { context, ...(cause === 'check' ? { date: '2026-10-09T00:00:00.000Z' } : {}) });
  const input = acceptance(ready, ['skill', 'docs', 'repository']);
  if (cause === 'hash') {
    const record = JSON.parse(await readFile(path.join(context.paths.localDirectory, 'additions', 'previews', `${ready.id}.json`)));
    await writeFile(path.join(record.acquisition.directory, 'tree', 'skills', 'pdf', 'help.md'), 'Changed staging');
  }
  if (cause === 'scope') await agents(context, ['new']);
  if (cause === 'name') { await mkdir(path.join(context.paths.mind, 'user', 'knowledge', 'docs'), { recursive: true }); await writeFile(path.join(context.paths.mind, 'user', 'knowledge', 'docs', 'foreign.txt'), 'Foreign bytes'); }
  if (cause === 'content') { const content = await readContent(context); await writeContent(context, { includedFeatures: [], includedKnowledge: [], preferences: content.preferences, expectedRevision: content.revision }); }
  if (cause === 'unsupported') input.selections.push({ candidateId: randomUUID(), scope: unitScope('root:one') });
  if (cause === 'empty') input.selections[0].scope = emptyScope();
  const before = await hashes(context.paths.mind);
  await assert.rejects(applyAdditions(context, input), error => ['preview_changed', 'scope_changed', 'name_conflict', 'revision_conflict', 'check_failed', 'unsupported_addition', 'invalid_scope'].includes(error.code));
  assert.deepEqual(await hashes(context.paths.mind), before); assert.deepEqual((await readProjection(context)).projects, []);
  assert.equal((await readAdditions(context)).items.length, 0);
});

for (const fault of ['checkout:2', 'prepared', 'content', 'receipt']) test(`interrupted acceptance recovers the same placement and receipt: ${fault}`, async t => {
  const { context } = await setup(t); await agents(context);
  const { ready } = await reviewed(t, { context }), input = acceptance(ready, ['skill', 'docs', 'repository']);
  if (fault.startsWith('checkout')) context.additionFault = fault;
  else context.store.fault = fault === 'prepared' ? { afterPrepared: true } : fault === 'content' ? { afterRenames: 2 } : { beforeReceipt: true };
  const receiptInput = { principal: context.principal.stableId, key: randomUUID(), method: 'POST', path: '/additions', body: input, requestId: randomUUID() };
  const accept = () => withReceipt(context.store, receiptInput, async receipt => { context.receipt = receipt; return { status: 201, body: await applyAdditions(context, input) }; });
  await assert.rejects(accept(), { code: 'injected_crash' }); context.receipt = null;
  const replacement = createStore({ root: context.root, confineRoot: context.root, mindPath: context.paths.mind, localDirectory: context.paths.localDirectory, now: context.now, events: context.events });
  replacement.aclRunner = context.store.aclRunner; context.store = replacement;
  await recoverTransactions(context.store);
  const result = await accept(); context.receipt = null;
  assert.equal(result.status, 201); assert.equal((await readAdditions(context)).items.length, 3);
  const binding = await readAdditionPreview(context, ready.id); assert.equal(binding.state, 'accepted'); assert.deepEqual(binding.result, result.body);
  assert.equal((await readProjection(context)).projects.length, 1); assert.equal((await readProjection(context)).units.length, 4);
  assert.deepEqual((await accept()).body, result.body); context.receipt = null;
});

test('updates retain the old pin through review and rejection, replace only owned bytes and keep foreign edits after Remove', async t => {
  const { context } = await setup(t); await agents(context);
  const first = await reviewed(t, { context }), accepted = await applyAdditions(context, acceptance(first.ready)), addition = accepted.items[0];
  const target = path.join(context.paths.mind, 'user', 'features', 'pdf', 'SKILL.md'), old = await readFile(target);
  const failed = await reviewed(t, { context, pin: 'b'.repeat(40), updateOf: addition.id, text: '# Updated PDF\n', date: '2026-10-09T00:00:00.000Z' });
  await assert.rejects(applyAdditions(context, acceptance(failed.ready)), { code: 'check_failed' }); assert.deepEqual(await readFile(target), old);
  const next = await reviewed(t, { context, pin: 'b'.repeat(40), updateOf: addition.id, text: '# Updated PDF\n' });
  assert.equal((await readAdditions(context)).items[0].pin.value, 'a'.repeat(40)); assert.deepEqual(await readFile(target), old);
  const updated = (await applyAdditions(context, acceptance(next.ready))).items[0];
  assert.equal(updated.id, addition.id); assert.equal(updated.pin.value, 'b'.repeat(40)); assert.match(await readFile(target, 'utf8'), /Updated PDF/);
  const clean = await removeAddition(context, updated.id, { machine: context.paths.machine, confirmed: true, expectedRevision: updated.revision });
  await undoChange(context, clean.changeId); assert.equal((await readAdditions(context)).items[0].pin.value, updated.pin.value);
  const changed = await reviewed(t, { context, pin: 'c'.repeat(40), updateOf: addition.id });
  await writeFile(target, 'Foreign edit'); const before = await hashes(context.paths.mind);
  await assert.rejects(applyAdditions(context, acceptance(changed.ready)), { code: 'destination_changed' }); assert.deepEqual(await hashes(context.paths.mind), before);
  const removed = await removeAddition(context, updated.id, { machine: context.paths.machine, confirmed: true, expectedRevision: updated.revision });
  assert.equal(await readFile(target, 'utf8'), 'Foreign edit'); assert.equal((await readContent(context)).features.some(item => item.id === 'feature:pdf'), false);
  await assert.rejects(undoChange(context, removed.changeId), { code: 'undo_conflict' }); assert.equal(await readFile(target, 'utf8'), 'Foreign edit');
});

test('scope is resolved at each verified session use, with group edits and deleted identities revoking content and runtimes failing closed', async t => {
  const { context } = await setup(t); await agents(context);
  const group = await createGroup(context, { title: 'Scope', members: ['root:one', 'root:two'] });
  const { ready } = await reviewed(t, { context, runtime: 'python' });
  const accepted = await applyAdditions(context, acceptance(ready, ['skill'], { everyUnit: false, units: ['root:four'], groups: [group.id] }));
  context.adapters = { codex: { capabilities: { scopedContent: true }, confirm: async proof => ['root:one', 'root:two', 'root:three', 'root:four'].includes(proof.unitId), runtimeAvailable: async () => true } };
  const sessions = {};
  for (const unitId of ['root:one', 'root:two', 'root:three', 'root:four']) sessions[unitId] = await registerNative(context, { unitId, client: 'codex', nativeSessionId: `native-${unitId}` });
  const read = unitId => readScopedAdditions(context, { unitId, client: 'codex', sessionId: sessions[unitId].sessionId, nativeSessionId: sessions[unitId].nativeSessionId });
  assert.equal((await read('root:one')).length, 1); assert.equal((await read('root:three')).length, 0); assert.equal((await read('root:four')).length, 1);
  const patched = await patchGroup(context, group.id, { members: ['root:two', 'root:three'], expectedRevision: group.revision });
  assert.equal((await read('root:one')).length, 0); assert.equal((await read('root:three')).length, 1);
  await assert.rejects(removeGroup(context, group.id, { confirmed: true, expectedRevision: patched.revision }), { code: 'stop_unavailable' });
  const emptied = await patchGroup(context, group.id, { members: [], expectedRevision: patched.revision });
  await removeGroup(context, group.id, { confirmed: true, expectedRevision: emptied.revision });
  assert.equal((await read('root:three')).length, 0);
  context.adapters.codex.runtimeAvailable = async requirement => requirement !== 'Python';
  await assert.rejects(read('root:four'), error => error.code === 'runtime_unavailable' && error.details.requirement === 'Python');
  context.adapters.codex.capabilities.scopedContent = false;
  await assert.rejects(read('root:four'), { code: 'scope_unavailable' });
  context.adapters.codex.capabilities.scopedContent = true; context.adapters.codex.runtimeAvailable = async () => true;
  await writeFile(path.join(context.paths.mind, 'user', 'state', 'four.md'), 'unit: four\nunit-id: root:four\nrole: executor\nremoved: true\nstate: out\n');
  assert.equal((await read('root:four')).length, 0); assert.equal((await readAdditions(context)).items[0].unitCount, 0);
  assert.equal(accepted.items[0].unitCount, 3);
});

test('acceptance Undo and conflicting removal Undo use the original revision gates without changing repository bytes', async t => {
  const { context } = await setup(t); await agents(context);
  const { ready } = await reviewed(t, { context }), result = await applyAdditions(context, acceptance(ready, ['skill', 'repository']));
  const before = await hashes(path.join(context.paths.localDirectory, 'additions', 'repositories'));
  await undoChange(context, result.changeId);
  assert.deepEqual((await readAdditions(context)).items, []); assert.deepEqual((await readProjection(context)).projects, []);
  assert.deepEqual(await hashes(path.join(context.paths.localDirectory, 'additions', 'repositories')), before);
  assert.equal((await readAdditionPreview(context, ready.id)).state, 'accepted');
  const next = await reviewed(t, { context }), accepted = await applyAdditions(context, acceptance(next.ready));
  const removed = await removeAddition(context, accepted.items[0].id, { machine: context.paths.machine, confirmed: true, expectedRevision: accepted.items[0].revision });
  await mkdir(path.join(context.paths.mind, 'user', 'features', 'pdf'), { recursive: true });
  await writeFile(path.join(context.paths.mind, 'user', 'features', 'pdf', 'help.md'), 'Intervening private content');
  await assert.rejects(undoChange(context, removed.changeId), { code: 'undo_conflict' });
  assert.equal(await readFile(path.join(context.paths.mind, 'user', 'features', 'pdf', 'help.md'), 'utf8'), 'Intervening private content');
});

test('repository updates switch verified local snapshots only at commit and refuse foreign checkout changes', async t => {
  const { context, ready } = await reviewed(t), accepted = await applyAdditions(context, acceptance(ready, ['repository'])), first = accepted.items[0];
  const initialPath = context.projects[0].localPath, before = await hashes(initialPath);
  const update = await reviewed(t, { context, updateOf: first.id, pin: 'b'.repeat(40), text: '# New repository pin\n' });
  assert.equal(context.projects[0].localPath, initialPath); assert.deepEqual(await hashes(initialPath), before);
  const updated = await applyAdditions(context, acceptance(update.ready, ['repository']));
  assert.equal(updated.items[0].id, first.id); assert.notEqual(context.projects[0].localPath, initialPath); assert.deepEqual(await hashes(initialPath), before);
  const rejected = await reviewed(t, { context, updateOf: first.id, pin: 'c'.repeat(40) });
  await writeFile(path.join(context.projects[0].localPath, 'docs', 'guide.md'), 'Foreign repository edit');
  const original = context.projects[0].localPath;
  await assert.rejects(applyAdditions(context, acceptance(rejected.ready, ['repository'])), { code: 'destination_changed' });
  assert.equal(context.projects[0].localPath, original); assert.equal((await readAdditions(context)).items[0].pin.value, 'b'.repeat(40));
});

test('real C12 HTTP acceptance and receipts are desktop-only and consumed previews survive response replay', async t => {
  const { context } = await setup(t); await agents(context);
  const credentials = createCredentialStore({ now: context.now }), desktop = credentials.issue({ audience: 'desktop', unitId: 'root:master', capabilities: ['read', 'settings.write'], expiresAt: null });
  context.principal.stableId = desktop.token;
  const { ready } = await reviewed(t, { context }), input = acceptance(ready, ['skill', 'docs', 'repository']);
  const listener = await createHttpServer({ ...context, credentials, additionOwner: context, settingsOwner: context }); t.after(() => listener.close());
  const origin = `http://127.0.0.1:${listener.port}`;
  async function request(method, target, body, token = desktop.token, key = randomUUID()) {
    const response = await fetch(`${origin}/api/v1${target}`, { method, headers: { origin, authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': key }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, value: await response.json() };
  }
  for (const audience of ['phone', 'agent']) {
    const denied = credentials.issue({ audience, unitId: audience === 'agent' ? 'root:one' : 'root:master', capabilities: ['own'], expiresAt: new Date(context.now() + 60000).toISOString() });
    for (const [method, target, body] of [['POST', '/additions', input], ['GET', '/additions', undefined], ['DELETE', `/additions/${randomUUID()}`, { machine: 'DESKTOP', confirmed: true, expectedRevision: 'a'.repeat(64) }]]) {
      const reply = await request(method, target, body, denied.token); assert.equal(reply.status, 403); assert.equal(reply.value.error.code, 'forbidden');
    }
  }
  assert.equal((await request('POST', '/additions', { ...input, path: 'C:/foreign' })).status, 400);
  const key = randomUUID(), first = await request('POST', '/additions', input, desktop.token, key);
  assert.equal(first.status, 201); assert.equal(first.value.data.items.length, 3);
  const replay = await request('POST', '/additions', input, desktop.token, key); assert.deepEqual(replay.value.data, first.value.data);
  assert.equal((await request('GET', '/additions')).value.data.items.length, 3);
  assert.equal((await request('GET', '/additions?machine=OFFLINE')).value.data.readOnly, true);
  assert.equal((await request('GET', '/additions?extra=true')).status, 400);
  context.clock.now += 900000;
  assert.equal((await request('GET', `/additions/previews/${ready.id}`)).value.data.state, 'accepted');
  assert.deepEqual((await request('POST', '/additions', input, desktop.token, key)).value.data, first.value.data);
  const item = first.value.data.items[0], removed = await request('DELETE', `/additions/${item.id}`, { machine: 'DESKTOP', confirmed: true, expectedRevision: item.revision });
  assert.equal(removed.status, 200); assert.equal((await request('GET', '/additions')).value.data.items.length, 2);
});

test('the independent GUI protocol returns accepted Content and zero-agent projects with Remove and guarded Undo', async t => {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  async function request(method, target, body) {
    const response = await fetch(`${fixture.origin}/api/v1${target}`, { method, headers: { ...fixture.headers, 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, value: await response.json() };
  }
  const inspecting = await request('POST', '/additions/previews', { machine: 'DESKTOP', source: { kind: 'git', url: 'https://github.com/acme/example' }, updateOf: null });
  assert.equal(inspecting.status, 202);
  const ready = (await request('GET', `/additions/previews/${inspecting.value.data.id}`)).value.data;
  const input = acceptance(ready, ['skill', 'repository'], unitScope(ready.choices.units[0].id));
  const accepted = await request('POST', '/additions', input); assert.equal(accepted.status, 201);
  const skill = accepted.value.data.items[0], repo = accepted.value.data.items[1];
  assert.equal((await request('GET', '/settings/content')).value.data.features.find(item => item.additionId === skill.id).removable, true);
  assert.deepEqual((await request('GET', '/projects')).value.data.items.find(item => item.additionId === repo.id).unitIds, []);
  assert.equal((await request('GET', `/additions/previews/${ready.id}`)).value.data.state, 'accepted');
  const removed = await request('DELETE', `/additions/${skill.id}`, { machine: 'DESKTOP', confirmed: true, expectedRevision: skill.revision });
  assert.equal(removed.status, 200);
  assert.equal((await request('GET', '/additions')).value.data.items.length, 1);
  assert.equal((await request('POST', `/changes/${removed.value.data.changeId}/undo`, {})).status, 200);
  assert.equal((await request('GET', '/additions')).value.data.items.length, 2);
});

test('canonical descendant scopes deduplicate direct members and are rechecked at each verified native read', async t => {
  const { context } = await setup(t); await agents(context);
  const parent = await createCluster(context, { title: 'Parent', parentId: null, link: { kind: 'none' }, machine: context.paths.machine, confirmed: true });
  const child = await createCluster(context, { title: 'Child', parentId: parent.id, link: { kind: 'none' }, members: ['root:one', 'root:two'], machine: context.paths.machine, confirmed: true });
  const { ready } = await reviewed(t, { context });
  assert.deepEqual(ready.choices.groups.find(item => item.id === parent.id).members, ['root:one', 'root:two']);
  const result = await applyAdditions(context, acceptance(ready, ['skill'], { everyUnit: false, units: ['root:one'], groups: [parent.id, child.id] }));
  assert.equal(result.items[0].unitCount, 2);
  context.adapters = { codex: { capabilities: { scopedContent: true }, confirm: async () => true, runtimeAvailable: async () => true } };
  const session = await registerNative(context, { unitId: 'root:two', client: 'codex', nativeSessionId: 'verified-two' });
  const read = () => readScopedAdditions(context, { unitId: 'root:two', client: 'codex', sessionId: session.sessionId, nativeSessionId: session.nativeSessionId });
  assert.equal((await read()).length, 1);
  await patchCluster(context, child.id, { members: ['root:one'], expectedRevision: child.revision, machine: context.paths.machine });
  assert.equal((await read()).length, 0);
  assert.equal((await readAdditions(context)).items[0].unitCount, 1);
  assert.deepEqual((await readAdditions(context)).items[0].scope, { everyUnit: false, units: ['root:one'], groups: [child.id, parent.id].sort() });
});

test('repository removal retains agents and rejects a running session before detaching its link', async t => {
  const { context, ready } = await reviewed(t), result = await applyAdditions(context, acceptance(ready, ['repository']));
  const addition = result.items[0], initial = (await rawClusters(context)).find(item => item.cluster.link.projectId === addition.projectId).cluster;
  await agents(context, ['one']);
  const cluster = await patchCluster(context, initial.id, { members: ['root:one'], expectedRevision: initial.revision, machine: context.paths.machine });
  context.adapters = { codex: { confirm: async () => true } };
  const session = await registerNative(context, { unitId: 'root:one', client: 'codex', nativeSessionId: 'owned-repository' });
  const remove = () => removeAddition(context, addition.id, { machine: context.paths.machine, confirmed: true, expectedRevision: addition.revision });
  await assert.rejects(remove(), { code: 'stop_unavailable' });
  assert.deepEqual((await rawClusters(context)).find(item => item.cluster.id === cluster.id).cluster.link, cluster.link);
  // A persisted stopped session is the canonical boundary used by link removal.
  const statusDirectory = path.join(context.paths.mind, 'user', 'relay', 'session-status', session.sessionId);
  await mkdir(statusDirectory, { recursive: true });
  await writeFile(path.join(statusDirectory, `${randomUUID()}.json`), JSON.stringify({ format: 'hivem1nd-session-status-v1', sessionId: session.sessionId,
    machine: context.paths.machine, state: 'stopped', at: new Date(context.now()).toISOString(), reason: 'native-acknowledged' }));
  const removed = await remove();
  const retained = (await rawClusters(context)).find(item => item.cluster.id === cluster.id).cluster;
  assert.deepEqual(retained.members, ['root:one']); assert.equal(retained.deleted, false); assert.deepEqual(retained.link, { kind: 'none' });
  await undoChange(context, removed.changeId);
  assert.deepEqual((await rawClusters(context)).find(item => item.cluster.id === cluster.id).cluster, cluster);
});

test('a skill accepted on a M1ND that never saved Content still lets Settings save Content', async t => {
  const { context } = await setup(t); await agents(context);
  const { ready } = await reviewed(t, { context });
  await applyAdditions(context, acceptance(ready, ['skill']));
  const content = await readContent(context);
  const saved = await writeContent(context, { includedFeatures: content.features.filter(item => item.included).map(item => item.id), includedKnowledge: [],
    preferences: { ...content.preferences, additionalInstructions: 'Saved after the first skill.' }, expectedRevision: content.revision });
  assert.equal(saved.preferences.additionalInstructions, 'Saved after the first skill.');
});
