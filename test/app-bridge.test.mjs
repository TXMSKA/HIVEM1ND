import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fsPromises, { mkdir, readFile, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { crc32, deflateSync } from 'node:zlib';
import test from 'node:test';
import { APP_UPLOAD_LIMITS, appAgentsChanged, appCapabilities, callAppBridge, observeAppFiles, stopAppObservation, updateAppActivity } from '../engine/service/app-bridge.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { createHttpServer } from '../engine/service/http.mjs';
import { createCredentialStore } from '../engine/service/security.mjs';
import { composeCore } from '../engine/service/service.mjs';
import { watchLocalChanges } from '../engine/service/local-watch.mjs';
import { makeCoreFixture, dispose } from './core-fixture.mjs';

const CLIENT = '062-bridge-tests';
const b64 = text => Buffer.from(text).toString('base64');
const boardText = board => `${JSON.stringify(board, null, 2)}\n`;
const FONT_SIGNATURES = { woff2: 'wOF2', woff: 'wOFF', ttf: '\u0000\u0001\u0000\u0000', otf: 'OTTO' };
const fontBytes = extension => Buffer.concat([Buffer.from(FONT_SIGNATURES[extension], 'latin1'), Buffer.alloc(64, 7)]);
async function observePass(context, options = {}) {
  let result;
  do { result = await observeAppFiles(context, options); } while (result.pending);
  return result;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]), chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body) >>> 0, data.length + 8);
  return chunk;
}

const pngHeader = Buffer.alloc(13);
pngHeader.writeUInt32BE(1, 0);
pngHeader.writeUInt32BE(1, 4);
pngHeader[8] = 8;
pngHeader[9] = 6;
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', pngHeader), pngChunk('IDAT', deflateSync(Buffer.from([0, 20, 40, 60, 255]))), pngChunk('IEND', Buffer.alloc(0))]);

async function setup(t) {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const project = path.join(fixture.root, 'shop');
  const excluded = path.join(fixture.root, 'excluded');
  await mkdir(path.join(project, 'docs/flows/boards'), { recursive: true });
  await mkdir(excluded);
  const events = [];
  const context = { store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now,
    projects: [{ name: 'shop', localPath: project }, { name: 'excluded', localPath: excluded, eligible: false }],
    principal: { audience: 'desktop', unitId: 'root:master' }, bus: { emit: event => events.push(event) } };
  const call = (app, method, params = {}, extra = {}) => callAppBridge(context, { app, method, params, clientId: CLIENT, ...extra });
  const blueprint = (method, params = {}) => call('blueprint', `blueprint.${method}`, { location: project, ...params });
  const voidCall = (method, params = {}) => call('void', `void.${method}`, { location: project, ...params });
  return { fixture, context, project, excluded, events, call, blueprint, voidCall };
}

test('bridge method capabilities are exact per app, hello checks app and protocol, person uses host aliases', async t => {
  const { context, call, blueprint, project } = await setup(t);
  assert.ok(appCapabilities('blueprint').includes('blueprint.upload'));
  assert.ok(!appCapabilities('blueprint').includes('void.files.write'));
  for (const method of ['__proto__', 'capabilities', 'void.files.write', 'blueprint.remove']) await assert.rejects(call('blueprint', method), { code: 'invalid' });
  await assert.rejects(call('void', 'hello', { app: 'blueprint', appVersion: '1', protocol: 1 }), { code: 'invalid' });
  await assert.rejects(call('void', 'hello', { app: 'void', appVersion: '1', protocol: 2 }), { code: 'invalid' });
  const withoutPerson = await call('void', 'hello', { app: 'void', appVersion: '1', protocol: 1 });
  assert.equal(Object.hasOwn(withoutPerson, 'person'), false);
  await mkdir(path.join(context.paths.mind, 'user/machines'), { recursive: true });
  await writeFile(path.join(context.paths.mind, 'user/machines', `${context.paths.machine}.md`), 'person: Display Name, alias\n\nMachine.\n');
  assert.deepEqual((await call('void', 'hello', { app: 'void', appVersion: '1', protocol: 1 })).person, { name: 'Display Name' });
  context.aliases = ['Tom'];
  const hello = await call('void', 'hello', { app: 'void', appVersion: '1', protocol: 1 });
  assert.deepEqual(hello.person, { name: 'Tom' });
  assert.equal(hello.project.path, project);
  context.principal.audience = 'phone';
  await assert.rejects(blueprint('locations'), { code: 'denied' });
});

