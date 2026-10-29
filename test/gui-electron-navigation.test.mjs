import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import test from 'node:test';
import { startElectronApp } from '../gui/electron.mjs';

async function fixture(t) {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ data: {} })));
  const handlers = new Map(), views = [];
  let window;
  const viewerUrl = 'http://127.0.0.1:41234/gui/viewer/';
  const contents = () => Object.assign(new EventEmitter(), {
    mainFrame: { url: '' }, send() {}, setWindowOpenHandler() {}, isDestroyed: () => false, close() {},
  });
  class Window extends EventEmitter {
    constructor() { super(); window = this; this.webContents = contents(); this.contentView = { addChildView() {}, removeChildView() {} }; }
    isDestroyed() { return false; }
    isVisible() { return false; }
    isMinimized() { return false; }
    getContentSize() { return [1000, 700]; }
    show() {}
    async loadURL(url) { this.webContents.mainFrame.url = url; }
  }
  class View {
    constructor() {
      views.push(this); this.webContents = contents();
      this.webContents.loadURL = async url => { this.webContents.mainFrame.url = url; this.webContents.emit('did-finish-load'); };
    }
    setVisible(value) { this.visible = value; }
    setBounds() {}
  }
  const app = Object.assign(new EventEmitter(), {
    getPath: () => path.resolve('.tmp/electron-navigation'), getAppPath: () => path.resolve('.'),
    setPath() {}, getVersion: () => '3.0.0', requestSingleInstanceLock: () => true, async whenReady() {}, quit() {},
  });
  const permissions = () => Object.assign(new EventEmitter(), { setPermissionCheckHandler() {}, setPermissionRequestHandler() {} });
  await startElectronApp({ app, BrowserWindow: Window, WebContentsView: View, ipcMain: { handle: (name, handler) => handlers.set(name, handler), on() {} },
    session: { defaultSession: permissions(), fromPartition: permissions }, shell: {}, dialog: {},
  }, ['--user-data-dir', path.resolve('.tmp/electron-navigation')], {
    async startConfiguredViewer() { return { viewerUrl }; },
    async createWizardServer({ sessionOptions }) { await sessionOptions.serviceStart({}); return { origin: 'http://127.0.0.1:41235', url: 'http://127.0.0.1:41235/' }; },
  });
  t.after(() => window.emit('closed'));
  await window.loadURL(viewerUrl);
  const event = () => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  handlers.get('hivem1nd:embedded-update')(event(), { app: 'blueprint', bounds: { x: 0, y: 0, width: 700, height: 600 }, locale: 'en', token: 'viewer-secret' });
  const call = () => handlers.get('cosmic:bridge-call')({ sender: views[0].webContents, senderFrame: views[0].webContents.mainFrame }, 'blueprint.locations', {});
  return { window, viewerUrl, call };
}

test('the viewer boot replaceState preserves its app bridge credential', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.call(), { result: {} });
  f.window.webContents.emit('did-start-navigation', {}, f.viewerUrl, true, true);
  assert.deepEqual(await f.call(), { result: {} });
});

test('viewer cross-document navigation and foreign same-document targets revoke the credential', async t => {
  for (const [url, sameDocument] of [['http://127.0.0.1:41234/gui/viewer/', false], ['https://evil.test/gui/viewer/', true]]) {
    const f = await fixture(t);
    f.window.webContents.emit('did-start-navigation', {}, url, sameDocument, true);
    assert.deepEqual(await f.call(), { error: { code: 'unavailable' } });
  }
});
