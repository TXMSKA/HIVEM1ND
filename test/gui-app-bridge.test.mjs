import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { APP_METHODS, APP_TARGETS, appMethodAllowed, appOrigin, createEmbeddedApps } from '../gui/app-bridge.mjs';
import { secureWebPreferences } from '../gui/electron-preferences.mjs';

function fixture(t, options = {}) {
  const views = [], sessions = new Map(), external = [], calls = [], activities = [], statuses = [], writes = [];
  const window = Object.assign(new EventEmitter(), {
    visible: true, minimized: false, size: [1000, 700],
    isDestroyed: () => false, isVisible() { return this.visible; }, isMinimized() { return this.minimized; }, getContentSize() { return this.size; },
    webContents: { send(channel, status) { statuses.push({ channel, ...status }); } },
    contentView: { addChildView() {}, removeChildView() {} },
  });
  class View {
    constructor(config) {
      this.config = config; this.events = []; views.push(this);
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: '' }, isDestroyed: () => false,
        send: (channel, envelope) => this.events.push({ channel, ...envelope }),
        setWindowOpenHandler: handler => { this.open = handler; },
        loadURL: async url => { this.webContents.mainFrame.url = url; if (options.loadFail) throw new Error('Network unavailable'); this.webContents.emit('did-finish-load'); },
        printToPDF: async () => Buffer.from('pdf'), close: () => { this.closed = true; },
      });
    }
    setVisible(value) { this.visible = value; }
    setBounds(value) { this.bounds = value; }
  }
  const session = { fromPartition(name) {
    const value = Object.assign(new EventEmitter(), { setPermissionCheckHandler(handler) { this.check = handler; }, setPermissionRequestHandler(handler) { this.request = handler; } });
    sessions.set(name, value); return value;
  } };
  const host = createEmbeddedApps({ window, WebContentsView: View, session, secureWebPreferences, preload: '/host/app-preload.cjs',
    hostVersion: '3.0.0', serviceOrigin: () => 'http://127.0.0.1:41234', shell: { async openExternal(url) { external.push(url); } },
    dialog: { async showSaveDialog() { return options.saveResult ?? { canceled: false, filePath: '/chosen/export.md' }; }, async showOpenDialog() { return options.openResult ?? { canceled: false, filePaths: ['/attached/docs/note.md'] }; } },
    writeFileImpl: options.writeFileImpl ?? (async (target, bytes) => writes.push({ target, text: bytes.toString() })), saveTimeout: 10,
    fetchImpl: async (url, init) => { (url.endsWith('/activity') ? activities : calls).push({ url, ...init, body: JSON.parse(init.body) }); return new Response(JSON.stringify(options.response ?? { data: { person: { name: 'Tom' }, ok: true } }), { status: options.status ?? 200 }); },
  });
  t.after(() => host.dispose());
  const update = (app, extra = {}) => host.update({ app, bounds: { x: 20, y: 40, width: 700, height: 600 }, locale: 'en', tokens: { surface: '#123456' }, token: 'viewer-secret', ...extra });
  const event = (view = views.at(-1)) => ({ sender: view.webContents, senderFrame: view.webContents.mainFrame });
  return { host, views, sessions, window, external, calls, activities, statuses, writes, update, event };
}

test('each app has only its agreed methods and exact credential-free origin', () => {
  for (const app of ['blueprint', 'void']) {
    for (const method of APP_METHODS[app]) assert.equal(appMethodAllowed(app, method), true);
    assert.equal(appOrigin(app, `${APP_TARGETS[app].origin}/path?host=OTHER`), true);
    for (const url of ['https://evil.test', `${APP_TARGETS[app].origin}.evil.test/`, APP_TARGETS[app].origin.replace('https:', 'http:'), APP_TARGETS[app].origin.replace('https://', 'https://user:password@'), 'file:///secret', 'invalid']) assert.equal(appOrigin(app, url), false, url);
    for (const method of ['constructor', '__proto__', 'capabilities', 'files.read', 'void.files.read.evil', null]) assert.equal(appMethodAllowed(app, method), false);
  }
  assert.equal(appMethodAllowed('blueprint', 'void.files.read'), false);
  assert.equal(appMethodAllowed('void', 'blueprint.read'), false);
});