test('Blueprint answers in the shape the live app reads: locations, boards, board and revision', async t => {
  const { blueprint, project } = await setup(t);
  const { locations } = await blueprint('locations');
  assert.deepEqual(locations.map(item => [item.id, item.name, item.path]), [['shop', 'shop', path.join(project, 'docs/flows')]]);
  assert.deepEqual((await blueprint('list')).boards, []);
  const board = { formatVersion: 4, id: 'checkout', title: 'Board', threads: [], future: { kept: true } };
  const saved = await blueprint('save', { board, revision: null });
  assert.equal(saved.revision, hashBytes(Buffer.from(boardText(board))));
  assert.equal(saved.id, 'checkout');
  const read = await blueprint('read', { id: 'checkout' });
  assert.deepEqual(read.board, board);
  assert.equal(read.revision, saved.revision);
  assert.equal(Object.hasOwn(read, 'text') || Object.hasOwn(read, 'document'), false);
  const listed = (await blueprint('list')).boards;
  assert.deepEqual(listed.map(item => [item.id, item.title, typeof item.updatedAt]), [['checkout', 'Board', 'number']]);
  assert.equal(listed[0].revision, saved.revision);
  await assert.rejects(blueprint('save', { board, revision: null }), { code: 'conflict' });
  await assert.rejects(blueprint('save', { board, revision: '0'.repeat(64) }), { code: 'conflict' });
  for (const revision of [undefined, 7, 'abc']) await assert.rejects(blueprint('save', { board, revision }), { code: 'invalid' });
  for (const invalid of [undefined, [], 'text', { id: 'index' }, {}]) await assert.rejects(blueprint('save', { board: invalid, revision: null }), { code: 'invalid' });
  const outcomes = await Promise.allSettled(['One', 'Two'].map(title => blueprint('save', { board: { ...board, title }, revision: read.revision })));
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(item => item.status === 'rejected').reason.code, 'conflict');
  assert.equal((await blueprint('list')).boards.length, 1);
  assert.equal(JSON.parse(await readFile(path.join(project, 'docs/flows/boards/checkout.json'), 'utf8')).title, ['One', 'Two'][outcomes.findIndex(item => item.status === 'fulfilled')]);
});

test('a board saved back as it was read restores the original file byte for byte', async t => {
  const { blueprint, project } = await setup(t);
  const board = { formatVersion: 4, id: 'undo', title: 'Undo', screens: [{ id: 'a', x: 10, y: 20 }] };
  const first = await blueprint('save', { board, revision: null });
  const file = path.join(project, 'docs/flows/boards/undo.json');
  const original = await readFile(file);
  const moved = await blueprint('save', { board: { ...board, screens: [{ id: 'a', x: 90, y: 20 }] }, revision: first.revision });
  assert.notDeepEqual(await readFile(file), original);
  await blueprint('save', { board: (await blueprint('read', { id: 'undo' })).board, revision: moved.revision });
  const restored = await blueprint('save', { board, revision: (await blueprint('read', { id: 'undo' })).revision });
  assert.deepEqual(await readFile(file), original);
  assert.equal(restored.revision, first.revision);
});

test('both stores reject unattached projects, path traversal, Windows aliases and symlinks', async t => {
  const { blueprint, voidCall, excluded, project, fixture } = await setup(t);
  for (const location of [excluded, fixture.root, path.join(project, '..'), 'missing']) await assert.rejects(blueprint('list', { location }), { code: 'denied' });
  for (const id of ['../escape', 'sub/board', 'a\\b', '.hidden', 'index', '']) await assert.rejects(blueprint('save', { board: { id }, revision: null }), { code: 'invalid' });
  for (const file of ['../escape.md', 'docs/../../escape.md', 'docs\\escape.md', '.git/config', '.env', 'docs/.env', 'docs/file.md:secret', 'docs/CON.md', 'docs/file.md.', path.join(excluded, 'secret.md')]) {
    await assert.rejects(voidCall('files.write', { path: file, base64: b64('secret'), expected: '' }), { code: 'denied' });
  }
  await writeFile(path.join(excluded, 'secret.md'), 'outside');
  await symlink(excluded, path.join(project, 'docs/link'), 'junction');
  await assert.rejects(voidCall('files.read', { path: 'docs/link/secret.md' }), { code: 'denied' });
  await assert.rejects(voidCall('files.write', { path: 'docs/link/secret.md', base64: b64('overwrite'), expected: '' }), { code: 'denied' });
  assert.equal(await readFile(path.join(excluded, 'secret.md'), 'utf8'), 'outside');
});

