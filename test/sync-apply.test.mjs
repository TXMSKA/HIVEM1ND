import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashBytes, uuidV8 } from '../engine/service/identity.mjs';
import { servicePaths } from '../engine/service/paths.mjs';
import { createStore } from '../engine/service/store.mjs';
import { undoChange } from '../engine/service/store.mjs';
import { createGroup, patchGroup, removeGroup } from '../engine/service/groups.mjs';
import { createFolder, createText, moveEditor, readEditor, removeEditor } from '../engine/service/editors.mjs';
import { listHistory, replaceText, resolveConflict, restoreHistory } from '../engine/service/editors.mjs';
import { readCollection, readProjection } from '../engine/service/projection.mjs';
import { importedSidecarEvents } from '../engine/service/import-events.mjs';
import { createSettingsOwner, publishMachineSettings, readPublishedSettings, writeContent, readContent } from '../engine/service/settings.mjs';
import { applyPack, compareVersions, recoverIncomingGroups } from '../engine/sync/apply.mjs';
import { limitsFor, openLedger } from '../engine/sync/limits.mjs';
import { closeOrigin, openOrigin, publishBeat, publishPack, readHead, watchOrigin } from '../engine/sync/origin.mjs';
import { encodePack } from '../engine/sync/pack.mjs';
import { startService, stopService } from '../engine/service/service.mjs';
import { ackPublished, eligibleTargets, listStaged, observeLocalChange, openSync, readObject, settleAppliedMarker, stageBaselines, stageTransaction, targetKey } from '../engine/sync/store.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const AT = '2026-10-10T12:00:00.000Z';
const LATER = '2026-10-10T12:00:05.000Z';

test('machine Settings reports sync only from their owner, preserve offline reads and reject private or tampered records before writes', async t => {
  const { fixture, desktop, laptop } = await world(t);
  laptop.store.aclRunner = fixture.store.aclRunner;
  const owner = createSettingsOwner({ ...laptop, env: { PATH: '' }, homeDir: fixture.home, projects: [], probeAgents: async () => ({}) });
  const report = await publishMachineSettings(owner);
  const target = { kind: 'mind', path: 'user/machines/LAPTOP/settings.json' };
  const raw = Buffer.from(`${JSON.stringify(report)}\n`);
  const incoming = pack([put(target, raw)], [{ hash: hashBytes(raw), raw }]);
  assert.equal((await applyPack(desktop, incoming)).status, 'applied');
  assert.deepEqual(await readPublishedSettings({ ...desktop, now: desktop.now }, 'LAPTOP'), report);
  const events = await importedSidecarEvents({ ...desktop, now: desktop.now }, { target, operation: 'put' });
  assert.deepEqual(events.events.map(event => event.name), Array(4).fill('machine.settings.changed'));
  assert.equal(events.events.some(event => JSON.stringify(event.data).includes('publicKey')), false);
  const before = await readFile(path.join(fixture.paths.mind, target.path));
  const altered = Buffer.from(JSON.stringify({ ...report, locations: { mind: 'forged', staging: 'forged' } }));
  await assert.rejects(applyPack(desktop, pack([put(target, altered, { at: LATER })], [{ hash: hashBytes(altered), raw: altered }], { sequence: 2 })), { code: 'corrupt_resource' });
  const privateReport = Buffer.from(JSON.stringify({ ...report, secret: 'fixture-only-private-material' }));
  await assert.rejects(applyPack(desktop, pack([put(target, privateReport, { at: LATER })], [{ hash: hashBytes(privateReport), raw: privateReport }], { sequence: 2 })), { code: 'unknown_field' });
  const wrongOwner = pack([put(target, raw, { machine: 'OTHER' })], [{ hash: hashBytes(raw), raw }], { machine: 'OTHER' });
  await assert.rejects(applyPack(desktop, wrongOwner), { code: 'invalid_record_owner' });
  assert.deepEqual(await readFile(path.join(fixture.paths.mind, target.path)), before);
  assert.equal((await eligibleTargets(desktop)).some(item => item.path === target.path), false);
  assert.equal((await eligibleTargets(laptop)).some(item => item.path === target.path), true);
  assert.equal((await eligibleTargets(laptop)).some(item => item.path.includes('settings-owner-key')), false);
});

test('Content selections and preferences replicate together without changing a peer client configuration', async t => {
  const { fixture, desktop, laptop } = await world(t);
  laptop.store.aclRunner = fixture.store.aclRunner;
  const owner = createSettingsOwner({ ...laptop, env: { PATH: '' }, homeDir: fixture.home, projects: [] });
  const content = await readContent(owner);
  const updated = await writeContent(owner, { includedFeatures: content.features.filter(item => item.included).map(item => item.id), includedKnowledge: content.knowledge.filter(item => item.included).map(item => item.id),
    preferences: { addressStyle: 'explanatory', additionalInstructions: 'Shared preferences fixture.', keepExistingPreferencesFirst: true, updateChecks: 'daily' }, expectedRevision: null });
  const changes = await listStaged(laptop);
  const objects = await Promise.all([...new Set(changes.map(change => change.hash).filter(Boolean))].map(async hash => ({ hash, raw: await readObject(laptop, hash) })));
  assert.equal((await applyPack(desktop, encodePack({ machine: 'LAPTOP', sequence: 1, changes, objects, transactions: [{ id: changes[0].transactionId, changeIds: changes.map(change => change.id) }] }))).status, 'applied');
  const peer = createSettingsOwner({ ...desktop, env: { PATH: '' }, homeDir: fixture.home, projects: [] });
  assert.deepEqual((await readContent(peer)).preferences, updated.preferences);
  assert.equal((await readContent(peer)).revision, updated.revision);
  assert.equal(await readFile(path.join(desktop.paths.mind, 'user/preferences.md'), 'utf8'), await readFile(path.join(laptop.paths.mind, 'user/preferences.md'), 'utf8'));
  const clients = await readdir(fixture.home);
  assert.equal(clients.some(name => ['.codex', '.agents', '.claude', '.cursor'].includes(name)), false);
});

function put(target, raw, extra = {}) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  return {
    format: 'hivem1nd-change-v1',
    id: extra.id ?? uuidV8(['change', target.path, extra.at ?? AT, extra.machine ?? 'LAPTOP']),
    machine: extra.machine ?? 'LAPTOP',
    at: extra.at ?? AT,
    target,
    operation: 'put',
    hash: hashBytes(bytes),
    size: bytes.length,
    baseHash: extra.baseHash ?? null,
    messageId: null,
    transactionId: extra.transactionId ?? null,
  };
}

function pack(changes, objects, extra = {}) {
  return encodePack({
    machine: extra.machine ?? 'LAPTOP',
    sequence: extra.sequence ?? 1,
    changes,
    objects,
    dependencies: extra.dependencies ?? [],
    transactions: extra.transactions ?? [],
  });
}

async function world(t) {
  const fixture = await makeCoreFixture({ machine: 'DESKTOP' });
  t.after(() => dispose(fixture));
  const origin = path.join(fixture.root, 'origin');
  await mkdir(path.join(origin, 'machines'), { recursive: true });
  fixture.paths.origin = origin;
  const laptopMind = path.join(fixture.root, 'localappdata', 'Cosmic', 'laptop-mind');
  await mkdir(path.join(laptopMind, 'user'), { recursive: true });
  const laptopPaths = servicePaths({
    platform: 'win32',
    env: fixture.env,
    home: fixture.home,
    machine: 'LAPTOP',
    mindPath: laptopMind,
    originPath: origin,
  });
  await mkdir(laptopPaths.localDirectory, { recursive: true });
  const laptopStore = createStore({
    root: fixture.root,
    confineRoot: fixture.root,
    mindPath: laptopMind,
    localDirectory: laptopPaths.localDirectory,
    now: () => fixture.clock.now,
    events: [],
  });
  const desktop = openSync({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now });
  const laptop = openSync({ store: laptopStore, paths: laptopPaths, now: () => fixture.clock.now });
  const desktopOrigin = openOrigin({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, machine: 'DESKTOP' });
  const laptopOrigin = openOrigin({ store: laptopStore, paths: laptopPaths, now: () => fixture.clock.now, machine: 'LAPTOP' });
  const ledger = openLedger({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, machine: 'DESKTOP' });
  return { fixture, desktop, laptop, desktopOrigin, laptopOrigin, ledger };
}

