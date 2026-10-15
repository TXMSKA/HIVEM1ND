import fsPromises, { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeCore } from '../engine/service/service.mjs';
import { createText, readEditor, replaceText } from '../engine/service/editors.mjs';
import { applyPack } from '../engine/sync/apply.mjs';
import { openLedger, reservePublication, SYNC_BYTES_MAX } from '../engine/sync/limits.mjs';
import { encodePack } from '../engine/sync/pack.mjs';
import { listStaged } from '../engine/sync/store.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { withLocalChanges } from '../engine/service/store.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

async function until(check) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(25);
  }
  assert.fail('The local filesystem change was not reconciled.');
}

async function boot(t, setup) {
  const fixture = await makeCoreFixture();
  const localPath = path.join(fixture.root, 'shop');
  await mkdir(localPath, { recursive: true });
  const context = {
    store: fixture.store, paths: fixture.paths, projects: [{ name: 'shop', localPath }],
    now: () => fixture.clock.now, principal: { audience: 'desktop', unitId: 'root:master' },
  };
  const extra = await setup?.(context);
  // These assertions inspect pending changes, including baselines staged during boot.
  // Keep publication paused before it can acknowledge them on a slow machine.
  const ledger = openLedger({ ...context, machine: fixture.machine });
  await reservePublication(ledger, { id: 'hold-local-observations', messages: 0, bytes: SYNC_BYTES_MAX });
  const core = await composeCore({ ...context, clients: [], env: fixture.env, port: 0 });
  Object.assign(context, { pulse: core.runtime.pulse, sync: core.runtime.sync, ledger: core.runtime.ledger, bus: core.bus });
  const cores = [core];
  t.after(async () => { for (const item of cores.toReversed()) await item.http.close(); await dispose(fixture); });
  return { fixture, core, cores, context, localPath, extra };
}

test('external mind writes and deletes are staged, while closed services stop observing', async t => {
  const { fixture, core } = await boot(t);
  const file = path.join(fixture.paths.mind, 'user', 'notes.md');
  await writeFile(file, 'Outside the GUI.\n');
  await until(async () => (await listStaged(core.runtime.sync)).some(change => change.target.path === 'user/notes.md' && change.operation === 'put'));
  fixture.clock.now += 1000;
  await unlink(file);
  await until(async () => (await listStaged(core.runtime.sync)).some(change => change.target.path === 'user/notes.md' && change.operation === 'delete'));
  await core.http.close();
  const before = (await listStaged(core.runtime.sync)).length;
  await writeFile(file, 'After close.\n');
  await delay(150);
  assert.equal((await listStaged(core.runtime.sync)).length, before);
});

test('external reversions and repeated deletes create new changes while earlier versions are pending', async t => {
  const { fixture, core } = await boot(t);
  await core.runtime.pulse.close().done;
  const target = 'user/reverted.md';
  const file = path.join(fixture.paths.mind, ...target.split('/'));
  const changes = async () => (await listStaged(core.runtime.sync)).filter(change => change.target.path === target).sort((left, right) => left.at.localeCompare(right.at));
  for (const [index, bytes] of ['A\n', 'B\n', 'A\n', null, 'B\n', null].entries()) {
    fixture.clock.now += 1000;
    if (bytes === null) await unlink(file);
    else await writeFile(file, bytes);
    await until(async () => (await changes()).length === index + 1);
  }
  const staged = await changes();
  assert.equal(new Set(staged.map(change => change.id)).size, 6);
  assert.deepEqual(staged.map(change => change.operation), ['put', 'put', 'put', 'delete', 'put', 'delete']);
  assert.equal(staged[2].baseHash, staged[1].hash);
  assert.equal(staged[5].baseHash, staged[4].hash);
});