test('native views use isolated persistent sessions with only same-origin clipboard permissions', t => {
  const f = fixture(t); f.update('blueprint'); f.update('void');
  assert.equal(f.views.length, 2);
  for (const [index, app] of ['blueprint', 'void'].entries()) {
    const view = f.views[index], session = f.sessions.get(`persist:app-${app}`);
    assert.deepEqual(view.config.webPreferences, { ...secureWebPreferences, partition: `persist:app-${app}`, preload: '/host/app-preload.cjs' });
    for (const permission of ['clipboard-read', 'clipboard-sanitized-write']) assert.equal(session.check(view.webContents, permission, APP_TARGETS[app].origin), true);
    for (const permission of ['media', 'geolocation', 'notifications', 'fileSystem', 'openExternal']) assert.equal(session.check(view.webContents, permission, APP_TARGETS[app].origin), false);
    assert.equal(session.check(view.webContents, 'clipboard-read', 'https://evil.test'), false);
    assert.equal(session.check({}, 'clipboard-read', APP_TARGETS[app].origin), false);
    let permitted;
    session.request(view.webContents, 'clipboard-read', result => { permitted = result; }, { requestingUrl: APP_TARGETS[app].origin });
    assert.equal(permitted, true);
    let prevented = false; session.emit('will-download', { preventDefault() { prevented = true; } }); assert.equal(prevented, true);
  }
});

test('navigation and popups keep the native view on its origin and reject privileged links', t => {
  const f = fixture(t); f.update('blueprint'); const view = f.views[0];
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
    let blocked = false;
    view.webContents.emit(name, { url: 'https://evil.test/link', isMainFrame: true, preventDefault() { blocked = true; } });
    assert.equal(blocked, true);
    blocked = false; view.webContents.emit(name, { url: `${APP_TARGETS.blueprint.origin}/files/board`, preventDefault() { blocked = true; } }); assert.equal(blocked, false);
  }
  assert.deepEqual(view.open({ url: 'https://example.test/guide' }), { action: 'deny' });
  for (const url of ['javascript:alert(1)', 'file:///secret', 'https://name:secret@example.test']) view.open({ url });
  assert.deepEqual(f.external, ['https://evil.test/link', 'https://evil.test/link', 'https://evil.test/link', 'https://example.test/guide']);
});

test('same-document app navigation keeps the loaded view visible and receiving events', t => {
  const f = fixture(t); f.update('blueprint'); const view = f.views[0];
  view.events.length = 0;
  const route = `${APP_TARGETS.blueprint.origin}/files/board`;
  view.webContents.mainFrame.url = route;
  view.webContents.emit('did-start-navigation', {}, route, true, true);
  assert.equal(view.visible, true);
  assert.equal(f.statuses.at(-1).state, 'ready');
  f.host.event({ name: 'app.bridge', envelope: { data: { app: 'blueprint', name: 'blueprint.changed', params: { id: 'board' } } } });
  assert.deepEqual(view.events.at(-1), { channel: 'cosmic:bridge-event', name: 'blueprint.changed', params: { id: 'board' } });
});

test('cross-document and foreign same-document navigation suspend the loaded app', t => {
  for (const [url, sameDocument] of [[APP_TARGETS.blueprint.url, false], ['https://evil.test/files', true]]) {
    const f = fixture(t); f.update('blueprint'); const view = f.views[0];
    view.events.length = 0;
    view.webContents.emit('did-start-navigation', {}, url, sameDocument, true);
    assert.equal(view.visible, false);
    assert.equal(f.statuses.at(-1).state, 'loading');
    f.host.event({ name: 'app.bridge', envelope: { data: { app: 'blueprint', name: 'blueprint.changed', params: { id: 'board' } } } });
    assert.equal(view.events.length, 0);
  }
});