test('library empty folders physical moves deletion tombstones and Undo replicate as recoverable whole transactions', async (t) => {
  const { fixture, desktop, laptop, laptopOrigin } = await world(t);
  laptop.store.aclRunner = fixture.store.aclRunner;
  for (const sync of [desktop, laptop]) {
    sync.projects = [];
    for (const name of ['shop', 'api']) {
      const localPath = path.join(fixture.root, `${sync.machine}-${name}`);
      await mkdir(localPath, { recursive: true });
      sync.projects.push({ name, localPath });
    }
  }
  const context = { store: laptop.store, paths: laptop.paths, sync: laptop, projects: laptop.projects,
    now: () => fixture.clock.now, principal: { audience: 'desktop', unitId: 'root:master' } };
  let sequence = 0;
  async function transfer({ offline = false, crash = false } = {}) {
    const changes = await listStaged(laptop);
    const objects = await Promise.all([...new Set(changes.map((change) => change.hash).filter(Boolean))].map(async (hash) => ({ hash, raw: await readObject(laptop, hash) })));
    const groups = new Map();
    for (const change of changes) {
      const ids = groups.get(change.transactionId) ?? [];
      ids.push(change.id);
      groups.set(change.transactionId, ids);
    }
    const bytes = encodePack({ machine: 'LAPTOP', sequence: ++sequence, changes, objects,
      transactions: [...groups].map(([id, changeIds]) => ({ id, changeIds })) });
    await publishPack(laptopOrigin, bytes);
    if (offline) {
      const projects = desktop.projects;
      desktop.projects = projects.filter((project) => project.name !== 'api');
      const catalogBefore = await readFile(path.join(desktop.paths.mind, 'user/gui/resources.json'));
      assert.equal((await applyPack(desktop, bytes)).status, 'pending');
      assert.deepEqual(await readFile(path.join(desktop.paths.mind, 'user/gui/resources.json')), catalogBefore);
      desktop.projects = projects;
    }
    if (crash) {
      desktop.applyFault = { afterWrites: 2 };
      await assert.rejects(() => applyPack(desktop, bytes), { code: 'injected_crash' });
      await recoverIncomingGroups(desktop);
    }
    assert.equal((await applyPack(desktop, bytes)).status, 'applied');
    await ackPublished(laptop, changes.map((change) => change.id));
    return changes;
  }
  const folder = await createFolder(context, { project: 'shop', kind: 'void', title: 'Empty folder', parentId: null, expectedRevision: null });
  assert.ok((await eligibleTargets(laptop)).some((target) => target.kind === 'project' && target.path === 'docs/flows/library.json'));
  await transfer();
  fixture.clock.now += 1;
  const text = await createText(context, { project: 'shop', path: 'docs/source.json', folderId: folder.folder.id,
    document: { title: 'Source', foreign: { nested: [1, { kept: true }] }, pages: [{ k: 'A', en: 'Exact text' }] } });
  await transfer();
  fixture.clock.now += 1;
  const current = await readEditor(context, text.id);
  const moved = await moveEditor(context, text.id, { project: 'api', path: 'docs/moved.json', folderId: null, confirmedRepositoryChange: true,
    expectedRevision: current.revision, expectedCommentsRevision: current.commentsRevision, expectedAttachmentRevision: current.attachmentRevision, expectedLibraryRevision: current.libraryRevision });
  const moveChanges = await transfer({ offline: true, crash: true });
  assert.ok(moveChanges.some((change) => change.operation === 'delete' && change.target.path === 'docs/source.json' && change.hash === null && change.size === 0));
  const sourceRoot = desktop.projects.find((project) => project.name === 'shop').localPath;
  const targetRoot = desktop.projects.find((project) => project.name === 'api').localPath;
  await assert.rejects(() => readFile(path.join(sourceRoot, 'docs/source.json')), { code: 'ENOENT' });
  assert.deepEqual(JSON.parse(await readFile(path.join(targetRoot, 'docs/moved.json'))).foreign, text.document.foreign);
  fixture.clock.now += 1;
  await undoChange(context, moved.changeId);
  await transfer();
  assert.equal(JSON.parse(await readFile(path.join(sourceRoot, 'docs/source.json'))).title, 'Source');
  await assert.rejects(() => readFile(path.join(targetRoot, 'docs/moved.json')), { code: 'ENOENT' });
  fixture.clock.now += 1;
  const restored = await readEditor(context, text.id);
  const deletion = await removeEditor(context, text.id, { confirmed: true, expectedRevision: restored.revision, expectedCommentsRevision: restored.commentsRevision,
    expectedAttachmentRevision: restored.attachmentRevision, expectedLibraryRevision: restored.libraryRevision });
  const deletes = await transfer({ crash: true });
  assert.ok(deletes.filter((change) => change.operation === 'delete').length >= 5);
  await assert.rejects(() => readFile(path.join(sourceRoot, 'docs/source.json')), { code: 'ENOENT' });
  const imported = await importedSidecarEvents({ ...context, paths: desktop.paths, store: desktop.store, projects: desktop.projects }, deletes.find((change) => change.target.path === 'docs/source.json'));
  assert.equal(imported.events[0].name, 'editor.removed');
  fixture.clock.now += 1;
  await undoChange(context, deletion.changeId);
  await transfer();
  assert.deepEqual(await readFile(path.join(sourceRoot, 'docs/source.json')), await readFile(path.join(laptop.projects[0].localPath, 'docs/source.json')));
});

test('a newer source revision prevents every logical write in an incoming library move', async (t) => {
  const { fixture, desktop } = await world(t);
  const localPath = path.join(fixture.root, 'shop');
  await mkdir(path.join(localPath, 'docs/flows'), { recursive: true });
  desktop.projects = [{ name: 'shop', localPath }];
  const sourceId = uuidV8(['editor', 'void', 'shop', 'docs/source.json']);
  const destinationId = uuidV8(['editor', 'void', 'shop', 'docs/destination.json']);
  const catalogPath = path.join(desktop.paths.mind, 'user/gui/resources.json');
  const catalog = Buffer.from(JSON.stringify({ format: 'hivem1nd-resources-v1', resources: [{ id: sourceId, project: 'shop', kind: 'void', path: 'docs/source.json' }] }));
  const library = Buffer.from(JSON.stringify({ format: 'hivem1nd-library-v1', folders: [], items: {} }));
  const current = Buffer.from('Newer source');
  await mkdir(path.dirname(catalogPath), { recursive: true });
  await writeFile(catalogPath, catalog);
  await writeFile(path.join(localPath, 'docs/flows/library.json'), library);
  await writeFile(path.join(localPath, 'docs/source.json'), current);
  await observeLocalChange(desktop, { kind: 'project', project: 'shop', path: 'docs/source.json' }, { bytes: current, at: LATER });
  const transactionId = uuidV8(['conflicting-library-move']);
  const incoming = Buffer.from('Older source');
  const nextCatalog = Buffer.from(JSON.stringify({ format: 'hivem1nd-resources-v1', resources: [{ id: destinationId, project: 'shop', kind: 'void', path: 'docs/destination.json' }] }));
  const records = [
    put({ kind: 'mind', path: 'user/gui/resources.json' }, nextCatalog, { transactionId }),
    { ...put({ kind: 'project', project: 'shop', path: 'docs/source.json' }, incoming, { transactionId }), operation: 'delete', hash: null, size: 0 },
    put({ kind: 'project', project: 'shop', path: 'docs/destination.json' }, incoming, { transactionId }),
    put({ kind: 'project', project: 'shop', path: 'docs/flows/library.json' }, library, { transactionId }),
  ];
  const bytes = pack(records, [nextCatalog, incoming, library].map((raw) => ({ hash: hashBytes(raw), raw })), { transactions: [{ id: transactionId, changeIds: records.map((change) => change.id) }] });
  assert.equal((await applyPack(desktop, bytes)).status, 'applied');
  assert.deepEqual(await readFile(catalogPath), catalog);
  assert.deepEqual(await readFile(path.join(localPath, 'docs/source.json')), current);
  await assert.rejects(() => readFile(path.join(localPath, 'docs/destination.json')), { code: 'ENOENT' });
  assert.deepEqual(await readFile(path.join(localPath, 'docs/flows/library.json')), library);
});