test('uploads enforce type and signatures, byte, count and cumulative limits; assets remain scoped', async t => {
  const { blueprint, project } = await setup(t);
  const uploaded = await blueprint('upload', { name: 'pixel.png', type: 'image/png', base64: PNG.toString('base64') });
  assert.match(uploaded.src, /^assets\/[a-f0-9-]{36}\.png$/);
  assert.equal(uploaded.path, uploaded.src);
  const asset = await blueprint('asset', { src: uploaded.src });
  assert.deepEqual(Buffer.from(asset.base64, 'base64'), PNG);
  assert.equal(asset.type, 'image/png');
  assert.equal((await blueprint('upload', { name: 'bytes.png', type: 'image/png', bytes: [...PNG] })).src.endsWith('.png'), true);
  for (const params of [{ base64: '<script>' }, { base64: Buffer.from('<svg/>').toString('base64'), type: 'image/svg+xml' },
    { base64: Buffer.from([255, 216, 255, 0]).toString('base64'), type: 'image/jpeg' },
    { base64: Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBP')]).toString('base64'), type: 'image/webp' },
    { base64: PNG.toString('base64'), type: 'image/jpeg' }, { base64: Buffer.alloc(APP_UPLOAD_LIMITS.fileBytes + 1).toString('base64') }]) {
    await assert.rejects(blueprint('upload', params), { code: 'invalid' });
  }
  for (const src of ['../escape.png', 'assets/../../escape.png', 'assets/x.png', 'assets/00000000-0000-0000-0000-000000000000.svg']) await assert.rejects(blueprint('asset', { src }), { code: 'invalid' });
  const directory = path.join(project, 'docs/flows/assets');
  await writeFile(path.join(directory, 'budget.bin'), Buffer.alloc(APP_UPLOAD_LIMITS.totalBytes));
  await assert.rejects(blueprint('upload', { base64: PNG.toString('base64') }), { code: 'invalid' });
  await writeFile(path.join(directory, 'budget.bin'), Buffer.alloc(0));
  await Promise.all(Array.from({ length: APP_UPLOAD_LIMITS.count - 3 }, (_, index) => writeFile(path.join(directory, `${index}.png`), Buffer.alloc(0))));
  await assert.rejects(blueprint('upload', { base64: PNG.toString('base64') }), { code: 'invalid' });
});

test('board fonts travel as assets by signature with the same containment and size limits as images', async t => {
  const { blueprint, project } = await setup(t);
  const directory = path.join(project, 'docs/flows/assets');
  for (const [extension, type] of [['woff2', 'font/woff2'], ['woff', 'font/woff'], ['ttf', 'font/ttf'], ['otf', 'font/otf']]) {
    const uploaded = await blueprint('upload', { name: `face.${extension}`, type, base64: fontBytes(extension).toString('base64') });
    assert.match(uploaded.src, new RegExp(`^assets/[a-f0-9-]{36}\\.${extension}$`));
    const asset = await blueprint('asset', { src: uploaded.src });
    assert.equal(asset.type, type);
    assert.deepEqual(Buffer.from(asset.base64, 'base64'), fontBytes(extension));
    assert.equal(await readFile(path.join(directory, uploaded.src.slice('assets/'.length))).then(bytes => bytes.length), fontBytes(extension).length);
  }
  const named = '4539d6c5-2b3a-4dc2-a491-ce1c040c5630';
  await writeFile(path.join(directory, `${named}.woff2`), fontBytes('woff2'));
  assert.equal((await blueprint('asset', { src: `assets/${named}.woff2` })).type, 'font/woff2');
  await writeFile(path.join(directory, `${named}.woff`), PNG);
  await assert.rejects(blueprint('asset', { src: `assets/${named}.woff` }), { code: 'invalid' });
  await writeFile(path.join(directory, `${named}.png`), fontBytes('woff2'));
  await assert.rejects(blueprint('asset', { src: `assets/${named}.png` }), { code: 'invalid' });
  await assert.rejects(blueprint('asset', { src: 'assets/11111111-1111-1111-1111-111111111111.woff2' }), { code: 'not_found' });
  await assert.rejects(blueprint('upload', { type: 'image/png', base64: fontBytes('woff2').toString('base64') }), { code: 'invalid' });
  await assert.rejects(blueprint('upload', { type: 'text/html', base64: fontBytes('woff2').toString('base64') }), { code: 'invalid' });
  await assert.rejects(blueprint('upload', { type: 'font/woff2', base64: Buffer.alloc(APP_UPLOAD_LIMITS.fileBytes + 1, 1).toString('base64') }), { code: 'invalid' });
  await assert.rejects(blueprint('upload', { type: 'font/woff2', base64: Buffer.concat([fontBytes('woff2'), Buffer.alloc(APP_UPLOAD_LIMITS.fileBytes)]).toString('base64') }), { code: 'invalid' });
  await assert.rejects(blueprint('asset', { location: path.join(project, '..'), src: `assets/${named}.woff2` }), { code: 'denied' });
  await writeFile(path.join(directory, `${named}.ttf`), Buffer.concat([fontBytes('ttf'), Buffer.alloc(APP_UPLOAD_LIMITS.fileBytes)]));
  await assert.rejects(blueprint('asset', { src: `assets/${named}.ttf` }), { code: 'invalid' });
});

test('Void files follow the app: one directory per list, bytes in and out, expected revisions, removal, and the project state folder', async t => {
  const { voidCall, project } = await setup(t);
  const text = 'First\r\n';
  const saved = await voidCall('files.write', { path: 'docs/article.md', base64: b64(text), expected: '' });
  assert.equal(saved.revision, hashBytes(Buffer.from(text)));
  assert.equal(saved.path, 'docs/article.md');
  const read = await voidCall('files.read', { path: 'docs/article.md' });
  assert.deepEqual(Buffer.from(read.base64, 'base64'), Buffer.from(text));
  assert.equal(read.revision, saved.revision);
  assert.equal(Object.hasOwn(read, 'text'), false);
  await assert.rejects(voidCall('files.write', { path: 'docs/article.md', base64: b64('Stale'), expected: '' }), { code: 'conflict' });
  await assert.rejects(voidCall('files.write', { path: 'docs/article.md', base64: b64('Stale'), expected: '1'.repeat(64) }), { code: 'conflict' });
  const next = await voidCall('files.write', { path: 'docs/article.md', base64: b64('Second'), expected: saved.revision });
  assert.equal((await voidCall('files.write', { path: 'docs/article.md', base64: b64('Unchecked') })).revision, hashBytes(Buffer.from('Unchecked')));
  assert.notEqual(next.revision, saved.revision);
  await assert.rejects(voidCall('files.read', { path: 'docs/missing.md' }), { code: 'not_found' });
  await assert.rejects(voidCall('files.write', { path: 'docs/article.md', expected: '' }), { code: 'invalid' });
  await assert.rejects(voidCall('files.write', { path: 'docs/image.exe', base64: b64('x'), expected: '' }), { code: 'denied' });
  const root = await voidCall('files.list', { path: '' });
  assert.deepEqual(root.map(entry => [entry.name, entry.kind]).sort(), [['docs', 'dir']]);
  assert.deepEqual((await voidCall('files.list', { path: 'docs' })).map(entry => [entry.name, entry.kind, entry.size, typeof entry.mtime]), [['article.md', 'file', 'Unchecked'.length, 'number'], ['flows', 'dir', 0, 'number']]);
  await assert.rejects(voidCall('files.list', { path: 'missing' }), { code: 'not_found' });
  await assert.rejects(voidCall('files.list', { path: 'docs/article.md' }), { code: 'not_found' });
  await assert.rejects(voidCall('files.list', {}), { code: 'invalid' });
  assert.equal((await voidCall('files.url', { path: 'docs/article.md' })).url, `data:text/plain;charset=utf-8;base64,${b64('Unchecked')}`);
  assert.deepEqual(await voidCall('files.attribution', { path: 'docs/article.md' }), { path: 'docs/article.md', by: 'root:master' });
  const removed = await voidCall('files.write', { path: 'docs/article.md', remove: true, expected: hashBytes(Buffer.from('Unchecked')) });
  assert.equal(removed.revision, '');
  await assert.rejects(voidCall('files.read', { path: 'docs/article.md' }), { code: 'not_found' });
  assert.equal((await voidCall('files.write', { path: 'docs/article.md', remove: true })).revision, '');
  assert.equal((await voidCall('project')).path, project);
  await voidCall('files.write', { path: 'docs/article.md', base64: b64('First\r\n'), expected: '' });
  assert.equal(Buffer.from((await voidCall('open.pick', { path: 'docs/article.md' })).base64, 'base64').toString(), 'First\r\n');
  assert.equal((await voidCall('open.switchTo')).path, project);
  assert.equal(await voidCall('storage.load', { key: 'workspace' }), null);
  await voidCall('storage.save', { key: 'workspace', value: { tab: 'first' } });
  assert.deepEqual(await voidCall('storage.load', { key: 'workspace' }), { tab: 'first' });
  await voidCall('storage.save', { key: 'workspace', value: { tab: 'second' } });
  assert.deepEqual(await voidCall('storage.load', { key: 'workspace' }), { tab: 'second' });
});

test('Void state in .void/ opens for void.files only; every other dot path and the Blueprint side stay refused', async t => {
  const { voidCall, blueprint, project, call } = await setup(t);
  await mkdir(path.join(project, '.void'));
  await mkdir(path.join(project, '.git'));
  await writeFile(path.join(project, '.git/config'), 'secret');
  await writeFile(path.join(project, '.env'), 'secret');
  for (const state of ['project.json', 'settings.json', 'status.json', 'baseline.json', 'trash.json']) {
    const file = `.void/${state}`;
    await assert.rejects(voidCall('files.read', { path: file }), { code: 'not_found' });
    const saved = await voidCall('files.write', { path: file, base64: b64(`{"state":"${state}"}\n`), expected: '' });
    assert.equal(Buffer.from((await voidCall('files.read', { path: file })).base64, 'base64').toString(), `{"state":"${state}"}\n`);
    assert.equal(await readFile(path.join(project, file), 'utf8'), `{"state":"${state}"}\n`);
    await voidCall('files.write', { path: file, base64: b64('{}\n'), expected: saved.revision });
  }
  const blob = '0123abcd';
  await voidCall('files.write', { path: `.void/blobs/${blob}`, base64: b64('blob'), expected: '' });
  await voidCall('files.write', { path: '.void/versions/notes.md.jsonl', base64: b64('{}\n'), expected: '' });
  await voidCall('files.write', { path: '.void/comments/notes.md.json', base64: b64('{}\n'), expected: '' });
  assert.deepEqual((await voidCall('files.list', { path: '.void' })).map(entry => entry.name).sort(), ['baseline.json', 'blobs', 'comments', 'project.json', 'settings.json', 'status.json', 'trash.json', 'versions']);
  assert.deepEqual((await voidCall('files.list', { path: '.void/blobs' })).map(entry => entry.name), [blob]);
  assert.equal((await voidCall('files.write', { path: `.void/blobs/${blob}`, remove: true, expected: hashBytes(Buffer.from('blob')) })).revision, '');
  assert.equal((await voidCall('files.list', { path: '' })).some(entry => entry.name.startsWith('.')), false);
  for (const refused of ['.git/config', '.env', '.git', '.voidx/a.json', '.void2', '.void/../.git/config', '.void/.hidden', 'docs/.void/project.json', '.void/..', '..']) {
    await assert.rejects(voidCall('files.read', { path: refused }), { code: 'denied' });
    await assert.rejects(voidCall('files.write', { path: refused, base64: b64('x'), expected: '' }), { code: 'denied' });
  }
  for (const refused of ['.git', '.voidx', '..', '../..', 'docs/../..']) await assert.rejects(voidCall('files.list', { path: refused }), { code: 'denied' });
  await assert.rejects(voidCall('files.write', { path: '.void/project.json', remove: true, expected: '1'.repeat(64) }), { code: 'conflict' });
  assert.equal(await readFile(path.join(project, '.git/config'), 'utf8'), 'secret');
  assert.equal(await readFile(path.join(project, '.env'), 'utf8'), 'secret');
  for (const method of ['open.pick', 'open.switchTo']) {
    await assert.rejects(voidCall(method, { path: '.void/project.json' }), { code: 'denied' });
    await assert.rejects(voidCall(method, { path: path.join(project, '.void/project.json') }), { code: 'denied' });
  }
  await assert.rejects(blueprint('read', { id: '.void/project' }), { code: 'invalid' });
  await assert.rejects(call('blueprint', 'blueprint.asset', { location: project, src: 'assets/../../.void/project.json' }), { code: 'invalid' });
  await mkdir(path.join(project, 'docs/flows/.void'), { recursive: true });
  await assert.rejects(call('blueprint', 'blueprint.save', { location: project, board: { id: '.void' }, revision: null }), { code: 'invalid' });
});

test('a project state folder reached through a link stays outside the project', async t => {
  const { voidCall, excluded, project } = await setup(t);
  await mkdir(path.join(excluded, 'state'));
  await symlink(path.join(excluded, 'state'), path.join(project, '.void'), 'junction');
  await assert.rejects(voidCall('files.write', { path: '.void/project.json', base64: b64('{}'), expected: '' }), { code: 'denied' });
  await assert.rejects(voidCall('files.list', { path: '.void' }), { code: 'denied' });
});

test('events carry only metadata, suppress own watcher echoes, retain changes from another app and known authors', async t => {
  const { context, blueprint, project, events, call } = await setup(t);
  await call('void', 'hello', { app: 'void', appVersion: '1', protocol: 1 });
  await observePass(context, { baseline: true });
  await blueprint('save', { board: { id: 'board', formatVersion: 4 }, revision: null });
  const own = events.find(event => event.data.name === 'blueprint.changed');
  assert.equal(own.data.clientId, CLIENT);
  assert.deepEqual([own.data.params.location, own.data.params.id], ['shop', 'board']);
  assert.equal(events.find(event => event.data.name === 'void.files.changed').data.clientId, undefined);
  const length = events.length;
  await observePass(context);
  assert.equal(events.length, length, 'watcher must not echo a bridge save');
  const relative = 'docs/flows/boards/board.json', file = path.join(project, relative);
  const bytes = Buffer.from('{"format":4,"title":"Agent"}');
  await mkdir(path.join(context.paths.mind, 'user/gui'), { recursive: true });
  await writeFile(path.join(context.paths.mind, 'user/gui/resources.json'), JSON.stringify({ resources: [{ id: 'resource', project: 'shop', path: relative }] }));
  context.store.events.push({ resourceId: 'resource', revision: hashBytes(bytes), source: { unitId: 'project:shop:executor' } });
  await writeFile(file, bytes);
  await observePass(context);
  const outside = events.findLast(event => event.data.name === 'blueprint.changed');
  assert.equal(outside.data.params.by, 'project:shop:executor');
  assert.equal(outside.data.clientId, undefined);
  assert.equal(JSON.stringify(events).includes('"title"'), false);
  await unlink(file);
  await observePass(context);
  await writeFile(file, bytes);
  await observePass(context);
  assert.equal(events.findLast(event => event.data.name === 'void.files.changed').data.params[0].kind, 'created');
  appAgentsChanged(context);
  await delay(80);
  assert.equal(events.filter(event => event.data.name === 'agents.changed').length, 1);
});

test('a scanner read overlapping a bridge save never emits the previous bytes as an outside change', async t => {
  const { context, blueprint, project, events, call } = await setup(t);
  await call('blueprint', 'hello', { app: 'blueprint', appVersion: '1', protocol: 1 });
  const file = path.join(project, 'docs/flows/boards/overlap.json');
  const bytes = Buffer.from('{"format":4}');
  await writeFile(file, bytes);
  await observePass(context, { baseline: true });
  await utimes(file, new Date(), new Date(Date.now() + 10000));
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const original = fsPromises.readFile;
  let intercepted = false;
  fsPromises.readFile = async function (target, ...args) {
    const result = await original.call(this, target, ...args);
    if (String(target) === file && !intercepted) {
      intercepted = true;
      entered.resolve();
      await release.promise;
    }
    return result;
  };
  syncBuiltinESMExports();
  let observing, saving;
  try {
    observing = observePass(context);
    await entered.promise;
    saving = blueprint('save', { board: { id: 'overlap', title: 'Own' }, revision: hashBytes(bytes) });
    // A correctly serialized writer waits until the scanner releases its read.
    const wroteBeforeReadCompleted = await Promise.race([saving.then(() => true), delay(500).then(() => false)]);
    assert.equal(wroteBeforeReadCompleted, false, 'The bridge write must wait for the overlapping scanner read.');
    release.resolve();
    await Promise.all([observing, saving]);
    const changes = events.filter(event => event.data.name === 'blueprint.changed');
    assert.equal(changes.length, 2, 'The stats-only baseline detects the touched file before the queued save.');
    assert.equal(changes[0].data.clientId, undefined);
    assert.equal(changes[1].data.clientId, CLIENT);
  } finally {
    release.resolve();
    await Promise.allSettled([observing, saving].filter(Boolean));
    fsPromises.readFile = original;
    syncBuiltinESMExports();
  }
});

test('a project with more than 2000 text files remains observable and one directory lists whole', async t => {
  const { context, project, events, voidCall, call } = await setup(t);
  await call('void', 'hello', { app: 'void', appVersion: '1', protocol: 1 });
  const directory = path.join(project, 'texts');
  await mkdir(directory);
  await Promise.all(Array.from({ length: 2001 }, (_, index) => writeFile(path.join(directory, `${index}.md`), 'First.')));
  while ((await observeAppFiles(context, { baseline: true })).pending) { /* Finish bounded slices. */ }
  const file = path.join(directory, '2000.md');
  await writeFile(file, 'Changed.');
  const original = fsPromises.readFile;
  let textReads = 0;
  fsPromises.readFile = async function (target, ...args) {
    if (String(target).endsWith('.md')) textReads++;
    return original.call(this, target, ...args);
  };
  syncBuiltinESMExports();
  try { while ((await observeAppFiles(context)).pending) { /* Finish bounded slices. */ } }
  finally { fsPromises.readFile = original; syncBuiltinESMExports(); }
  assert.equal(textReads, 1, 'The rescan must reread only the text whose bytes changed.');
  assert.equal(events.some(event => event.data.name === 'void.files.changed' && event.data.params.some(item => item.path === 'texts/2000.md' && item.kind === 'changed')), true);
  assert.deepEqual((await voidCall('files.list', { path: 'texts' })).length, 2001);
});

test('filesystem watch reports real board and text edits and deletions without manual observation', async t => {
  const { fixture, context, project } = await setup(t);
  const board = path.join(project, 'docs/flows/boards/watched.json');
  const text = path.join(project, 'docs/watched.md');
  await writeFile(board, '{"format":4}');
  await writeFile(text, 'First.');
  const core = await composeCore({ ...context, bus: undefined, clients: [], env: fixture.env, port: 0 });
  t.after(() => core.http.close());
  updateAppActivity({ ...context, bus: core.bus }, { clientId: CLIENT, apps: ['blueprint', 'void'], location: project });
  while ((await observeAppFiles({ ...context, bus: core.bus }, { baseline: true })).pending) { /* Establish the open apps' baseline. */ }
  const events = [];
  const subscription = core.bus.subscribe({ stableId: 'app-bridge-watch-test', audience: 'desktop' }, {}, frame => {
    if (frame.name === 'app.bridge') events.push(frame.data.data);
  });
  t.after(() => core.bus.release(subscription));
  const until = async (check) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (check()) return;
      await delay(25);
    }
    assert.fail('The filesystem watcher did not publish the app change.');
  };
  await writeFile(board, '{"format":4,"title":"Outside"}');
  await writeFile(text, 'Outside.');
  await until(() => events.some(event => event.name === 'blueprint.changed' && event.params.id === 'watched')
    && events.some(event => event.name === 'void.files.changed' && event.params.some(item => item.path === 'docs/watched.md' && item.kind === 'changed')));
  await unlink(text);
  await until(() => events.some(event => event.name === 'void.files.changed' && event.params.some(item => item.path === 'docs/watched.md' && item.kind === 'deleted')));
  assert.equal(events.some(event => event.clientId), false);
});