test('bridge checks the actual app main frame and emits exact handshake capabilities without the viewer credential', async t => {
  const f = fixture(t); f.update('blueprint', { locale: 'es', project: '/attached' }); const event = f.event();
  for (const value of [{ ...event, sender: {} }, { ...event, senderFrame: { url: event.senderFrame.url } }]) assert.deepEqual(await f.host.call(value, 'blueprint.list', {}), { error: { code: 'denied' } });
  event.senderFrame.url = 'https://evil.test'; assert.deepEqual(await f.host.call(event, 'blueprint.list', {}), { error: { code: 'denied' } });
  event.senderFrame.url = APP_TARGETS.blueprint.url;
  assert.deepEqual(await f.host.call(event, 'void.files.read', {}), { error: { code: 'invalid' } });
  assert.deepEqual(await f.host.call(event, 'hello', { app: 'void', appVersion: '1.0', protocol: 1 }), { error: { code: 'invalid' } });
  const hello = await f.host.call(event, 'hello', { app: 'blueprint', appVersion: '1.0', protocol: 1 });
  assert.deepEqual(hello.result, { host: 'ONEM1ND', hostVersion: '3.0.0', protocol: 1, locale: 'es', tokens: { surface: '#123456' }, visible: true, capabilities: [...APP_METHODS.blueprint], person: { name: 'Tom' } });
  assert.equal(JSON.stringify(hello).includes('viewer-secret'), false);
  assert.equal(f.calls[0].headers.Authorization, 'Bearer viewer-secret');
  assert.equal(f.calls[0].headers.Origin, 'http://127.0.0.1:41234');
  assert.match(f.calls[0].headers['Idempotency-Key'], /^[0-9a-f-]{36}$/);
  assert.equal(f.calls[0].body.params.project, '/attached');
  assert.equal(f.calls[0].body.clientId, f.host.clientId);
  assert.equal(f.calls.length, 1);
  const withoutPerson = fixture(t, { response: { data: {} } });
  withoutPerson.update('void');
  const optional = await withoutPerson.host.call(withoutPerson.event(), 'hello', { app: 'void', appVersion: '1.0', protocol: 1 });
  assert.equal(Object.hasOwn(optional.result, 'person'), false);
  assert.deepEqual(optional.result.capabilities, [...APP_METHODS.void]);
});

test('service calls preserve revision conflicts and convert IPC binary uploads to bounded base64', async t => {
  const f = fixture(t, { status: 409, response: { error: { code: 'conflict', message: 'Private board body' } } }); f.update('blueprint');
  assert.deepEqual(await f.host.call(f.event(), 'blueprint.upload', { bytes: new Uint8Array([1, 2]), name: 'pixel.png', type: 'image/png' }), { error: { code: 'conflict' } });
  assert.deepEqual(f.calls[0].body.params, { name: 'pixel.png', type: 'image/png', base64: 'AQI=' });
  assert.equal(JSON.stringify(await f.host.call(f.event(), 'blueprint.read', {})).includes('Private'), false);
});

test('asset responses restore binary bytes across the authenticated JSON service boundary', async t => {
  const f = fixture(t, { response: { data: { src: 'assets/image.png', base64: 'AQI=', type: 'image/png', revision: 'revision' } } }); f.update('blueprint');
  const { result } = await f.host.call(f.event(), 'blueprint.asset', { location: 'attached', src: 'assets/image.png' });
  assert.deepEqual(f.calls[0].body.params, { location: 'attached', src: 'assets/image.png' });
  assert.equal(result.type, 'image/png');
  assert.equal(Object.hasOwn(result, 'base64'), false);
  assert.deepEqual([...new Uint8Array(result.bytes)], [1, 2]);
});

test('Blueprint calls carry the live app keys and refuse the host-only ones', async t => {
  const f = fixture(t); f.update('blueprint');
  const board = { formatVersion: 4, id: 'board', title: 'Board' };
  assert.equal((await f.host.call(f.event(), 'blueprint.save', { location: 'attached', board, revision: null })).result.ok, true);
  assert.equal((await f.host.call(f.event(), 'blueprint.save', { location: 'attached', board, revision: 'a'.repeat(64) })).result.ok, true);
  assert.deepEqual(f.calls.map(call => call.body.params), [{ location: 'attached', board, revision: null }, { location: 'attached', board, revision: 'a'.repeat(64) }]);
  for (const [method, params] of [
    ['blueprint.save', { location: 'attached', id: 'board', text: '{}', expectedRevision: null }],
    ['blueprint.save', { location: 'attached', board, expectedRevision: null }],
    ['blueprint.asset', { location: 'attached', id: 'image.png' }],
    ['blueprint.upload', { location: 'attached', mime: 'image/png', bytes: [1] }],
    ['blueprint.upload', { location: 'attached', type: 'image/png', base64: 'AQI=' }],
  ]) assert.deepEqual(await f.host.call(f.event(), method, params), { error: { code: 'invalid' } }, method);
  assert.equal(f.calls.length, 2);
  assert.equal((await f.host.call(f.event(), 'blueprint.locations', {})).result.ok, true);
});