test('version order keeps both conflict bytes and breaks equal-time ties', async (t) => {
  const { fixture, desktop, laptopOrigin } = await world(t);
  const newer = Buffer.from('newer text');
  const older = Buffer.from('older text');
  const target = { kind: 'mind', path: 'user/doc.txt' };
  const first = pack([put(target, newer, { at: LATER })], [{ hash: hashBytes(newer), raw: newer }]);
  await publishPack(laptopOrigin, first);
  assert.equal((await readHead(laptopOrigin, 'LAPTOP')).sequence, 1);
  await applyPack(desktop, first, { ledger: null });
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'doc.txt'), 'utf8'), 'newer text');
  const second = pack([put(target, older, { at: AT })], [{ hash: hashBytes(older), raw: older }], { sequence: 2 });
  await publishPack(laptopOrigin, second);
  await applyPack(desktop, second);
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'doc.txt'), 'utf8'), 'newer text');
  const conflict = await readFile(path.join(fixture.paths.mind, 'user', `doc.txt.conflict-LAPTOP-${AT.replace(/[-:]/g, '').replace(/\./g, '')}`), 'utf8');
  assert.equal(conflict, 'older text');
  assert.equal(desktop.store.events.filter((event) => event.type === 'sync.conflict').length, 1);
  await applyPack(desktop, second);
  assert.equal(desktop.store.events.filter((event) => event.type === 'sync.conflict').length, 1);
  const sameTime = Buffer.from('tie text');
  const tieTarget = { kind: 'mind', path: 'user/tie.txt' };
  await writeFile(path.join(fixture.paths.mind, 'user', 'tie.txt'), 'desktop text');
  await stageTransaction(desktop, [{ target: tieTarget, bytes: Buffer.from('desktop text'), at: AT, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }]);
  const tied = pack([put(tieTarget, sameTime, { at: AT, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' })], [{ hash: hashBytes(sameTime), raw: sameTime }], { sequence: 3 });
  await applyPack(desktop, tied);
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'tie.txt'), 'utf8'), 'tie text');
  assert.equal(compareVersions({ at: AT, machine: 'LAPTOP', id: 'b' }, { at: AT, machine: 'DESKTOP', id: 'b' }) > 0, true);
});

test('delete and edit each win when newer, and an old edit cannot revive a tombstone', async (t) => {
  const { fixture, desktop } = await world(t);
  const target = { kind: 'mind', path: 'user/life.txt' };
  const body = Buffer.from('keep me');
  await applyPack(desktop, pack([put(target, body, { at: AT })], [{ hash: hashBytes(body), raw: body }]));
  const removal = {
    ...put(target, body, { at: LATER }),
    operation: 'delete',
    hash: null,
    size: 0,
  };
  await applyPack(desktop, pack([removal], [], { sequence: 2 }));
  await assert.rejects(() => readFile(path.join(fixture.paths.mind, 'user', 'life.txt')));
  const preserved = await readFile(path.join(fixture.paths.mind, 'user', `life.txt.conflict-LAPTOP-${LATER.replace(/[-:]/g, '').replace(/\./g, '')}`), 'utf8');
  assert.equal(preserved, 'keep me');
  const revival = Buffer.from('too old');
  await applyPack(desktop, pack([put(target, revival, { at: '2026-10-10T11:59:00.000Z' })], [{ hash: hashBytes(revival), raw: revival }], { sequence: 3 }));
  await assert.rejects(() => readFile(path.join(fixture.paths.mind, 'user', 'life.txt')));
  const restored = Buffer.from('restored');
  const other = { kind: 'mind', path: 'user/other.txt' };
  await applyPack(desktop, pack([put(other, body, { at: AT })], [{ hash: hashBytes(body), raw: body }], { sequence: 4 }));
  await applyPack(desktop, pack([{
    ...put(other, body, { at: '2026-10-10T12:00:01.000Z' }),
    operation: 'delete',
    hash: null,
    size: 0,
  }], [], { sequence: 5 }));
  await applyPack(desktop, pack([put(other, restored, { at: LATER })], [{ hash: hashBytes(restored), raw: restored }], { sequence: 6 }));
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'other.txt'), 'utf8'), 'restored');
});

test('a local unpublished edit survives an older import', async (t) => {
  const { fixture, desktop } = await world(t);
  const target = { kind: 'mind', path: 'user/local.txt' };
  await writeFile(path.join(fixture.paths.mind, 'user', 'local.txt'), 'local edit');
  await stageTransaction(desktop, [{ target, bytes: Buffer.from('local edit'), at: LATER }]);
  const incoming = Buffer.from('remote edit');
  await applyPack(desktop, pack([put(target, incoming, { at: AT })], [{ hash: hashBytes(incoming), raw: incoming }]));
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'local.txt'), 'utf8'), 'local edit');
  const conflict = await readFile(path.join(fixture.paths.mind, 'user', `local.txt.conflict-LAPTOP-${AT.replace(/[-:]/g, '').replace(/\./g, '')}`), 'utf8');
  assert.equal(conflict, 'remote edit');
});

test('immutable bytes and the wrong owner are rejected before writes', async (t) => {
  const { fixture, desktop } = await world(t);
  const message = path.join(fixture.paths.mind, 'user', 'inbox', 'master');
  await mkdir(message, { recursive: true });
  await writeFile(path.join(message, 'one.md'), 'id: one\n\nOriginal\n');
  const changed = Buffer.from('id: one\n\nChanged\n');
  await assert.rejects(() => applyPack(desktop, pack([
    put({ kind: 'mind', path: 'user/inbox/master/one.md' }, changed),
  ], [{ hash: hashBytes(changed), raw: changed }])), (error) => error.code === 'corrupt_resource');
  assert.equal(await readFile(path.join(message, 'one.md'), 'utf8'), 'id: one\n\nOriginal\n');
  const approvalId = uuidV8(['approval']);
  const result = Buffer.from(JSON.stringify({
    format: 'hivem1nd-approval-result-v1',
    approvalId,
    state: 'approved',
    answerId: null,
    grantId: null,
    at: AT,
  }));
  await assert.rejects(() => applyPack(desktop, pack([
    put({ kind: 'mind', path: `user/relay/approvals/${approvalId}/result.json` }, result),
  ], [{ hash: hashBytes(result), raw: result }], { sequence: 1 }), {
    bindings: { approvals: { [approvalId]: { machine: 'DESKTOP' } } },
  }), (error) => error.code === 'invalid_record_owner');
  await assert.rejects(() => readFile(path.join(fixture.paths.mind, 'user', 'relay', 'approvals', approvalId, 'result.json')));
  const ahead = Buffer.from('future');
  await assert.rejects(() => applyPack(desktop, pack([
    put({ kind: 'mind', path: 'user/future.txt' }, ahead, { at: '2026-10-10T12:00:31.000Z' }),
  ], [{ hash: hashBytes(ahead), raw: ahead }], { sequence: 1 })), (error) => error.code === 'invalid_pack');
});

test('a missing dependency stays pending and a later copy does not charge twice', async (t) => {
  const { desktop, ledger } = await world(t);
  const raw = Buffer.from('shared');
  const hash = hashBytes(raw);
  const base = pack([put({ kind: 'mind', path: 'user/base.txt' }, raw)], [{ hash, raw }], { sequence: 1 });
  const laterChange = put({ kind: 'mind', path: 'user/later.txt' }, raw, { at: LATER });
  const later = pack([laterChange], [], {
    sequence: 2,
    dependencies: [{ hash, machine: 'LAPTOP', sequence: 1, packHash: hashBytes(base) }],
  });
  const head = {
    format: 'hivem1nd-head-v1',
    machine: 'LAPTOP',
    sequence: 1,
    updatedAt: AT,
    packs: [{ sequence: 1, file: '000000000001.pack', hash: hashBytes(base), bytes: base.length }],
  };
  await applyPack(desktop, base, { ledger: null });
  const pending = await applyPack(desktop, later, {
    ledger,
    provider: { async readHead() { return head; }, async readPack() { return null; } },
  });
  assert.equal(pending.status, 'pending');
  const charged = (await limitsFor(ledger, 'receipt', 'LAPTOP')).syncBytes.used;
  assert.equal(charged, later.length);
  const applied = await applyPack(desktop, later, {
    ledger,
    provider: { async readHead() { return head; }, async readPack() { return base; } },
  });
  assert.equal(applied.status, 'applied');
  assert.equal((await limitsFor(ledger, 'receipt', 'LAPTOP')).syncBytes.used, charged);
  assert.equal(await readFile(path.join(desktop.paths.mind, 'user', 'later.txt'), 'utf8'), 'shared');
});