test('bridge HTTP routes reuse desktop bearer, Origin, Host and idempotency guards; phone and agent cannot call', async t => {
  const { fixture, context, project } = await setup(t);
  const credentials = createCredentialStore({ now: context.now });
  const http = await createHttpServer({ store: fixture.store, paths: fixture.paths, projects: context.projects, credentials, now: context.now });
  t.after(() => http.close());
  const agentEvents = [];
  const subscriber = http.bus.subscribe({ stableId: 'app-agent-events-test', audience: 'desktop' }, {}, frame => agentEvents.push(frame));
  t.after(() => http.bus.release(subscriber));
  http.bus.emit({ name: 'unit.changed', data: { unitId: 'project:shop:executor' } });
  await delay(80);
  assert.equal(agentEvents.filter(frame => frame.name === 'app.bridge' && frame.data.data.name === 'agents.changed').length, 1);
  assert.equal(agentEvents[0].name, 'unit.changed', 'derived app events follow their source cursor');
  const origin = `http://127.0.0.1:${http.port}`;
  const desktop = credentials.issue({ audience: 'desktop', unitId: 'root:master', viewerId: randomUUID(), expiresAt: null });
  const payload = { app: 'blueprint', method: 'blueprint.save', params: { location: project, board: { id: 'http' }, revision: null }, clientId: CLIENT };
  function request(token, extra = {}, key = randomUUID(), body = payload) {
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(`${origin}/api/v1/app-bridge/call`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': key, ...extra } }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => resolve({ status: response.statusCode, json: JSON.parse(Buffer.concat(chunks)) }));
      });
      outgoing.on('error', reject);
      outgoing.end(JSON.stringify(body));
    });
  }
  const key = randomUUID(), result = await request(desktop.token, {}, key);
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal((await request(desktop.token, {}, key)).json.data.revision, result.json.data.revision);
  await mkdir(path.join(fixture.paths.mind, 'user/gui'), { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'user/gui/resources.json'), JSON.stringify({ resources: [{ id: 'http-resource', project: 'shop', path: 'docs/flows/boards/http.json' }] }));
  fixture.store.events.push({ resourceId: 'http-resource', revision: result.json.data.revision, source: { unitId: 'project:shop:executor' } });
  const attribution = await request(desktop.token, {}, randomUUID(), { app: 'void', method: 'void.files.attribution', params: { location: project, path: 'docs/flows/boards/http.json' }, clientId: CLIENT });
  assert.equal(attribution.status, 200);
  assert.equal(attribution.json.data.by, 'project:shop:executor');
  assert.equal(attribution.json.data.path, 'docs/flows/boards/http.json');
  assert.equal((await request('invalid')).status, 401);
  assert.equal((await request(desktop.token, { Origin: 'https://blueprint.txmska.com' })).status, 403);
  assert.ok([400, 403].includes((await request(desktop.token, { Host: 'attacker.example' })).status));
  for (const audience of ['phone', 'agent']) {
    const credential = credentials.issue({ audience, unitId: 'root:master', capabilities: ['editor.write'], expiresAt: null });
    assert.equal((await request(credential.token)).status, 403);
  }
  const invalid = await request(desktop.token, {}, randomUUID(), { ...payload, method: 'void.files.write' });
  assert.equal(invalid.json.error.code, 'invalid');
  assert.equal(JSON.stringify(invalid.json).includes(project), false);
});

