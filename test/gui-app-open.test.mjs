import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { APP_TARGETS, blueprintOpenUrl, createEmbeddedApps } from '../gui/app-bridge.mjs';
import { secureWebPreferences } from '../gui/electron-preferences.mjs';
import { embeddedOpenMode } from '../gui/app/embedded-apps.mjs';

function fixture(t, { focused = false } = {}) {
  const views = [], calls = [], raised = [];
  const window = Object.assign(new EventEmitter(), {
    size: [1000, 700], flashes: 0,
    isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, isFocused: () => focused, getContentSize() { return this.size; },
    flashFrame(value) { this.flashes += value ? 1 : 0; },
    show: () => raised.push('show'), focus: () => raised.push('focus'), restore: () => raised.push('restore'), moveTop: () => raised.push('moveTop'),
    webContents: { send() {} }, contentView: { addChildView() {}, removeChildView() {} },
  });
  class View {
    constructor() {
      this.loads = []; this.events = []; views.push(this);
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: '' }, isDestroyed: () => false, send: (channel, envelope) => this.events.push({ channel, ...envelope }),
        setWindowOpenHandler() {}, close() {}, focus: () => raised.push('contents.focus'),
        loadURL: async url => { this.loads.push(url); this.webContents.mainFrame.url = url; this.webContents.emit('did-finish-load'); },
      });
    }
    setVisible() {} setBounds() {}
  }
  const session = { fromPartition: () => Object.assign(new EventEmitter(), { setPermissionCheckHandler() {}, setPermissionRequestHandler() {} }) };
  const host = createEmbeddedApps({ window, WebContentsView: View, session, secureWebPreferences, preload: '/host/app-preload.cjs', hostVersion: '3.0.0',
    serviceOrigin: () => 'http://127.0.0.1:41234', shell: { async openExternal() {} }, dialog: {},
    fetchImpl: async (url, init) => { if (!url.endsWith('/activity')) calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ data: { id: 'shop', name: 'shop', path: '/shop' } })); } });
  t.after(() => host.dispose());
  const update = app => host.update({ app, bounds: { x: 0, y: 40, width: 700, height: 600 }, locale: 'en', tokens: {}, token: 'viewer-secret' });
  const open = (app, params) => host.event({ name: 'app.bridge', envelope: { data: { app, name: 'app.open', params } } });
  return { host, views, calls, raised, window, update, open };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test('the Blueprint route carries the board id and the location id, both encoded', () => {
  assert.equal(blueprintOpenUrl({ location: 'shop', id: 'home' }), 'https://blueprint.txmska.com/review/home?folder=shop&host=ONEM1ND');
  assert.equal(blueprintOpenUrl({ location: 'my shop/x', id: 'a b' }), 'https://blueprint.txmska.com/review/a%20b?folder=my%20shop%2Fx&host=ONEM1ND');
});

test('a loaded Blueprint view loads the board route without raising the window', async t => {
  const f = fixture(t); f.update('blueprint');
  const view = f.views[0];
  f.open('blueprint', { location: 'shop', id: 'home' });
  assert.equal(view.loads.at(-1), 'https://blueprint.txmska.com/review/home?folder=shop&host=ONEM1ND');
  assert.equal(new URL(view.loads.at(-1)).origin, APP_TARGETS.blueprint.origin);
  assert.deepEqual(f.raised, []);
  assert.equal(f.window.flashes, 1);
});

test('a board requested before the Blueprint view exists is the first page it loads', async t => {
  const f = fixture(t);
  f.open('blueprint', { location: 'shop', id: 'home' });
  f.update('blueprint');
  assert.deepEqual(f.views[0].loads, ['https://blueprint.txmska.com/review/home?folder=shop&host=ONEM1ND']);
  assert.deepEqual(f.raised, []);
});

test('a text selects its project and sends void.project once the Void view is loaded', async t => {
  const f = fixture(t);
  f.open('void', { project: { id: 'shop', name: 'shop', path: '/shop' }, path: 'docs/guide.json' });
  await settle();
  assert.deepEqual(f.calls, []);
  f.update('void');
  await settle();
  assert.deepEqual(f.calls.at(-1), { app: 'void', method: 'void.open.switchTo', params: { location: 'shop' }, clientId: f.host.clientId });
  assert.deepEqual(f.views[0].events.at(-1), { channel: 'cosmic:bridge-event', name: 'void.project', params: { id: 'shop', name: 'shop', path: '/shop' } });
  f.open('void', { project: { id: 'shop', name: 'shop', path: '/shop' }, path: 'notes.md' });
  await settle();
  assert.equal(f.calls.filter(call => call.method === 'void.open.switchTo').length, 2);
  assert.deepEqual(f.raised, []);
});

test('a focused window gets no notice and malformed open events are ignored', async t => {
  const f = fixture(t, { focused: true }); f.update('blueprint');
  f.open('blueprint', { location: 'shop', id: 'home' });
  assert.equal(f.window.flashes, 0);
  const loads = f.views[0].loads.length;
  for (const params of [null, {}, { id: 1, location: 'shop' }, { id: 'home' }]) f.open('blueprint', params);
  f.open('void', { project: {}, path: 'x.md' });
  f.open('other', { id: 'home', location: 'shop' });
  assert.equal(f.views[0].loads.length, loads);
});

test('the window switches to the app only when it can embed it', () => {
  const embedded = { layout: 'desktop', root: { ownerDocument: {} }, embeddedHost: { embeddedUpdate() {} } };
  const event = app => ({ name: 'app.bridge', envelope: { data: { app, name: 'app.open', params: {} } } });
  assert.equal(embeddedOpenMode(embedded, event('blueprint')), 'blueprint');
  assert.equal(embeddedOpenMode(embedded, event('void')), 'document');
  assert.equal(embeddedOpenMode(embedded, event('other')), null);
  assert.equal(embeddedOpenMode({ ...embedded, layout: 'phone' }, event('void')), null);
  assert.equal(embeddedOpenMode({ ...embedded, embeddedHost: {} }, event('void')), null);
  assert.equal(embeddedOpenMode(embedded, { name: 'app.bridge', envelope: { data: { app: 'void', name: 'void.project' } } }), null);
});