test('a crashed group resumes once and a crashed head is not reused for other bytes', async (t) => {
  const { fixture, desktop, laptopOrigin } = await world(t);
  const left = Buffer.from('left');
  const right = Buffer.from('right');
  const transactionId = uuidV8(['group']);
  const first = put({ kind: 'mind', path: 'user/left.txt' }, left, { transactionId, id: uuidV8(['left']) });
  const second = put({ kind: 'mind', path: 'user/right.txt' }, right, { transactionId, at: LATER, id: uuidV8(['right']) });
  const grouped = pack([first, second], [{ hash: hashBytes(left), raw: left }, { hash: hashBytes(right), raw: right }], {
    transactions: [{ id: transactionId, changeIds: [first.id, second.id] }],
  });
  desktop.applyFault = { afterWrites: 1 };
  await assert.rejects(() => applyPack(desktop, grouped), (error) => error.code === 'injected_crash');
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'left.txt'), 'utf8'), 'left');
  await assert.rejects(() => readFile(path.join(fixture.paths.mind, 'user', 'right.txt')));
  await applyPack(desktop, grouped);
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'right.txt'), 'utf8'), 'right');
  assert.equal(desktop.store.events.filter((event) => event.type === 'sync.applied').length, 1);
  const beat = { format: 'hivem1nd-service-v1', machine: 'LAPTOP', state: 'running', version: '3.0.0', heartbeatAt: AT, startedAt: AT };
  laptopOrigin.fault = 'before-head';
  const crashBody = Buffer.from('crash');
  const bytes = pack([put({ kind: 'mind', path: 'user/crash.txt' }, crashBody)], [{ hash: hashBytes(crashBody), raw: crashBody }]);
  const otherBody = Buffer.from('other');
  const other = pack([put({ kind: 'mind', path: 'user/other-crash.txt' }, otherBody, { id: uuidV8(['other-crash']) })], [{ hash: hashBytes(otherBody), raw: otherBody }]);
  await assert.rejects(() => publishPack(laptopOrigin, bytes), (error) => error.code === 'injected_crash');
  assert.equal(await readHead(laptopOrigin, 'LAPTOP'), null);
  await assert.rejects(() => publishPack(laptopOrigin, other), (error) => error.code === 'revision_conflict');
  const parked = await readFile(path.join(fixture.root, 'origin', 'machines', 'LAPTOP', 'packs', '000000000001.pack'));
  assert.equal(hashBytes(parked), hashBytes(bytes));
  await publishPack(laptopOrigin, bytes);
  assert.equal((await readHead(laptopOrigin, 'LAPTOP')).packs[0].hash, hashBytes(bytes));
  await publishBeat(laptopOrigin, beat);
  const service = JSON.parse(await readFile(path.join(fixture.root, 'origin', 'machines', 'LAPTOP', 'service.json'), 'utf8'));
  assert.equal(service.machine, 'LAPTOP');
});

test('local recovery finishes a crashed delete and put group without an origin or a second receipt charge', async (t) => {
  for (const afterWrites of [2, 3]) await t.test(`after operation ${afterWrites}`, async (t) => {
    const { fixture, desktop, ledger } = await world(t);
    const removedTarget = { kind: 'mind', path: 'user/removed.txt' };
    const addedTarget = { kind: 'mind', path: 'user/added.txt' };
    await writeFile(path.join(fixture.paths.mind, 'user', 'removed.txt'), 'previous');
    const raw = Buffer.from('imported');
    const transactionId = uuidV8(['recover-offline', afterWrites]);
    const removal = { ...put(removedTarget, raw, { transactionId, at: LATER }), operation: 'delete', hash: null, size: 0 };
    const addition = put(addedTarget, raw, { transactionId, at: LATER });
    const body = pack([removal, addition], [{ hash: hashBytes(raw), raw }], {
      transactions: [{ id: transactionId, changeIds: [removal.id, addition.id] }],
    });
    desktop.applyFault = { afterWrites };
    await assert.rejects(() => applyPack(desktop, body, { ledger }), { code: 'injected_crash' });
    const charged = (await limitsFor(ledger, 'receipt', 'LAPTOP')).syncBytes.used;
    const restarted = openSync({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now });
    assert.deepEqual(await recoverIncomingGroups(restarted), [transactionId]);
    assert.deepEqual(await recoverIncomingGroups(restarted), []);
    await assert.rejects(() => readFile(path.join(fixture.paths.mind, 'user', 'removed.txt')), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'added.txt'), 'utf8'), 'imported');
    const baseline = await stageBaselines(restarted);
    assert.equal(baseline.some(change => ['user/removed.txt', 'user/added.txt'].includes(change.target.path)), false);
    assert.equal((await limitsFor(ledger, 'receipt', 'LAPTOP')).syncBytes.used, charged);
    await applyPack(restarted, body, { ledger });
    assert.equal((await limitsFor(ledger, 'receipt', 'LAPTOP')).syncBytes.used, charged);
    const applied = JSON.parse(await readFile(path.join(fixture.paths.localDirectory, 'received', 'LAPTOP', '1.applied.json'), 'utf8'));
    assert.deepEqual(applied.targets, [removedTarget, addedTarget]);
  });
});

