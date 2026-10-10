import assert from 'node:assert/strict';
import { mkdir, readFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  canonicalJson,
  hashBytes,
  parseTaskId,
  parseUnitId,
  recordHeaders,
  replaceHeader,
  resolvePerson,
  resolveUnit,
  uuidV8,
  validateName,
  validateRole,
} from '../engine/service/identity.mjs';
import {
  assertLocalStaging,
  assertNoLinks,
  defaultMind,
  localCosmic,
  mindKeyFor,
  resolveTarget,
  servicePaths,
} from '../engine/service/paths.mjs';
import {
  atomicWrite,
  checkRevision,
  commitTransaction,
  exclusiveRecord,
  readRecord,
  revisionOf,
  withReceipt,
} from '../engine/service/store.mjs';
import { advanceClock, assertContained, dispose, makeCoreFixture, readEvents } from './core-fixture.mjs';

const KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUEST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('canonical JSON, ids, and person aliases keep scope and spelling', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: true, c: [1, { z: 1, y: 2 }] } }), '{"a":{"c":[1,{"y":2,"z":1}],"d":true},"b":1}');
  assert.throws(() => canonicalJson({ value: Infinity }), { code: 'invalid_json' });
  assert.throws(() => canonicalJson({ value: Number.NaN }), { code: 'invalid_json' });
  let nested = 0;
  for (let depth = 0; depth < 41; depth += 1) nested = { nested };
  assert.throws(() => canonicalJson(nested), { code: 'invalid_json' });
  assert.throws(() => canonicalJson(Array.from({ length: 10001 }, (_, index) => index)), { code: 'invalid_json' });

  const left = uuidV8(['editor', 'blueprint', 'shop', 'docs/flows/boards/cart.json']);
  assert.equal(left, uuidV8(['editor', 'blueprint', 'shop', 'docs/flows/boards/cart.json']));
  assert.notEqual(left, uuidV8(['editor', 'void', 'shop', 'docs/flows/boards/cart.json']));
  assert.match(left, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.throws(() => validateRole('codex'), { code: 'invalid_role' });
  assert.equal(validateRole('executor'), 'executor');
  assert.throws(() => validateName('con.txt'), { code: 'invalid_name' });
  assert.throws(() => validateName('NUL.md'), { code: 'invalid_name' });
  assert.equal(validateName('user-helper'), 'user-helper');

  const shop = parseUnitId('project:shop:Executor');
  const web = parseUnitId('env:web:Executor');
  assert.equal(shop.id, 'project:shop:Executor');
  assert.notEqual(shop.id, web.id);
  assert.equal(parseTaskId('project:shop:029').number, '029');
  assert.equal(resolvePerson('user@DESKTOP').unitId, 'root:master');
  assert.equal(resolvePerson('person:Alias.One').client, 'master');
  assert.equal(resolvePerson('user-helper'), null);

  const units = [
    { unit: 'Executor', scopeId: 'project:shop' },
    { unit: 'Executor', scopeId: 'env:web' },
    { unit: 'user-helper', scopeId: 'user' },
  ];
  assert.throws(() => resolveUnit('Executor', { units }), { code: 'ambiguous_unit' });
  assert.equal(resolveUnit('executor', { units, scope: { kind: 'project', name: 'shop', environment: 'web' } }).unitId, 'project:shop:Executor');
  assert.equal(resolveUnit('executor', { units, scope: { kind: 'project', name: 'other', environment: 'web' } }).unitId, 'env:web:Executor');
  assert.equal(resolveUnit('user', { units }).unitId, 'root:master');
  assert.equal(resolveUnit('USER', { units }).role, 'master');
  assert.equal(resolveUnit('user-helper', { units }).unitId, 'root:user-helper');
  assert.equal(resolveUnit('user-helper', { units }).legacyScopeId, 'user');
  assert.equal(resolveUnit('Alias.One', { units, aliases: ['Alias.One'] }).unitId, 'root:master');
  assert.equal(resolveUnit('project:shop:Executor', { units }).unit, 'Executor');
});

test('header replacement keeps the final duplicate and the original body bytes', () => {
  const raw = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('lead: old\r\nlead: keep-me\r\nnote: stay\r\n\r\nBody stays\r\n'),
  ]);
  const next = replaceHeader(raw, 'lead', 'new');
  assert.equal(next.subarray(0, 3).toString('hex'), 'efbbbf');
  assert.equal(next.subarray(3).toString('utf8'), 'lead: old\r\nlead: new\r\nnote: stay\r\n\r\nBody stays\r\n');
  assert.equal(recordHeaders(next).headers.get('lead'), 'new');
  assert.ok(next.subarray(next.indexOf('Body stays')).equals(raw.subarray(raw.indexOf('Body stays'))));
  assert.notEqual(hashBytes(Buffer.from('a\n')), hashBytes(Buffer.from('a\r\n')));
});