test('observer skips projects without an open app and baselines open app files without body reads', async t => {
  const { context, project, call } = await setup(t);
  const file = path.join(project, 'docs/test.md');
  await writeFile(file, 'Content.');
  const original = fsPromises.readFile;
  let reads = 0;
  fsPromises.readFile = async function(target, ...args) { if (String(target) === file) reads++; return original.call(this, target, ...args); };
  syncBuiltinESMExports();
  try {
    const idle = await observeAppFiles(context, { baseline: true });
    assert.equal(reads, 0);
    assert.equal(idle.entries, 0);
    await call('void', 'hello', { app: 'void', protocol: 1, appVersion: '1' });
    await observeAppFiles(context, { baseline: true });
    assert.equal(reads, 0, 'The first open records stats without reading document bodies.');
  } finally { fsPromises.readFile = original; syncBuiltinESMExports(); }
});

test('observer bounds each slice, continues and skips unreadable and rejected entries', async t => {
  const { context, project, call } = await setup(t);
  await call('void', 'hello', { app: 'void', protocol: 1, appVersion: '1' });
  await Promise.all(Array.from({ length: 500 }, (_, index) => writeFile(path.join(project, `file-${index}.md`), 'First.')));
  await writeFile(path.join(project, 'rejected..md'), 'First.');
  const original = fsPromises.lstat;
  fsPromises.lstat = async function(target, ...args) {
    if (String(target).endsWith('file-25.md')) throw Object.assign(new Error('Unreadable.'), { code: 'EACCES' });
    return original.call(this, target, ...args);
  };
  syncBuiltinESMExports();
  try {
    let result = await observeAppFiles(context, { baseline: true });
    assert.equal(result.pending, true);
    assert.ok(result.entries <= 400);
    let skipped = result.skipped, slices = 1;
    while (result.pending && slices++ < 20) { result = await observeAppFiles(context, { baseline: true }); skipped += result.skipped; }
    assert.equal(result.pending, false);
    assert.ok(skipped >= 1);
  } finally { fsPromises.lstat = original; syncBuiltinESMExports(); }
});