test('local recovery rejects a remove journal outside the mind and local service roots', async (t) => {
  const { fixture, desktop } = await world(t);
  const id = uuidV8(['unsafe-recovery']);
  const outside = path.join(fixture.root, 'outside.txt');
  await writeFile(outside, 'keep');
  const directory = path.join(fixture.paths.localDirectory, 'received', 'groups');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${id}.json`), JSON.stringify({ id, done: 0, emitted: false, events: [], ops: [{ kind: 'remove', file: outside }] }));
  await assert.rejects(() => recoverIncomingGroups(desktop), { code: 'unsafe_path' });
  assert.equal(await readFile(outside, 'utf8'), 'keep');
});

test('only a completed import marker can settle before a later local edit, preserving held bytes once', async (t) => {
  const { fixture, desktop } = await world(t);
  const raw = Buffer.from('imported');
  const later = Buffer.from('local after import');
  const incompleteTarget = { kind: 'mind', path: 'user/incomplete.txt' };
  await observeLocalChange(desktop, incompleteTarget, { bytes: raw, applied: true, machine: 'LAPTOP', at: AT });
  assert.equal((await settleAppliedMarker(desktop, incompleteTarget)).settled, false);
  const target = { kind: 'mind', path: 'user/settled.txt' };
  await applyPack(desktop, pack([put(target, raw)], [{ hash: hashBytes(raw), raw }]));
  await writeFile(path.join(fixture.paths.mind, 'user', 'settled.txt'), later);
  const writes = fixture.store.writes.length;
  const preview = await observeLocalChange(desktop, target, { bytes: later, stage: false });
  assert.equal(preview.held, true);
  assert.equal(fixture.store.writes.length, writes);
  const settled = await settleAppliedMarker(desktop, target);
  assert.equal(settled.settled, true);
  assert.equal(settled.change, null);
  assert.equal((await observeLocalChange(desktop, target, { bytes: later, stage: false })).changed, true);
  const edited = await observeLocalChange(desktop, target, { bytes: later });
  assert.equal(edited.staged, true);
  assert.equal(edited.change.baseHash, hashBytes(raw));
  const heldTarget = { kind: 'mind', path: 'user/held.txt' };
  await applyPack(desktop, pack([put(heldTarget, raw, { id: uuidV8(['held-import']) })], [{ hash: hashBytes(raw), raw }], { sequence: 2 }));
  assert.equal((await observeLocalChange(desktop, heldTarget, { bytes: later })).held, true);
  const restored = await settleAppliedMarker(desktop, heldTarget);
  assert.equal(restored.settled, true);
  assert.equal(restored.change.hash, hashBytes(later));
  assert.equal(restored.change.baseHash, hashBytes(raw));
  assert.equal((await settleAppliedMarker(desktop, heldTarget)).settled, false);
  assert.equal((await listStaged(desktop)).filter(change => change.target.path === heldTarget.path).length, 1);
});

test('a service save immediately after import retires its marker and keeps earlier held bytes', async (t) => {
  const { desktop } = await world(t);
  const raw = Buffer.from('imported');
  const local = Buffer.from('own save');
  const held = Buffer.from('earlier external bytes');
  const targets = [
    { kind: 'mind', path: 'user/own-after-import.txt' },
    { kind: 'mind', path: 'user/own-after-held.txt' },
  ];
  await applyPack(desktop, pack(targets.map(target => put(target, raw)), [{ hash: hashBytes(raw), raw }]));
  assert.equal((await observeLocalChange(desktop, targets[1], { bytes: held })).held, true);
  const transactionId = uuidV8(['own-after-import']);
  const changes = await stageTransaction(desktop, targets.map(target => ({ target, bytes: local })), { transactionId });
  assert.equal(changes.every(change => change.transactionId === transactionId), true);
  for (const target of targets) {
    assert.equal((await settleAppliedMarker(desktop, target)).settled, false);
    assert.equal((await observeLocalChange(desktop, target, { bytes: local, stage: false })).changed, false);
  }
  const staged = await listStaged(desktop);
  assert.equal(staged.filter(change => change.target.path === targets[1].path && change.hash === hashBytes(held)).length, 1);
  const later = await observeLocalChange(desktop, targets[0], { bytes: Buffer.from('next outside edit') });
  assert.equal(later.staged, true);
});

test('a retained local reversion after import is not confused with older pending identical bytes', async t => {
  const { fixture, desktop } = await world(t);
  const target = { kind: 'mind', path: 'user/retained-reversion.txt' };
  const first = Buffer.from('A');
  const imported = Buffer.from('B');
  const original = await observeLocalChange(desktop, target, { bytes: first });
  const incoming = put(target, imported, { at: LATER });
  await applyPack(desktop, pack([incoming], [{ hash: incoming.hash, raw: imported }]));
  fixture.clock.now += 10000;
  await writeFile(path.join(fixture.paths.mind, 'user', 'retained-reversion.txt'), first);
  assert.equal((await observeLocalChange(desktop, target, { bytes: first })).held, true);
  const retained = await settleAppliedMarker(desktop, target);
  assert.equal(retained.settled, true);
  assert.notEqual(retained.change.id, original.change.id);
  assert.equal(retained.change.at, new Date(fixture.clock.now).toISOString());
  assert.equal(retained.change.baseHash, incoming.hash);
  assert.equal((await listStaged(desktop)).filter(change => change.target.path === target.path).length, 2);
  assert.equal((await observeLocalChange(desktop, target, { bytes: first, stage: false })).changed, false);
  assert.equal((await observeLocalChange(desktop, target, { bytes: first })).unchanged, true);
});

test('a registered project imports only cataloged documents, sidecars, and assets', async (t) => {
  const { fixture, desktop } = await world(t);
  const shop = path.join(fixture.root, 'shop');
  await mkdir(path.join(shop, 'gui'), { recursive: true });
  await mkdir(path.join(shop, 'docs'), { recursive: true });
  await mkdir(path.join(fixture.paths.mind, 'user', 'gui'), { recursive: true });
  await writeFile(path.join(shop, 'README.md'), 'local');
  await writeFile(path.join(shop, 'docs', 'release.json'), '{"title":"Release","cover":"docs/flows/assets/icon.png"}\n');
  await writeFile(path.join(shop, 'gui', 'resources.json'), '{"format":"hivem1nd-resources-v1","resources":[{"project":"shop","path":"README.md"}]}\n');
  await writeFile(path.join(fixture.paths.mind, 'user', 'gui', 'resources.json'), `${JSON.stringify({
    format: 'hivem1nd-resources-v1',
    resources: [{ id: '10943b49-2c8a-4b30-b3aa-2d431e34a551', kind: 'void', project: 'shop', path: 'docs/release.json', legacyId: null }],
  })}\n`);
  desktop.projects = [{ name: 'shop', localPath: shop }];
  const readme = Buffer.from('replaced');
  await assert.rejects(() => applyPack(desktop, pack([
    put({ kind: 'project', project: 'shop', path: 'README.md' }, readme),
  ], [{ hash: hashBytes(readme), raw: readme }]), { projects: desktop.projects }), (error) => error.code === 'invalid_pack');
  assert.equal(await readFile(path.join(shop, 'README.md'), 'utf8'), 'local');
  const icon = Buffer.from('png');
  await applyPack(desktop, pack([
    put({ kind: 'project', project: 'shop', path: 'docs/flows/assets/icon.png' }, icon),
  ], [{ hash: hashBytes(icon), raw: icon }], { sequence: 1 }), { projects: desktop.projects });
  assert.equal(await readFile(path.join(shop, 'docs', 'flows', 'assets', 'icon.png'), 'utf8'), 'png');
  const notes = Buffer.from('{"title":"Imported"}\n');
  await applyPack(desktop, pack([
    put({ kind: 'project', project: 'shop', path: 'docs/release.json' }, notes, { at: LATER }),
  ], [{ hash: hashBytes(notes), raw: notes }], { sequence: 2 }), { projects: desktop.projects });
  assert.equal(await readFile(path.join(shop, 'docs', 'release.json'), 'utf8'), '{"title":"Imported"}\n');
  const comments = Buffer.from('{"threads":[]}\n');
  await applyPack(desktop, pack([
    put({ kind: 'project', project: 'shop', path: 'docs/release.comments.json' }, comments),
  ], [{ hash: hashBytes(comments), raw: comments }], { sequence: 3 }), { projects: desktop.projects });
  assert.equal(await readFile(path.join(shop, 'docs', 'release.comments.json'), 'utf8'), '{"threads":[]}\n');
  const evil = Buffer.from('evil');
  await assert.rejects(() => applyPack(desktop, pack([
    put({ kind: 'project', project: 'shop', path: 'docs/flows/assets/evil.png' }, evil),
  ], [{ hash: hashBytes(evil), raw: evil }], { sequence: 4 }), { projects: desktop.projects }), (error) => error.code === 'invalid_pack');
  await assert.rejects(() => readFile(path.join(shop, 'docs', 'flows', 'assets', 'evil.png')));
});

test('missing owners stay pending and inconsistent owners are rejected', async (t) => {
  const { fixture, desktop } = await world(t);
  const requestId = uuidV8(['request']);
  const sessionId = uuidV8(['session']);
  const unbound = Buffer.from(JSON.stringify({
    format: 'hivem1nd-session-result-v1',
    id: uuidV8(['result']),
    requestId,
    machine: 'LAPTOP',
    state: 'done',
  }));
  const pending = await applyPack(desktop, pack([
    put({ kind: 'mind', path: 'user/relay/results/one.json' }, unbound),
  ], [{ hash: hashBytes(unbound), raw: unbound }]));
  assert.equal(pending.status, 'pending');
  assert.equal(pending.code, 'owner_unavailable');
  await assert.rejects(() => readFile(path.join(fixture.paths.mind, 'user', 'relay', 'results', 'one.json')));
  const request = Buffer.from(JSON.stringify({
    format: 'hivem1nd-session-request-v1', id: requestId, targetMachine: 'DESKTOP',
  }));
  const bound = Buffer.from(JSON.stringify({
    format: 'hivem1nd-session-result-v1', id: uuidV8(['result', 'bound']), requestId, machine: 'LAPTOP', state: 'done',
  }));
  await assert.rejects(() => applyPack(desktop, pack([
    put({ kind: 'mind', path: `user/relay/requests/DESKTOP/${requestId}.json` }, request),
    put({ kind: 'mind', path: 'user/relay/results/two.json' }, bound, { id: uuidV8(['change', 'bound']) }),
  ], [
    { hash: hashBytes(request), raw: request },
    { hash: hashBytes(bound), raw: bound },
  ], { sequence: 1 })), (error) => error.code === 'invalid_record_owner');
  const registration = Buffer.from(JSON.stringify({
    kind: 'registration', sessionId, unitId: 'project:shop:executor-shop', machine: 'LAPTOP',
  }));
  const status = Buffer.from(JSON.stringify({
    format: 'hivem1nd-session-status-v1', sessionId, state: 'stopped', machine: 'LAPTOP', at: AT,
  }));
  await applyPack(desktop, pack([
    put({ kind: 'mind', path: 'user/relay/registrations/one.json' }, registration),
    put({ kind: 'mind', path: `user/relay/session-status/${sessionId}/one.json` }, status, { id: uuidV8(['change', 'status']) }),
  ], [
    { hash: hashBytes(registration), raw: registration },
    { hash: hashBytes(status), raw: status },
  ], { sequence: 1 }));
  const saved = JSON.parse(await readFile(path.join(fixture.paths.mind, 'user', 'relay', 'session-status', sessionId, 'one.json'), 'utf8'));
  assert.equal(saved.sessionId, sessionId);
  const notice = [
    'id: not-a-notice',
    'kind: notice',
    'machine: DESKTOP',
    'from-id: project:shop:executor-shop',
    '',
    'escape',
  ].join('\n');
  const noticeBytes = Buffer.from(notice);
  await assert.rejects(() => applyPack(desktop, pack([
    put({ kind: 'mind', path: 'user/relay/chats/room/note.md' }, noticeBytes),
  ], [{ hash: hashBytes(noticeBytes), raw: noticeBytes }], { sequence: 2 }), {
    bindings: { actors: { 'project:shop:executor-shop': 'LAPTOP' } },
  }), (error) => error.code === 'invalid_record_owner');
  const receipt = Buffer.from(JSON.stringify({
    format: 'hivem1nd-chat-read-v1', chatId: uuidV8(['chat']), unitId: 'root:master', machine: 'DESKTOP', messageIds: [], at: AT,
  }));
  await assert.rejects(() => applyPack(desktop, pack([
    put({ kind: 'mind', path: `user/relay/chats/${uuidV8(['chat'])}/read/${Buffer.from('root:master').toString('base64url')}/DESKTOP/${uuidV8(['receipt'])}.json` }, receipt),
  ], [{ hash: hashBytes(receipt), raw: receipt }], { sequence: 2 })), (error) => error.code === 'invalid_record_owner');
});

test('links are not followed and an unregistered project stays pending', async (t) => {
  const { fixture, desktop } = await world(t);
  const outside = path.join(fixture.root, 'outside');
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(outside, 'secret.txt'), 'secret');
  await symlink(outside, path.join(fixture.paths.mind, 'user', 'linked'), 'junction');
  const raw = Buffer.from('nope');
  await assert.rejects(() => applyPack(desktop, pack([
    put({ kind: 'mind', path: 'user/linked/secret.txt' }, raw),
  ], [{ hash: hashBytes(raw), raw }])), (error) => error.code === 'unsafe_path');
  assert.equal(await readFile(path.join(outside, 'secret.txt'), 'utf8'), 'secret');
  const pending = await applyPack(desktop, pack([
    put({ kind: 'project', project: 'shop', path: 'docs/readme.md' }, raw, { at: LATER }),
  ], [{ hash: hashBytes(raw), raw }], { sequence: 1 }));
  assert.equal(pending.status, 'pending');
  assert.equal(pending.code, 'project_unavailable');
  await assert.rejects(() => readFile(path.join(fixture.root, 'shop', 'docs', 'readme.md')));
});

test('a revocation tombstone blocks an older grant and keeps a new grant id', async (t) => {
  const { fixture, desktop } = await world(t);
  const revoked = uuidV8(['grant', 'old']);
  const fresh = uuidV8(['grant', 'new']);
  const requestId = uuidV8(['revoke']);
  const revocation = Buffer.from(JSON.stringify({
    format: 'hivem1nd-grant-revocation-result-v1',
    requestId,
    unitId: 'project:shop:executor-shop',
    grantId: revoked,
    state: 'revoked',
    at: AT,
    machine: 'LAPTOP',
  }));
  await applyPack(desktop, pack([
    put({ kind: 'mind', path: 'user/relay/grant-revocation-results/one.json' }, revocation),
  ], [{ hash: hashBytes(revocation), raw: revocation }]), {
    bindings: { revocations: { [requestId]: { machine: 'LAPTOP' } } },
  });
  const state = Buffer.from(JSON.stringify({ grants: [{ id: revoked }, { id: fresh }] }));
  await applyPack(desktop, pack([
    put({ kind: 'mind', path: 'user/grants.json' }, state, { at: '2026-10-10T11:00:00.000Z' }),
  ], [{ hash: hashBytes(state), raw: state }], { sequence: 2 }));
  const saved = JSON.parse(await readFile(path.join(fixture.paths.mind, 'user', 'grants.json'), 'utf8'));
  assert.deepEqual(saved.grants.map((grant) => grant.id), [fresh]);
});

test('a state approval header drops tombstoned grants and keeps the rest of the record', async (t) => {
  const { fixture, desktop } = await world(t);
  const dropped = uuidV8(['grant', 'dropped']);
  const kept = uuidV8(['grant', 'kept']);
  const requestId = uuidV8(['revoke', 'state']);
  const revocation = Buffer.from(JSON.stringify({
    format: 'hivem1nd-grant-revocation-result-v1',
    requestId,
    unitId: 'project:shop:executor-shop',
    grantId: dropped,
    state: 'revoked',
    at: AT,
    machine: 'LAPTOP',
  }));
  const state = Buffer.from([
    'unit-id: project:shop:executor-shop',
    'role: executor',
    'approvals: [{"id":"earlier-header"}]',
    'custom: keep-me',
    `approvals: ${JSON.stringify([{ id: dropped, action: 'process.run' }, { id: kept, action: 'process.run', note: 'stay' }])}`,
    '',
    'Ready for the next task.\n',
  ].join('\n'));
  await applyPack(desktop, pack([
    put({ kind: 'mind', path: 'user/relay/grant-revocation-results/state.json' }, revocation),
    put({ kind: 'mind', path: 'user/state/executor-shop.md' }, state, { id: uuidV8(['change', 'state']) }),
  ], [
    { hash: hashBytes(revocation), raw: revocation },
    { hash: hashBytes(state), raw: state },
  ]), { bindings: { revocations: { [requestId]: { machine: 'LAPTOP' } } } });
  const saved = await readFile(path.join(fixture.paths.mind, 'user', 'state', 'executor-shop.md'), 'utf8');
  assert.match(saved, /custom: keep-me/);
  assert.match(saved, /Ready for the next task\./);
  assert.match(saved, /earlier-header/);
  assert.equal(saved.includes(dropped), false);
  assert.match(saved, new RegExp(kept));
  const versions = JSON.parse(await readFile(path.join(desktop.paths.localDirectory, 'sync-versions.json'), 'utf8'));
  const fileBytes = await readFile(path.join(fixture.paths.mind, 'user', 'state', 'executor-shop.md'));
  assert.ok(Object.values(versions.targets).some((item) => item.hash === hashBytes(fileBytes)));
});

test('a resumed group keeps an unexpected edit instead of replaying over it', async (t) => {
  const { fixture, desktop } = await world(t);
  const left = Buffer.from('left');
  const right = Buffer.from('right');
  const transactionId = uuidV8(['group', 'resume']);
  const first = put({ kind: 'mind', path: 'user/group-left.txt' }, left, { transactionId, id: uuidV8(['group-left']) });
  const second = put({ kind: 'mind', path: 'user/group-right.txt' }, right, { transactionId, at: LATER, id: uuidV8(['group-right']) });
  const grouped = pack([first, second], [{ hash: hashBytes(left), raw: left }, { hash: hashBytes(right), raw: right }], {
    transactions: [{ id: transactionId, changeIds: [first.id, second.id] }],
  });
  desktop.applyFault = { afterWrites: 1 };
  await assert.rejects(() => applyPack(desktop, grouped), { code: 'injected_crash' });
  const rightPath = path.join(fixture.paths.mind, 'user', 'group-right.txt');
  await writeFile(rightPath, 'unexpected');
  await applyPack(desktop, grouped);
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'group-left.txt'), 'utf8'), 'left');
  assert.equal(await readFile(rightPath, 'utf8'), 'unexpected');
});

test('an out-of-order pack stays pending and a foreign sequence is not published', async (t) => {
  const { fixture, desktop, laptopOrigin } = await world(t);
  const raw = Buffer.from('later');
  const skipped = pack([put({ kind: 'mind', path: 'user/skipped.txt' }, raw)], [{ hash: hashBytes(raw), raw }], { sequence: 2 });
  const pending = await applyPack(desktop, skipped);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.code, 'sequence_incomplete');
  await assert.rejects(() => readFile(path.join(fixture.paths.mind, 'user', 'skipped.txt')));
  const first = pack([put({ kind: 'mind', path: 'user/first.txt' }, raw)], [{ hash: hashBytes(raw), raw }]);
  await applyPack(desktop, first);
  const marker = path.join(desktop.paths.localDirectory, 'received', 'LAPTOP', '1.applied.json');
  const stored = JSON.parse(await readFile(marker, 'utf8'));
  stored.packHash = 'f'.repeat(64);
  await writeFile(marker, `${JSON.stringify(stored)}\n`);
  await assert.rejects(() => applyPack(desktop, first), { code: 'revision_conflict' });
  const foreign = pack([put({ kind: 'mind', path: 'user/foreign.txt' }, raw, { machine: 'BRAVO' })], [{ hash: hashBytes(raw), raw }], { machine: 'BRAVO' });
  await assert.rejects(() => publishPack(laptopOrigin, foreign), { code: 'invalid_record_owner' });
  await assert.rejects(() => readFile(path.join(fixture.root, 'origin', 'machines', 'LAPTOP', 'packs', '000000000001.pack')), { code: 'ENOENT' });
  const ahead = pack([put({ kind: 'mind', path: 'user/ahead.txt' }, raw, { id: uuidV8(['ahead']) })], [{ hash: hashBytes(raw), raw }], { sequence: 99 });
  await assert.rejects(() => publishPack(laptopOrigin, ahead), { code: 'revision_conflict' });
});

test('direct and group chats apply before their messages without a seeded owner', async (t) => {
  const { fixture, desktop, laptopOrigin } = await world(t);
  const directId = uuidV8(['direct-chat', 'root:builder']);
  const groupId = uuidV8(['group-chat', 'crew']);
  const direct = Buffer.from(`id: ${directId}\ntitle: Builder\nmembers: ["root:builder","root:master"]\npinned: false\nlisted: true\ncreated: ${AT}\ncreated-by: root:master\nkind: direct\n\n`);
  const group = Buffer.from(`id: ${groupId}\ntitle: Crew\nmembers: ["root:builder","root:lead","root:master"]\npinned: false\nlisted: true\ncreated: ${AT}\ncreated-by: root:master\nkind: group\n\n`);
  const first = pack([
    put({ kind: 'mind', path: `user/relay/chats/${directId}/chat.md` }, direct),
    put({ kind: 'mind', path: `user/relay/chats/${groupId}/chat.md` }, group, { id: uuidV8(['change', 'group']) }),
  ], [
    { hash: hashBytes(direct), raw: direct },
    { hash: hashBytes(group), raw: group },
  ]);
  await publishPack(laptopOrigin, first);
  const applied = await applyPack(desktop, first, { ledger: null });
  assert.equal(applied.status, 'applied');
  assert.match(await readFile(path.join(fixture.paths.mind, 'user', 'relay', 'chats', directId, 'chat.md'), 'utf8'), /kind: direct/);
  assert.match(await readFile(path.join(fixture.paths.mind, 'user', 'relay', 'chats', groupId, 'chat.md'), 'utf8'), /kind: group/);
  const messageId = uuidV8(['message', directId]);
  const message = Buffer.from([
    `id: ${messageId}`,
    'from: builder',
    'from-id: root:builder',
    `to: chat:${directId}`,
    `to-id: chat:${directId}`,
    'machine: LAPTOP',
    `timestamp: ${LATER}`,
    'priority: normal',
    'subject: Hello',
    `thread-id: ${directId}`,
    'reply-to:',
    'reply-requested: false',
    'attachments: []',
    'kind: message',
    '',
    'Hello',
  ].join('\n'));
  const registration = Buffer.from(JSON.stringify({
    kind: 'registration', sessionId: uuidV8(['session', 'builder']), unitId: 'root:builder', machine: 'LAPTOP',
  }));
  const note = Buffer.from('later note');
  const second = pack([
    put({ kind: 'mind', path: 'user/relay/registrations/builder.json' }, registration, { at: LATER, id: uuidV8(['change', 'registration']) }),
    put({ kind: 'mind', path: `user/relay/chats/${directId}/${messageId}.md` }, message, { at: LATER, id: uuidV8(['change', 'message']) }),
    put({ kind: 'mind', path: 'user/later-note.txt' }, note, { at: LATER, id: uuidV8(['change', 'note']) }),
  ], [
    { hash: hashBytes(registration), raw: registration },
    { hash: hashBytes(message), raw: message },
    { hash: hashBytes(note), raw: note },
  ], { sequence: 2 });
  await publishPack(laptopOrigin, second);
  const followed = await applyPack(desktop, second);
  assert.equal(followed.status, 'applied');
  assert.match(await readFile(path.join(fixture.paths.mind, 'user', 'relay', 'chats', directId, `${messageId}.md`), 'utf8'), /Hello/);
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'later-note.txt'), 'utf8'), 'later note');
});

test('an origin watcher reports a real head change and does not poll while idle', async (t) => {
  const { laptopOrigin } = await world(t);
  const events = [];
  const close = watchOrigin(laptopOrigin, (event) => events.push(event.type), { debounceMs: 20 });
  t.after(() => closeOrigin(laptopOrigin));
  const raw = Buffer.from('watched');
  const body = pack([put({ kind: 'mind', path: 'user/watched.txt' }, raw)], [{ hash: hashBytes(raw), raw }]);
  await publishPack(laptopOrigin, body);
  const started = Date.now();
  while (!events.includes('origin') && Date.now() - started < 3000) {
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.ok(events.includes('reconcile'));
  assert.ok(events.includes('origin'));
  await new Promise((resolve) => setTimeout(resolve, 200));
  const count = events.length;
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(events.length, count);
  await close();
});

test('an applied pack restarts without republishing, including a marker that omitted its machine', async (t) => {
  const { fixture, desktop } = await world(t);
  const raw = Buffer.from('laptop note');
  const target = { kind: 'mind', path: 'user/note.txt' };
  const applied = await applyPack(desktop, pack([put(target, raw)], [{ hash: hashBytes(raw), raw }]), { ledger: null });
  assert.equal(applied.status, 'applied');
  const key = targetKey(target);
  const markerFile = path.join(fixture.paths.localDirectory, 'staging', 'applied', `${key}.json`);
  const marker = JSON.parse(await readFile(markerFile, 'utf8'));
  assert.equal(marker.machine, 'LAPTOP');
  delete marker.machine;
  await writeFile(markerFile, `${JSON.stringify(marker)}\n`);
  const port = await freePort();
  const options = {
    store: fixture.store,
    paths: fixture.paths,
    now: () => fixture.clock.now,
    userKey: 'apply-restart',
    guardPort: port,
    listener: async () => ({ close: async () => {} }),
  };
  let running = null;
  try {
    running = await startService(options);
    await stopService(running);
    running = await startService(options);
    await stopService(running);
    running = null;
  } finally {
    if (running) await stopService(running);
  }
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'note.txt'), 'utf8'), 'laptop note');
  const staged = await listStaged(desktop);
  assert.equal(staged.some((change) => change.target?.path === 'user/note.txt'), false);
  const versions = JSON.parse(await readFile(path.join(fixture.paths.localDirectory, 'sync-versions.json'), 'utf8'));
  assert.equal(versions.targets[key].machine, 'LAPTOP');
});

test('an applied marker that cannot name its publisher is quarantined without republishing', async (t) => {
  const { fixture, desktop } = await world(t);
  const target = { kind: 'mind', path: 'user/orphan.txt' };
  await writeFile(path.join(fixture.paths.mind, 'user', 'orphan.txt'), 'kept');
  const key = targetKey(target);
  await mkdir(path.join(fixture.paths.localDirectory, 'staging', 'applied'), { recursive: true });
  await writeFile(path.join(fixture.paths.localDirectory, 'staging', 'applied', `${key}.json`), JSON.stringify({
    hash: hashBytes(Buffer.from('kept')),
    deleted: false,
    at: AT,
    id: 'not-derived-from-a-publisher',
  }));
  const staged = await stageBaselines(desktop);
  assert.equal(staged.some((change) => change.target?.path === 'user/orphan.txt'), false);
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'orphan.txt'), 'utf8'), 'kept');
  const again = await stageBaselines(desktop);
  assert.equal(again.some((change) => change.target?.path === 'user/orphan.txt'), false);
});

test('personal group creation, edits, archive and Undo sync as identical group-chat transactions on two machines', async (t) => {
  const { fixture, desktop, laptop, laptopOrigin } = await world(t);
  laptop.store.aclRunner = fixture.store.aclRunner;
  const source = { store: laptop.store, paths: laptop.paths, sync: laptop, now: () => fixture.clock.now, projects: [], principal: { audience: 'desktop', unitId: 'root:master' } };
  const destination = { ...source, store: desktop.store, paths: desktop.paths, sync: desktop };
  const state = Buffer.from('unit: one\nunit-id: root:one\nrole: executor\nstate: out\nmachine: LAPTOP\nlead-id: root:overseer\n\nOriginal context.\n');
  await mkdir(path.join(laptop.paths.mind, 'user', 'state'), { recursive: true });
  await mkdir(path.join(desktop.paths.mind, 'user', 'state'), { recursive: true });
  await writeFile(path.join(laptop.paths.mind, 'user', 'state', 'one.md'), state);
  await writeFile(path.join(desktop.paths.mind, 'user', 'state', 'one.md'), state);
  let sequence = 0;
  async function transfer(groupId, crash = false) {
    const changes = await listStaged(laptop);
    const pair = changes.filter((change) => change.target.path === `user/gui/groups/${groupId}.json` || change.target.path === `user/relay/chats/${groupId}/chat.md`);
    assert.equal(pair.length, 2);
    assert.equal(pair[0].transactionId, pair[1].transactionId);
    assert.ok(pair[0].transactionId);
    assert.equal(changes.some((change) => change.target.path.includes('change-undo')), false);
    const objects = await Promise.all([...new Set(changes.map((change) => change.hash))].map(async (hash) => ({ hash, raw: await readObject(laptop, hash) })));
    const body = encodePack({ machine: 'LAPTOP', sequence: ++sequence, changes, objects,
      transactions: [{ id: pair[0].transactionId, changeIds: pair.map((change) => change.id) }] });
    await publishPack(laptopOrigin, body);
    if (crash) {
      desktop.applyFault = { afterWrites: 1 };
      await assert.rejects(applyPack(desktop, body), { code: 'injected_crash' });
      await recoverIncomingGroups(desktop);
    }
    const applied = await applyPack(desktop, body);
    assert.ok(['applied', 'duplicate'].includes(applied.status), applied.status);
    for (const change of pair) {
      const relative = change.target.path.split('/');
      assert.deepEqual(await readFile(path.join(desktop.paths.mind, ...relative)), await readFile(path.join(laptop.paths.mind, ...relative)));
      const sidecar = await importedSidecarEvents(destination, change);
      assert.equal(sidecar.events[0].name, change.target.path.startsWith('user/gui/') ? 'group.changed' : 'chat.changed');
    }
    await ackPublished(laptop, changes.map((change) => change.id));
    assert.deepEqual(await readFile(path.join(desktop.paths.mind, 'user', 'state', 'one.md')), state);
    assert.deepEqual(await readFile(path.join(laptop.paths.mind, 'user', 'state', 'one.md')), state);
  }
  const created = await createGroup(source, { title: 'Shared', members: ['root:one'] });
  assert.ok((await eligibleTargets(laptop)).some((target) => target.path === `user/gui/groups/${created.id}.json`));
  await transfer(created.id, true);
  assert.deepEqual((await readProjection(destination)).groups, (await readProjection(source)).groups);
  fixture.clock.now += 1;
  const patched = await patchGroup(source, created.id, { title: 'Shared renamed', expectedRevision: created.revision });
  await transfer(created.id);
  fixture.clock.now += 1;
  const removed = await removeGroup(source, created.id, { confirmed: true, expectedRevision: patched.revision });
  await transfer(created.id);
  assert.equal((await readProjection(destination)).counts.groups, 0);
  assert.deepEqual((await readCollection(destination, 'chats', { archived: true })).items, (await readCollection(source, 'chats', { archived: true })).items);
  fixture.clock.now += 1;
  await undoChange(source, removed.changeId);
  await transfer(created.id);
  assert.deepEqual((await readProjection(destination)).groups, (await readProjection(source)).groups);
  assert.equal((await readCollection(destination, 'chats', { archived: true })).total, 0);
});

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('complete History conflict answers and Restore sync and recover with exact immutable objects and imported events', async (t) => {
  const { fixture, desktop, laptop } = await world(t);
  for (const sync of [desktop, laptop]) {
    const localPath = path.join(fixture.root, `${sync.machine}-history`);
    await mkdir(localPath, { recursive: true }); sync.projects = [{ name: 'shop', localPath }];
  }
  const source = { store: laptop.store, paths: laptop.paths, sync: laptop, projects: laptop.projects, now: () => fixture.clock.now, principal: { audience: 'desktop', unitId: 'root:master' } };
  const destination = { ...source, store: desktop.store, paths: desktop.paths, sync: desktop, projects: desktop.projects };
  let sequence = 0;
  async function transfer(crash = false) {
    const changes = await listStaged(laptop), groups = new Map();
    for (const change of changes) { const ids = groups.get(change.transactionId) ?? []; ids.push(change.id); groups.set(change.transactionId, ids); }
    const objects = await Promise.all([...new Set(changes.map((change) => change.hash).filter(Boolean))].map(async (hash) => ({ hash, raw: await readObject(laptop, hash) })));
    const bytes = encodePack({ machine: 'LAPTOP', sequence: ++sequence, changes, objects, transactions: [...groups].map(([id, changeIds]) => ({ id, changeIds })) });
    if (crash) {
      desktop.applyFault = { afterWrites: 2 };
      await assert.rejects(() => applyPack(desktop, bytes), { code: 'injected_crash' });
      await recoverIncomingGroups(desktop);
    }
    const applied = await applyPack(desktop, bytes); assert.equal(applied.status, 'applied');
    for (const change of changes.filter((item) => /^docs\/flows\/history\/.+\/[0-9a-f-]{36}\.json$/.test(item.target.path))) {
      const imported = await importedSidecarEvents(destination, change);
      assert.equal(imported.events[0].name, 'editor.history.changed');
      assert.equal(imported.events[0].data.historyId, JSON.parse(await readObject(laptop, change.hash)).id);
    }
    await ackPublished(laptop, changes.map((change) => change.id));
  }
  let editor = await createText(source, { project: 'shop', path: 'docs/history.json', document: { title: 'Initial', rev: 2, extra: { kept: true }, pages: [{ k: 'A', en: 'Before' }] } });
  await transfer(true); fixture.clock.now += 1;
  const original = (await listHistory(source, editor.id)).items[0];
  editor = await replaceText(source, editor.id, { document: { ...editor.document, pages: [{ k: 'A', en: 'Incoming' }] }, expectedRevision: editor.revision });
  await transfer(); fixture.clock.now += 1;
  const draft = { ...editor.document, pages: [{ k: 'A', en: 'Person draft' }] };
  editor = await resolveConflict(source, editor.id, { document: draft, decision: 'reload', expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision });
  await transfer(true); fixture.clock.now += 1;
  const history = (await listHistory(source, editor.id)).items;
  assert.deepEqual((await listHistory(destination, editor.id)).items, history);
  for (const item of history) for (const suffix of ['.json', '.document.json', '.comments.json']) {
    const relative = `docs/flows/history/${editor.id}/${item.id}${suffix}`;
    assert.deepEqual(await readFile(path.join(desktop.projects[0].localPath, relative)), await readFile(path.join(laptop.projects[0].localPath, relative)));
  }
  editor = await restoreHistory(source, editor.id, original.id, { expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision });
  await transfer(true); fixture.clock.now += 1;
  assert.equal((await readEditor(destination, editor.id)).document.pages[0].en, 'Before');
  const draftVersion = history.find((item) => item.source?.kind === 'draft');
  editor = await restoreHistory(source, editor.id, draftVersion.id, { expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision });
  await transfer();
  assert.equal((await readEditor(destination, editor.id)).document.pages[0].en, 'Person draft');
  assert.deepEqual((await listHistory(destination, editor.id)).items, (await listHistory(source, editor.id)).items);
});

test('history sync refuses nested paths and overwritten snapshot bytes while retaining versions from a losing edit', async (t) => {
  const { fixture, desktop, laptop } = await world(t);
  for (const sync of [desktop, laptop]) {
    const localPath = path.join(fixture.root, `${sync.machine}-history-conflict`);
    await mkdir(localPath, { recursive: true }); sync.projects = [{ name: 'shop', localPath }];
  }
  const context = { store: laptop.store, paths: laptop.paths, sync: laptop, projects: laptop.projects, now: () => fixture.clock.now };
  let editor = await createText(context, { project: 'shop', path: 'docs/shared.json', document: { title: 'Shared', pages: [{ k: 'A', en: 'Initial' }] } });
  async function stagedPack(sequence) {
    const changes = await listStaged(laptop), groups = new Map();
    for (const change of changes) { const ids = groups.get(change.transactionId) ?? []; ids.push(change.id); groups.set(change.transactionId, ids); }
    const objects = await Promise.all([...new Set(changes.map((change) => change.hash).filter(Boolean))].map(async (hash) => ({ hash, raw: await readObject(laptop, hash) })));
    return { changes, bytes: encodePack({ machine: 'LAPTOP', sequence, changes, objects, transactions: [...groups].map(([id, changeIds]) => ({ id, changeIds })) }) };
  }
  const initial = await stagedPack(1); await applyPack(desktop, initial.bytes); await ackPublished(laptop, initial.changes.map((item) => item.id));
  fixture.clock.now += 1;
  const old = (await listHistory(context, editor.id)).items[0];
  const target = { kind: 'project', project: 'shop', path: `docs/flows/history/${editor.id}/${old.id}.document.json` }, changed = Buffer.from('{}');
  await assert.rejects(() => applyPack(desktop, pack([put(target, changed)], [{ hash: hashBytes(changed), raw: changed }], { sequence: 2 })), { code: 'corrupt_resource' });
  await assert.rejects(() => applyPack(desktop, pack([put({ ...target, path: `docs/flows/history/${editor.id}/nested/${old.id}.document.json` }, changed)], [{ hash: hashBytes(changed), raw: changed }], { sequence: 2 })), { code: 'invalid_pack' });
  editor = await replaceText(context, editor.id, { document: { ...editor.document, pages: [{ k: 'A', en: 'Older incoming edit' }] }, expectedRevision: editor.revision });
  const remote = await stagedPack(2);
  const localContext = { ...context, store: desktop.store, paths: desktop.paths, sync: desktop, projects: desktop.projects };
  fixture.clock.now += 1;
  const local = await readEditor(localContext, editor.id);
  await replaceText(localContext, editor.id, { document: { ...local.document, pages: [{ k: 'A', en: 'Newer local edit' }] }, expectedRevision: local.revision });
  await applyPack(desktop, remote.bytes);
  assert.equal((await readEditor(localContext, editor.id)).document.pages[0].en, 'Newer local edit');
  assert.ok((await listHistory(localContext, editor.id)).items.some((item) => item.revision === editor.revision));
});