test('Void files carry the live app keys: bytes in as base64, bytes out as data, null data removes, attribution is the unit', async t => {
  const f = fixture(t, { response: { data: { path: 'note.md', base64: 'AQI=', revision: 'rev' } } }); f.update('void');
  const read = (await f.host.call(f.event(), 'void.files.read', { path: 'note.md' })).result;
  assert.deepEqual([...new Uint8Array(read.data)], [1, 2]);
  assert.deepEqual([Object.hasOwn(read, 'base64'), read.revision], [false, 'rev']);
  await f.host.call(f.event(), 'void.files.list', { path: '' });
  await f.host.call(f.event(), 'void.files.write', { path: 'note.md', data: new Uint8Array([1, 2]), expected: '' });
  await f.host.call(f.event(), 'void.files.write', { path: 'note.md', data: new Uint8Array(0) });
  await f.host.call(f.event(), 'void.files.write', { path: '.void/trash.json', data: null, expected: 'a'.repeat(64) });
  await f.host.call(f.event(), 'void.storage.save', { key: 'state', value: { tab: 1 } });
  assert.deepEqual(f.calls.map(call => call.body.params), [
    { path: 'note.md' }, { path: '' }, { path: 'note.md', expected: '', base64: 'AQI=' }, { path: 'note.md', base64: '' },
    { path: '.void/trash.json', expected: 'a'.repeat(64), remove: true }, { key: 'state', value: { tab: 1 } },
  ]);
  for (const [method, params] of [
    ['void.files.write', { path: 'note.md', expected: '' }],
    ['void.files.write', { path: 'note.md', text: 'x', expectedRevision: null }],
    ['void.files.write', { path: 'note.md', data: 'text' }],
    ['void.files.write', { path: 'note.md', data: new Uint8Array(16_000_001) }],
    ['void.storage.save', { key: 'state', value: 1, expectedRevision: null }],
  ]) assert.deepEqual(await f.host.call(f.event(), method, params), { error: { code: 'invalid' } }, method);
  assert.equal(f.calls.length, 6);
  const attributed = fixture(t, { response: { data: { path: 'note.md', by: 'project:shop:executor' } } }); attributed.update('void');
  assert.equal((await attributed.host.call(attributed.event(), 'void.files.attribution', { path: 'note.md' })).result, 'project:shop:executor');
  const unknown = fixture(t, { response: { data: { path: 'note.md', by: null } } }); unknown.update('void');
  assert.equal((await unknown.host.call(unknown.event(), 'void.files.attribution', { path: 'note.md' })).result, null);
});

test('stage bounds, mode, locale and colour roles update native views and host events', t => {
  const f = fixture(t); f.update('blueprint'); const blueprint = f.views[0];
  assert.deepEqual(blueprint.bounds, { x: 20, y: 40, width: 700, height: 600 }); assert.equal(blueprint.visible, true);
  f.update('void'); assert.equal(blueprint.visible, false); assert.equal(f.views[1].visible, true);
  f.window.size = [600, 400]; f.window.emit('resize'); assert.deepEqual(f.views[1].bounds, { x: 20, y: 40, width: 580, height: 360 });
  f.update(null, { locale: 'es', tokens: { surface: '#abcdef' } }); assert.equal(f.views[1].visible, false);
  assert.deepEqual(blueprint.events.at(-2), { channel: 'cosmic:bridge-event', name: 'host.locale', params: { locale: 'es' } });
  assert.deepEqual(blueprint.events.at(-1).params, { tokens: { surface: '#abcdef' } });
});

test('service events filter the app own saves and never cross app scopes', t => {
  const f = fixture(t); f.update('blueprint'); f.update('void'); for (const view of f.views) view.events.length = 0;
  const frame = data => ({ name: 'app.bridge', envelope: { data } });
  f.host.event(frame({ app: 'blueprint', name: 'blueprint.changed', params: { location: '/attached', id: 'one' }, clientId: f.host.clientId }));
  assert.equal(f.views[0].events.length, 0);
  f.host.event(frame({ app: 'blueprint', name: 'blueprint.changed', params: { id: 'one' }, clientId: 'other-host' }));
  assert.equal(f.views[0].events.length, 1); assert.equal(f.views[1].events.length, 0);
  f.host.event(frame({ name: 'agents.changed', params: { location: '/attached' } })); assert.equal(f.views[0].events.length, 2); assert.equal(f.views[1].events.length, 1);
  f.host.event(frame({ name: 'host.tokens', params: { tokens: { injected: true } } })); assert.equal(f.views[1].events.length, 1);
});