test('each observation slice batches file changes and coalesces agent notifications', async t => {
  const { context, project, call, events } = await setup(t);
  await call('void', 'hello', { app: 'void', protocol: 1, appVersion: '1' });
  for (const name of ['first.md', 'second.md']) await writeFile(path.join(project, name), 'First.');
  await observePass(context, { baseline: true });
  for (const name of ['first.md', 'second.md']) await writeFile(path.join(project, name), 'Changed.');
  let result;
  do {
    const offset = events.length;
    result = await observeAppFiles(context);
    assert.ok(events.slice(offset).filter(event => event.data.name === 'void.files.changed').length <= 1);
  } while (result.pending);
  const changes = events.filter(event => event.data.name === 'void.files.changed');
  assert.deepEqual(changes.flatMap(event => event.data.params.map(change => path.basename(change.path))).sort(), ['first.md', 'second.md']);
  for (let index = 0; index < 50; index++) appAgentsChanged(context);
  await delay(80);
  const agents = events.filter(event => event.data.name === 'agents.changed');
  assert.equal(agents.length, 1);
  assert.equal(agents[0].data.app, null);
});

test('Windows case variants select the same project and serialize the same file lock', { skip: process.platform !== 'win32' }, async t => {
  const { blueprint, voidCall, project } = await setup(t);
  const saved = await blueprint('save', { location: project.toUpperCase(), board: { id: 'case' }, revision: null });
  assert.equal(Buffer.from((await voidCall('open.pick', { location: undefined, path: path.join(project, 'docs/flows/boards/case.json').toUpperCase() })).base64, 'base64').toString(), boardText({ id: 'case' }));
  const outcomes = await Promise.allSettled([project, project.toUpperCase()].map(location => blueprint('save', { location, board: { id: 'case', next: true }, revision: saved.revision })));
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(item => item.status === 'rejected').reason.code, 'conflict');
});