test('local Cosmic paths reject synced staging and Windows device junctions', async (t) => {
  assert.equal(
    localCosmic({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\example\\AppData\\Local' }, home: 'C:\\Users\\example' }),
    path.win32.resolve('C:\\Users\\example\\AppData\\Local\\Cosmic'),
  );
  assert.equal(
    defaultMind({ platform: 'linux', env: { XDG_DATA_HOME: 'relative' }, home: '/home/example' }),
    path.posix.join('/home/example', '.local', 'share', 'Cosmic', 'hivem1nd'),
  );
  assert.equal(
    defaultMind({ platform: 'linux', env: { XDG_DATA_HOME: '/var/data' }, home: '/home/example' }),
    '/var/data/Cosmic/hivem1nd',
  );
  assert.equal(
    localCosmic({ platform: 'darwin', env: {}, home: '/Users/example' }),
    path.posix.join('/Users/example', 'Library', 'Application Support', 'Cosmic'),
  );
  assert.equal(mindKeyFor('C:\\Cosmic\\Hivem1nd', 'win32'), mindKeyFor('c:\\cosmic\\hivem1nd', 'win32'));
  assert.notEqual(mindKeyFor('/Cosmic/Hivem1nd', 'linux'), mindKeyFor('/Cosmic/hivem1nd', 'linux'));
  assert.throws(() => servicePaths({
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:\\Users\\example\\AppData\\Local' },
    home: 'C:\\Users\\example',
    machine: 'DESKTOP',
    mindPath: 'C:\\Users\\example\\hivem1nd',
  }), { code: 'invalid_mind' });

  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const origin = path.join(fixture.root, 'origin');
  const oneDrive = path.join(fixture.root, 'onedrive');
  await mkdir(origin, { recursive: true });
  await mkdir(path.join(oneDrive, 'nested'), { recursive: true });
  await assertLocalStaging(fixture.paths.staging, { origin, oneDrive: [oneDrive] });
  await assert.rejects(assertLocalStaging(origin, { origin }), { code: 'unsafe_staging' });
  await assert.rejects(assertLocalStaging(path.join(oneDrive, 'nested'), { oneDrive: [oneDrive] }), { code: 'unsafe_staging' });
  const stageLink = path.join(fixture.root, 'stage-link');
  await symlink(path.join(oneDrive, 'nested'), stageLink, 'junction');
  await assert.rejects(assertLocalStaging(stageLink, { oneDrive: [oneDrive] }), { code: 'unsafe_staging' });

  const realDirectory = path.join(fixture.root, 'real');
  const linked = path.join(fixture.paths.mind, 'user', 'linked');
  await mkdir(realDirectory, { recursive: true });
  await symlink(realDirectory, linked, 'junction');
  await assert.rejects(assertNoLinks(path.join(linked, 'note.txt')), { code: 'unsafe_path' });
  await assert.rejects(atomicWrite(fixture.store, path.join(linked, 'note.txt'), Buffer.from('x')), { code: 'unsafe_path' });
  await assert.rejects(resolveTarget(fixture.paths, { kind: 'project', project: 'shop', path: 'C:/repo/file.txt' }, {
    projects: [{ name: 'shop', localPath: fixture.root, eligible: true }],
  }), { code: 'invalid_path' });
  await assert.rejects(resolveTarget(fixture.paths, { kind: 'project', project: 'missing', path: 'docs/a.txt' }, { projects: [] }), { code: 'project_unavailable' });
  assertContained(fixture);
});

test('absent and stale revisions write nothing, and a retry keeps one record', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const missing = path.join(fixture.paths.mind, 'user', 'missing.txt');
  const absent = await readRecord(fixture.store, missing);
  assert.equal(absent.revision, null);
  assert.equal(revisionOf(null), null);
  assert.throws(() => checkRevision(null, 'abc'), (error) => error.code === 'revision_conflict' && error.details.currentRevision === null);

  const target = path.join(fixture.paths.mind, 'user', 'note.txt');
  const first = Buffer.from('one');
  await atomicWrite(fixture.store, target, first);
  const current = await readRecord(fixture.store, target);
  assert.equal(current.revision, hashBytes(first));
  await atomicWrite(fixture.store, target, Buffer.from('two'));
  await assert.rejects(commitTransaction(fixture.store, {
    id: REQUEST,
    entries: [{ resource: 'mind:user/note.txt', recordPath: target, beforeRevision: current.revision, afterBytes: Buffer.from('three'), record: { value: 3 } }],
    response: { status: 200, body: { ok: false } },
    events: [{ name: 'record.written', id: REQUEST }],
  }), { code: 'revision_conflict' });
  assert.equal((await readFile(target)).toString(), 'two');
  assert.equal(readEvents(fixture).length, 0);

  const created = path.join(fixture.paths.mind, 'user', 'created.txt');
  let runs = 0;
  const input = { principal: 'os:desktop', key: KEY, method: 'POST', path: '/notes', body: { value: 1 }, requestId: REQUEST, eventCursor: 'cursor-1' };
  const operation = async (receipt) => {
    runs += 1;
    return commitTransaction(fixture.store, {
      id: receipt.requestId,
      entries: [{ resource: 'mind:user/created.txt', recordPath: created, beforeRevision: null, afterBytes: Buffer.from('one'), record: { value: 1 } }],
      response: { status: 201, body: { id: receipt.requestId, value: 1 } },
      receipt,
      events: [{ name: 'record.written', id: receipt.requestId }],
    });
  };
  const [firstResult, secondResult] = await Promise.all([withReceipt(fixture.store, input, operation), withReceipt(fixture.store, input, operation)]);
  assert.equal(runs, 1);
  assert.equal(firstResult.body.id, REQUEST);
  assert.deepEqual(firstResult.body, secondResult.body);
  assert.equal(readEvents(fixture).length, 1);
  assert.equal((await readRecord(fixture.store, created)).bytes.toString(), 'one');
  await assert.rejects(withReceipt(fixture.store, { ...input, body: { value: 2 } }, operation), { code: 'idempotency_conflict' });
  assert.equal(runs, 1);
  assert.equal((await readFile(created)).toString(), 'one');
  advanceClock(fixture, 24 * 60 * 60 * 1000);
  assertContained(fixture);
});

test('a crash after the first file or before the receipt recovers once', async (t) => {
  const fixture = await makeCoreFixture({ autoRecover: false });
  t.after(() => dispose(fixture));
  const first = path.join(fixture.paths.mind, 'user', 'first.txt');
  const second = path.join(fixture.paths.mind, 'user', 'second.txt');
  const hiddenRequest = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  fixture.store.fault = { afterRenames: 1 };
  await assert.rejects(commitTransaction(fixture.store, {
    id: hiddenRequest,
    entries: [
      { resource: 'mind:user/first.txt', recordPath: first, beforeRevision: null, afterBytes: Buffer.from('A'), record: { part: 1 } },
      { resource: 'mind:user/second.txt', recordPath: second, beforeRevision: null, afterBytes: Buffer.from('B'), record: { part: 2 } },
    ],
    response: { status: 200, body: { id: hiddenRequest } },
    events: [{ name: 'record.written', id: hiddenRequest }],
  }), { code: 'injected_crash' });
  assert.equal((await readFile(first)).toString(), 'A');
  await assert.rejects(readFile(second), { code: 'ENOENT' });
  assert.equal((await readRecord(fixture.store, first)).bytes, null);
  assert.equal(readEvents(fixture).length, 0);
  fixture.store.autoRecover = true;
  const recovered = await readRecord(fixture.store, second);
  assert.equal(recovered.bytes.toString(), 'B');
  assert.equal((await readRecord(fixture.store, first)).bytes.toString(), 'A');
  assert.equal(readEvents(fixture).length, 1);
  await readRecord(fixture.store, first);
  assert.equal(readEvents(fixture).length, 1);

  const receiptTarget = path.join(fixture.paths.mind, 'user', 'receipted.txt');
  const retryRequest = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const retryKey = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  fixture.store.fault = { beforeReceipt: true };
  let runs = 0;
  const input = { principal: 'os:desktop', key: retryKey, method: 'POST', path: '/receipted', body: { value: 1 }, requestId: retryRequest, eventCursor: 'cursor-2' };
  await assert.rejects(withReceipt(fixture.store, input, async (receipt) => {
    runs += 1;
    return commitTransaction(fixture.store, {
      id: receipt.requestId,
      entries: [{ resource: 'mind:user/receipted.txt', recordPath: receiptTarget, beforeRevision: null, afterBytes: Buffer.from('saved'), record: { value: 1 } }],
      response: { status: 201, body: { id: receipt.requestId } },
      receipt,
      events: [{ name: 'record.written', id: receipt.requestId }],
    });
  }), { code: 'injected_crash' });
  assert.equal(runs, 1);
  assert.equal(readEvents(fixture).length, 1);
  const replay = await withReceipt(fixture.store, input, async () => {
    runs += 1;
    throw new Error('retry must not run the operation');
  });
  assert.equal(runs, 1);
  assert.equal(replay.id, retryRequest);
  assert.equal(replay.replayed, true);
  assert.equal(readEvents(fixture).length, 2);
  await exclusiveRecord(fixture.store, path.join(fixture.paths.mind, 'user', 'exclusive.txt'), Buffer.from('only'));
  await assert.rejects(exclusiveRecord(fixture.store, path.join(fixture.paths.mind, 'user', 'exclusive.txt'), Buffer.from('again')));
  assert.equal((await readFile(path.join(fixture.paths.mind, 'user', 'exclusive.txt'))).toString(), 'only');
  assertContained(fixture);
});