test('sign out hides both views, revokes the credential, and a changed project reaches Void', async t => {
  const f = fixture(t); f.update('void');
  f.update('void', { project: '/attached/second' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.at(-1).body.method, 'void.open.switchTo');
  assert.deepEqual(f.calls.at(-1).body.params, { location: '/attached/second' });
  f.host.update({ app: null });
  assert.equal(f.views[0].visible, false);
  assert.deepEqual(await f.host.call(f.event(), 'void.files.list', {}), { error: { code: 'unavailable' } });
});

test('the host delivers its project selection locally after service success without echoing app switches', async t => {
  const project = { id: 'second', name: 'Second', path: '/attached/second' };
  const f = fixture(t, { response: { data: project } }); f.update('void');
  f.views[0].events.length = 0;
  f.update('void', { project: project.path });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.views[0].events, [{ channel: 'cosmic:bridge-event', name: 'void.project', params: project }]);
  f.views[0].events.length = 0;
  await f.host.call(f.event(), 'void.open.switchTo', { location: project.path });
  f.host.event({ name: 'app.bridge', envelope: { data: { app: 'void', name: 'void.project', params: project, clientId: f.host.clientId } } });
  assert.equal(f.views[0].events.length, 0);
});

test('loaded apps renew a bounded observer lease while hidden and release it on signout or disposal', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const f = fixture(t); f.update('blueprint'); f.update('void', { project: '/attached' });
  assert.deepEqual(f.activities.at(-1)?.body, { clientId: f.host.clientId, apps: ['blueprint', 'void'], location: '/attached' });
  assert.equal(f.activities.at(-1).headers['Idempotency-Key'], undefined);
  f.update(null, { project: '/attached' });
  const before = f.activities.length;
  t.mock.timers.tick(30_000);
  assert.equal(f.activities.length, before + 1);
  assert.deepEqual(f.activities.at(-1).body.apps, ['blueprint', 'void']);
  f.host.update({ app: null });
  assert.deepEqual(f.activities.at(-1).body.apps, []);
  f.update('void'); f.host.dispose();
  assert.deepEqual(f.activities.at(-1).body.apps, []);
  const disposed = f.activities.length;
  t.mock.timers.tick(90_000);
  assert.equal(f.activities.length, disposed);
});

test('window close asks both loaded apps to save, accepts app.saved, and has a bounded timeout', async t => {
  const f = fixture(t); f.update('blueprint'); f.update('void');
  const saving = f.host.saveBeforeClose();
  for (const view of f.views) assert.equal(view.events.at(-1).name, 'app.save');
  assert.deepEqual(await f.host.call(f.event(f.views[0]), 'app.saved', { state: 'saved' }), { result: { saved: true } });
  await saving;
  f.host.dispose(); assert.equal(f.views.every(view => view.closed), true);
});

test('a failed first network load reports unavailable and a later mode entry can retry', async t => {
  const f = fixture(t, { loadFail: true }); f.update('blueprint'); await Promise.resolve();
  assert.equal(f.statuses.at(-1).state, 'unavailable'); assert.equal(f.views[0].visible, false);
  f.update('blueprint'); assert.equal(f.statuses.at(-1).state, 'loading');
  await Promise.resolve();
});

test('Void native pick sends only the selected path for service confinement and export uses a picker', async t => {
  const f = fixture(t); f.update('void');
  await f.host.call(f.event(), 'void.open.pick', { path: '/app-chosen/forbidden' });
  assert.deepEqual(f.calls[0].body.params, { path: '/attached/docs/note.md' });
  assert.deepEqual(await f.host.call(f.event(), 'void.export.save', { name: '../../document.md', text: 'Document' }), { result: { saved: true, name: 'export.md' } });
  assert.deepEqual(f.writes, [{ target: '/chosen/export.md', text: 'Document' }]);
  assert.deepEqual(await f.host.call(f.event(), 'void.export.save', { bytes: [256] }), { error: { code: 'invalid' } });
});

test('large canonical base64 exports stay within bounds without regex recursion and oversized uploads stop before HTTP', async t => {
  const f = fixture(t); f.update('void');
  const base64 = Buffer.alloc(1_100_000, 65).toString('base64');
  assert.equal((await f.host.call(f.event(), 'void.export.save', { base64 })).result.saved, true);
  assert.equal(f.writes[0].text.length, 1_100_000);
  assert.deepEqual(await f.host.call(f.event(), 'void.export.save', { base64: 'AA=A' }), { error: { code: 'invalid' } });
  f.update('blueprint');
  assert.deepEqual(await f.host.call(f.event(), 'blueprint.upload', { bytes: new Uint8Array(10_000_001) }), { error: { code: 'invalid' } });
  assert.equal(f.calls.length, 0);
});