test('external Void A to B to A records both transitions in atomic document/history groups', async t => {
  const { fixture, core, localPath } = await boot(t, context => createText(context, {
    project: 'shop', path: 'docs/reverted.json', document: { title: 'Note', pages: [{ k: 'p', en: 'A' }] },
  }));
  await core.runtime.pulse.close().done;
  const file = path.join(localPath, 'docs', 'reverted.json');
  const history = path.join(localPath, 'docs', 'reverted.versions.jsonl');
  const original = await readFile(file);
  const alternate = Buffer.from(JSON.stringify({ ...JSON.parse(original), pages: [{ k: 'p', en: 'B' }] }));
  for (const [index, bytes] of [alternate, original].entries()) {
    fixture.clock.now += 1000;
    await writeFile(file, bytes);
    await until(async () => (await readFile(history, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).length === index + 1);
    await until(async () => (await listStaged(core.runtime.sync)).filter(change => change.target.path === 'docs/reverted.json').length === index + 2);
  }
  const lines = (await readFile(history, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.map(line => [line.before, line.after, line.by]), [['A', 'B', 'outside'], ['B', 'A', 'outside']]);
  const changes = await listStaged(core.runtime.sync);
  const documents = changes.filter(change => change.target.path === 'docs/reverted.json').sort((left, right) => left.at.localeCompare(right.at));
  assert.equal(documents.length, 3);
  assert.equal(documents[0].hash, documents[2].hash);
  assert.notEqual(documents[0].id, documents[2].id);
  for (const document of documents.slice(1)) {
    assert.ok(document.transactionId);
    assert.ok(changes.some(change => change.transactionId === document.transactionId && change.target.path === 'docs/reverted.versions.jsonl'));
  }
});

test('a rescan reads staged records once for an unchanged collection, and sees later external changes', async t => {
  const count = 30;
  const { fixture, core, context } = await boot(t, async context => {
    await mkdir(path.join(context.paths.mind, 'user', 'notes'), { recursive: true });
    for (let index = 0; index < count; index += 1) await writeFile(path.join(context.paths.mind, 'user', 'notes', `${index}.md`), `Original ${index}.\n`);
  });
  const directory = path.join(fixture.paths.localDirectory, 'staging', 'changes');
  const before = (await readdir(directory)).length;
  const original = fsPromises.open;
  let stagedReads = 0;
  fsPromises.open = async (file, flags, ...rest) => {
    if (flags === 'r' && path.dirname(String(file)) === directory) stagedReads += 1;
    return original(file, flags, ...rest);
  };
  syncBuiltinESMExports();
  try {
    await writeFile(path.join(fixture.paths.mind, 'user', 'new-note.md'), 'An outside change.\n');
    await until(async () => (await readdir(directory)).length > before);
    await withLocalChanges(context.store, async () => {});
    assert.ok(stagedReads <= before * 3 + 10, `A rescan must not reread every staged record for every file (${stagedReads} reads for ${before} staged records).`);
  } finally {
    fsPromises.open = original;
    syncBuiltinESMExports();
  }
  fixture.clock.now += 1000;
  const file = path.join(fixture.paths.mind, 'user', 'notes', '0.md');
  await writeFile(file, 'A later outside change.\n');
  await until(async () => (await listStaged(core.runtime.sync)).some(change => change.target.path === 'user/notes/0.md' && change.hash === hashBytes(Buffer.from('A later outside change.\n'))));
});

test('external Void replacement records one atomic document/history group, preserves malformed bytes and recovers', async t => {
  const { fixture, core, context, localPath, extra: created } = await boot(t, context => createText(context, {
    project: 'shop', path: 'docs/note.json', document: { title: 'Note', pages: [{ k: 'p', en: 'Before' }] },
  }));
  const file = path.join(localPath, 'docs', 'note.json');
  const history = path.join(localPath, 'docs', 'note.versions.jsonl');
  fixture.clock.now += 1000;
  await writeFile(`${file}.tmp`, JSON.stringify({ title: 'Note', rev: 0, pages: [{ k: 'p', en: 'Outside' }] }));
  await rename(`${file}.tmp`, file);
  await until(async () => (await readFile(history, 'utf8').catch(() => '')).includes('"by":"outside"'));
  const lines = (await readFile(history, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].before, 'Before');
  assert.equal(lines[0].after, 'Outside');
  const currentHash = hashBytes(await readFile(file));
  await until(async () => (await listStaged(core.runtime.sync)).some(change => change.target.path === 'docs/note.json' && change.hash === currentHash && change.transactionId));
  const changes = await listStaged(core.runtime.sync);
  const body = changes.find(change => change.target.path === 'docs/note.json' && change.hash === currentHash);
  assert.ok(body?.transactionId);
  assert.ok(changes.some(change => change.transactionId === body.transactionId && change.target.path === 'docs/note.versions.jsonl'));
  await writeFile(path.join(fixture.paths.mind, 'user', 'rescan.md'), 'rescan');
  await delay(200);
  assert.equal((await readFile(history, 'utf8')).trim().split('\n').length, 1);
  await writeFile(file, '{');
  await until(() => core.runtime.lastError !== null);
  assert.equal(await readFile(file, 'utf8'), '{');
  assert.equal((await readFile(history, 'utf8')).trim().split('\n').length, 1);
  fixture.clock.now += 1000;
  await writeFile(file, JSON.stringify({ title: 'Note', rev: 0, pages: [{ k: 'p', en: 'Recovered' }] }));
  await until(async () => (await readFile(history, 'utf8')).includes('Recovered'));
  assert.equal((await readFile(history, 'utf8')).trim().split('\n').length, 2);
  assert.equal((await readEditor(context, created.id)).document.pages[0].en, 'Recovered');
});

test('own saves and incoming application do not create outside history or republish imported bytes', async t => {
  const { fixture, core, context, localPath, extra: created } = await boot(t, context => createText(context, {
    project: 'shop', path: 'docs/note.json', document: { title: 'Note', pages: [{ k: 'p', en: 'Before' }] },
  }));
  fixture.clock.now += 1000;
  const own = await replaceText(context, created.id, { expectedRevision: created.revision, document: { ...created.document, pages: [{ k: 'p', en: 'Own save' }] } });
  await delay(200);
  const history = path.join(localPath, 'docs', 'note.versions.jsonl');
  assert.equal((await readFile(history, 'utf8')).includes('"by":"outside"'), false);
  const incoming = Buffer.from(JSON.stringify({ ...own.document, pages: [{ k: 'p', en: 'Imported' }] }));
  const change = {
    format: 'hivem1nd-change-v1', id: randomUUID(), machine: 'OTHER',
    at: new Date(fixture.clock.now + 1000).toISOString(), target: { kind: 'project', project: 'shop', path: 'docs/note.json' },
    operation: 'put', hash: hashBytes(incoming), size: incoming.length, baseHash: own.revision, messageId: null, transactionId: null,
  };
  const packed = encodePack({ machine: 'OTHER', sequence: 1, changes: [change], objects: [{ hash: change.hash, raw: incoming }] });
  const applied = await applyPack(core.runtime.sync, packed, { projects: context.projects });
  assert.equal(applied.status, 'applied');
  await delay(200);
  assert.equal((await readFile(history, 'utf8')).includes('"by":"outside"'), false);
  assert.equal((await listStaged(core.runtime.sync)).some(item => item.hash === change.hash), false);
  assert.equal((await readEditor(context, created.id)).document.pages[0].en, 'Imported');
  fixture.clock.now += 2000;
  await writeFile(path.join(localPath, 'docs', 'note.json'), JSON.stringify({ ...own.document, pages: [{ k: 'p', en: 'Outside after import' }] }));
  await until(async () => (await readFile(history, 'utf8')).includes('Outside after import'));
  const outside = (await readFile(history, 'utf8')).trim().split('\n').map(JSON.parse).filter(item => item.by === 'outside');
  assert.equal(outside.length, 1);
  assert.equal(outside[0].before, 'Imported', 'cached validation must not retain the document from before an import');
});

test('a replaced project root is rebound and its registered document is reconciled', async t => {
  const { core, localPath } = await boot(t, context => createText(context, {
    project: 'shop', path: 'docs/note.json', document: { title: 'Note', pages: [{ k: 'p', en: 'Before' }] },
  }));
  await rename(localPath, `${localPath}.offline`);
  await delay(150);
  await mkdir(path.join(localPath, 'docs'), { recursive: true });
  const bytes = Buffer.from(JSON.stringify({ title: 'Note', rev: 0, pages: [{ k: 'p', en: 'Replacement root' }] }));
  await writeFile(path.join(localPath, 'docs', 'note.json'), bytes);
  await until(async () => (await listStaged(core.runtime.sync)).some(change => change.hash === hashBytes(bytes)));
});

test('restart stages an eligible file deleted while the service was closed', async t => {
  const { fixture, core, cores, context } = await boot(t);
  const file = path.join(fixture.paths.mind, 'user', 'offline.md');
  await writeFile(file, 'Before shutdown.\n');
  await until(async () => (await listStaged(core.runtime.sync)).some(change => change.target.path === 'user/offline.md'));
  await core.http.close();
  fixture.clock.now += 1000;
  await unlink(file);
  const restarted = await composeCore({ ...context, clients: [], env: fixture.env, port: 0 });
  cores.push(restarted);
  assert.ok((await listStaged(restarted.runtime.sync)).some(change => change.target.path === 'user/offline.md' && change.operation === 'delete'));
});

for (const existing of [false, true]) test(`restart stages an imported ${existing ? 'unchanged' : 'new'} file deleted before its first observation, using the incoming base`, async t => {
  const { fixture, core, cores, context } = await boot(t);
  const bytes = Buffer.from('Received from another machine.\n');
  const target = { kind: 'mind', path: 'user/imported-offline.md' };
  const change = {
    format: 'hivem1nd-change-v1', id: randomUUID(), machine: 'OTHER', at: new Date(fixture.clock.now).toISOString(),
    target, operation: 'put', hash: hashBytes(bytes), size: bytes.length, baseHash: null, messageId: null, transactionId: null,
  };
  await withLocalChanges(fixture.store, async () => {
    if (existing) await writeFile(path.join(fixture.paths.mind, 'user', 'imported-offline.md'), bytes);
    await applyPack(core.runtime.sync, encodePack({ machine: 'OTHER', sequence: 1, changes: [change], objects: [{ hash: change.hash, raw: bytes }] }));
  });
  await core.http.close();
  assert.equal((await listStaged(core.runtime.sync)).some(item => item.hash === change.hash), false);
  fixture.clock.now += 2000;
  await unlink(path.join(fixture.paths.mind, 'user', 'imported-offline.md'));
  const restarted = await composeCore({ ...context, clients: [], env: fixture.env, port: 0 });
  cores.push(restarted);
  const removed = (await listStaged(restarted.runtime.sync)).find(item => item.target.path === target.path && item.operation === 'delete');
  assert.equal(removed?.baseHash, change.hash);
});