test('Void project switches return their selection without an echo', async t => {
  const { voidCall, project, events } = await setup(t);
  assert.equal((await voidCall('open.switchTo')).path, project);
  assert.equal(events.some(event => event.data.name === 'void.project'), false);
});

test('a directory lists whole up to its limit, then returns partial entries and the limit', async t => {
  const { voidCall, project } = await setup(t);
  await mkdir(path.join(project, 'many'));
  for (let start = 0; start < 10_001; start += 250) await Promise.all(Array.from({ length: Math.min(250, 10_001 - start) }, (_, index) => writeFile(path.join(project, 'many', `listing-${start + index}.md`), 'First.')));
  const result = await voidCall('files.list', { path: 'many' });
  assert.equal(result.truncated, true);
  assert.equal(result.limit, 10_000);
  assert.equal(result.entries.length, 10_000);
  assert.equal(result.entries[0].kind, 'file');
});

test('agent notifications coalesce across repeated source changes', async t => {
  const { context, events } = await setup(t);
  for (let index = 0; index < 50; index++) appAgentsChanged(context);
  await delay(80);
  assert.equal(events.filter(event => event.data.name === 'agents.changed').length, 1);
});

test('open Blueprint observes only flow files and open Void only its selected project until its lease ends', async t => {
  const { context, project, excluded, fixture } = await setup(t);
  context.projects[1].eligible = true;
  await writeFile(path.join(project, 'unrelated.md'), 'First.');
  await writeFile(path.join(excluded, 'unrelated.md'), 'First.');
  const original = fsPromises.lstat, visited = [];
  fsPromises.lstat = async function(target, ...args) { visited.push(String(target)); return original.call(this, target, ...args); };
  syncBuiltinESMExports();
  try {
    updateAppActivity(context, { clientId: CLIENT, apps: ['blueprint'] });
    while ((await observeAppFiles(context)).pending) { /* Finish bounded slices. */ }
    assert.equal(visited.some(file => file.endsWith('unrelated.md')), false);
    visited.length = 0;
    updateAppActivity(context, { clientId: CLIENT, apps: ['void'], location: project });
    while ((await observeAppFiles(context)).pending) { /* Finish bounded slices. */ }
    assert.equal(visited.includes(path.join(project, 'unrelated.md')), true);
    assert.equal(visited.includes(path.join(excluded, 'unrelated.md')), false);
    fixture.clock.now += 90001;
    visited.length = 0;
    assert.equal((await observeAppFiles(context)).entries, 0);
    assert.equal(visited.length, 0);
  } finally { fsPromises.lstat = original; syncBuiltinESMExports(); }
});