test('raw binary limits reject reads, document writes and exports before byte iteration or HTTP', async t => {
  const f = fixture(t); f.update('void');
  const bytes = new ArrayBuffer(32 * 1024 * 1024 + 1);
  let iterations = 0;
  t.mock.method(Uint8Array.prototype, Symbol.iterator, () => { iterations++; throw new Error('Binary input was expanded.'); });
  const results = [];
  for (const [method, params] of [
    ['void.files.read', { path: 'note.md', ignored: { bytes } }],
    ['void.files.read', { path: 'note.md', location: { bytes } }],
    ['void.files.write', { path: 'note.md', data: bytes, expected: '' }],
    ['void.storage.save', { key: 'state', value: { ignored: bytes } }],
    ['void.export.save', { bytes }],
  ]) results.push([method, await f.host.call(f.event(), method, params)]);
  assert.deepEqual(results.map(([method, result]) => [method, result.error?.code]), [
    ['void.files.read', 'invalid'], ['void.files.read', 'invalid'], ['void.files.write', 'invalid'], ['void.storage.save', 'invalid'], ['void.export.save', 'invalid'],
  ]);
  assert.equal(iterations, 0);
  assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0);
});

test('typed-array uploads and native binary exports do not expand bytes into arrays', async t => {
  const bytes = new Uint8Array([9, 1, 2, 9]).subarray(1, 3);
  let written;
  const f = fixture(t, { writeFileImpl: async (_target, value) => { written = value; } }); f.update('blueprint');
  t.mock.method(Uint8Array.prototype, Symbol.iterator, () => { throw new Error('Binary input was expanded.'); });
  assert.deepEqual(await f.host.call(f.event(), 'blueprint.upload', { bytes }), { result: { person: { name: 'Tom' }, ok: true } });
  assert.deepEqual(f.calls[0].body.params, { base64: 'AQI=' });
  f.update('void');
  assert.equal((await f.host.call(f.event(), 'void.export.save', { bytes })).result.saved, true);
  assert.equal(written.toString(), '\x01\x02');
  assert.equal(written.buffer, bytes.buffer);
  assert.equal(written.byteOffset, bytes.byteOffset);
});

test('raw text, structure and agent input limits stop before service serialization', async t => {
  const f = fixture(t); f.update('void');
  const inputs = [
    ['void.files.read', { path: 'x'.repeat(70_000) }],
    ['void.files.write', { path: 'note.md', data: new Uint8Array(16_000_001) }],
    ['void.storage.save', { key: 'state', value: 'é'.repeat(8_000_001) }],
    ['agents.send', { location: '/attached', body: 'é'.repeat(8193) }],
    ['void.storage.save', { key: 'state', value: Array.from({ length: 100_001 }, () => null) }],
    ['void.storage.save', { key: 'state', value: Array.from({ length: 33 }).reduce(value => ({ value }), null) }],
  ];
  for (const [method, params] of inputs) assert.deepEqual(await f.host.call(f.event(), method, params), { error: { code: 'invalid' } }, method);
  assert.equal(f.calls.length, 0);
});

test('remote preload relays only the method/event surface, unwraps errors, and unsubscribes', async () => {
  const source = await readFile(new URL('../gui/app-preload.cjs', import.meta.url), 'utf8');
  const listeners = new Map(), calls = []; let bridge;
  const window = {}; window.top = window;
  const ipcRenderer = { async invoke(channel, method, params) { calls.push({ channel, method, params }); return method === 'blueprint.read' ? { error: { code: 'not_found' } } : { result: { ok: true } }; }, on(name, listener) { listeners.set(name, listener); }, removeListener(name) { listeners.delete(name); } };
  vm.runInNewContext(source, { window, require: () => ({ contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'cosmicBridge'); bridge = value; } }, ipcRenderer }) });
  assert.equal(bridge.protocol, 1); assert.deepEqual(Object.keys(bridge), ['protocol', 'call', 'on']);
  assert.equal((await bridge.call('blueprint.list', {})).ok, true);
  await assert.rejects(bridge.call('blueprint.read', {}), error => error.code === 'not_found');
  await assert.rejects(bridge.call('shell.open', {}), error => error.code === 'invalid');
  assert.equal(calls.length, 2);
  let received; const stop = bridge.on('host.locale', params => { received = params; });
  listeners.get('cosmic:bridge-event')({ sender: 'secret' }, { name: 'host.locale', params: { locale: 'es' } }); assert.deepEqual(received, { locale: 'es' }); stop(); assert.equal(listeners.size, 0);
});