test('app observer access failures never prevent service startup or a later ordinary file edit', async t => {
  const { context, fixture, project, events } = await setup(t);
  await writeFile(path.join(project, 'blocked.md'), 'First.');
  const readable = path.join(project, 'readable.md');
  await writeFile(readable, 'First.');
  updateAppActivity(context, { clientId: CLIENT, apps: ['void'], location: project });
  const original = fsPromises.opendir;
  fsPromises.opendir = async function(target, ...args) {
    if (String(target) === project) throw Object.assign(new Error('Busy.'), { code: 'EBUSY' });
    return original.call(this, target, ...args);
  };
  syncBuiltinESMExports();
  let core;
  try { core = await composeCore({ ...context, bus: undefined, clients: [], env: fixture.env, port: 0 }); }
  finally { fsPromises.opendir = original; syncBuiltinESMExports(); }
  t.after(() => core.http.close());
  assert.equal(core.lastError ?? null, null);
  // Restart observation after the temporary root failure, then verify it still receives writes.
  while ((await observeAppFiles(context, { baseline: true })).pending) { /* Finish bounded slices. */ }
  await writeFile(readable, 'Changed.');
  while ((await observeAppFiles(context)).pending) { /* Finish bounded slices. */ }
  assert.equal(events.some(event => event.data.name === 'void.files.changed' && event.data.params.some(item => item.path === 'readable.md')), true);
});

test('watcher completes app slices after one notification without another filesystem event', async t => {
  const { context, fixture, project, events } = await setup(t);
  await Promise.all(Array.from({ length: 501 }, (_, index) => writeFile(path.join(project, `slice-${index}.md`), 'First.')));
  const runtime = { sync: { store: fixture.store, projects: context.projects, paths: fixture.paths, now: context.now },
    paths: fixture.paths, now: context.now, bus: context.bus, pulse: { async changed() {} } };
  const close = await watchLocalChanges(runtime);
  t.after(close);
  const original = fsPromises.lstat;
  const visited = new Set();
  fsPromises.lstat = async function(target, ...args) { if (String(target).includes('slice-')) visited.add(String(target)); return original.call(this, target, ...args); };
  syncBuiltinESMExports();
  try {
    updateAppActivity(context, { clientId: CLIENT, apps: ['void'], location: project });
    const deadline = Date.now() + 8000;
    while (visited.size < 501 && Date.now() < deadline) await delay(25);
    assert.equal(visited.size, 501);
    assert.equal(events.some(event => event.name === 'issue.changed' && event.data.issue === 'local_change_failed'), false);
  } finally { fsPromises.lstat = original; syncBuiltinESMExports(); }
});

test('activity heartbeats preserve the project selected inside Void until the host selection changes', async t => {
  const { context, project, excluded, call } = await setup(t);
  context.projects[1].eligible = true;
  updateAppActivity(context, { clientId: CLIENT, apps: ['void'], location: project });
  await call('void', 'void.open.switchTo', { location: excluded });
  updateAppActivity(context, { clientId: CLIENT, apps: ['void'], location: project });
  assert.equal((await call('void', 'void.project')).path, excluded);
  updateAppActivity(context, { clientId: CLIENT, apps: ['void'], location: excluded });
  updateAppActivity(context, { clientId: CLIENT, apps: ['void'], location: project });
  assert.equal((await call('void', 'void.project')).path, project);
});

test('app-origin project selection changes only its client and never broadcasts a host switch', async t => {
  const { context, call, project, excluded, events } = await setup(t);
  context.projects[1].eligible = true;
  for (const clientId of [CLIENT, 'second-app']) await call('void', 'hello', { app: 'void', protocol: 1, appVersion: '1', location: project }, { clientId });
  await call('void', 'void.open.switchTo', { location: excluded });
  assert.equal((await call('void', 'void.project')).path, excluded);
  assert.equal((await call('void', 'void.project', {}, { clientId: 'second-app' })).path, project);
  assert.equal(events.some(event => event.data.name === 'void.project'), false);
});

test('agent notifications target the affected project and are cancelled when observation stops', async t => {
  const { context, events } = await setup(t);
  context.projects[1].eligible = true;
  appAgentsChanged(context, 'shop');
  await delay(80);
  assert.equal(events.filter(event => event.data.name === 'agents.changed').length, 1);
  assert.equal(events.find(event => event.data.name === 'agents.changed').data.params.location, context.projects[0].localPath);
  events.length = 0;
  appAgentsChanged(context);
  await stopAppObservation(context);
  await delay(80);
  assert.equal(events.length, 0);
});
