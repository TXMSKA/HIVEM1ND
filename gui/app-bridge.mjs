import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export const APP_TARGETS = Object.freeze({
  blueprint: Object.freeze({ origin: 'https://blueprint.txmska.com', url: 'https://blueprint.txmska.com/files?host=ONEM1ND' }),
  void: Object.freeze({ origin: 'https://void.txmska.com', url: 'https://void.txmska.com/?host=ONEM1ND' }),
});

const sharedMethods = ['hello', 'app.saved', 'agents.list', 'agents.send'];
export const APP_METHODS = Object.freeze({
  blueprint: Object.freeze([...sharedMethods, 'blueprint.locations', 'blueprint.list', 'blueprint.read', 'blueprint.save', 'blueprint.asset', 'blueprint.upload']),
  void: Object.freeze([...sharedMethods, 'void.files.list', 'void.files.read', 'void.files.write', 'void.files.url', 'void.files.asset', 'void.files.attribution', 'void.storage.load', 'void.storage.save', 'void.open.pick', 'void.open.switchTo', 'void.export.save', 'void.export.pdf', 'void.project']),
});
const errors = new Set(['not_found', 'conflict', 'invalid', 'denied', 'unavailable', 'no_agent']);
const events = new Set(['host.visible', 'host.locale', 'host.tokens', 'agents.changed', 'app.save', 'blueprint.changed', 'blueprint.locations', 'void.files.changed', 'void.project']);
const clipboardPermissions = new Set(['clipboard-read', 'clipboard-sanitized-write', 'clipboard-write', 'deprecated-sync-clipboard-read']);
const fail = code => { throw { code }; };
const errorResult = error => ({ error: { code: errors.has(error?.code) ? error.code : 'unavailable' } });

// The route that shows one board; the folder is the location id the bridge lists in blueprint.locations.
export function blueprintOpenUrl({ location, id }) {
  return `${APP_TARGETS.blueprint.origin}/review/${encodeURIComponent(id)}?folder=${encodeURIComponent(location)}&host=ONEM1ND`;
}

export function appOrigin(app, value) {
  try {
    const url = new URL(value);
    return !!APP_TARGETS[app] && url.origin === APP_TARGETS[app].origin && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function appMethodAllowed(app, method) {
  return typeof method === 'string' && APP_METHODS[app]?.includes(method) === true;
}

const parameterKeys = {
  hello: ['app', 'appVersion', 'protocol', 'project', 'location'], 'app.saved': ['state'], 'agents.list': ['location'],
  'agents.send': ['location', 'kind', 'to', 'document', 'threadId', 'subject', 'body', 'attachment'],
  'blueprint.locations': [], 'blueprint.list': ['location'], 'blueprint.read': ['location', 'id'],
  'blueprint.save': ['location', 'id', 'text', 'content', 'document', 'expectedRevision'],
  'blueprint.asset': ['location', 'id', 'path'], 'blueprint.upload': ['location', 'bytes', 'base64', 'mime', 'contentType', 'expectedRevision'],
  'void.files.list': ['location'], 'void.files.read': ['path', 'location'],
  'void.files.write': ['path', 'location', 'text', 'content', 'document', 'expectedRevision'],
  'void.files.url': ['path', 'location'], 'void.files.asset': ['path', 'location'], 'void.files.attribution': ['path', 'location'],
  'void.storage.load': ['key', 'location'], 'void.storage.save': ['key', 'location', 'value', 'expectedRevision'],
  'void.open.pick': ['path', 'location', 'project'], 'void.open.switchTo': ['path', 'location', 'project'],
  'void.export.save': ['name', 'text', 'bytes', 'base64'], 'void.export.pdf': ['name', 'text', 'bytes', 'base64'], 'void.project': [],
};

function validateJson(value, limit, maxEntries = 100_000) {
  let remaining = limit, entries = maxEntries;
  const ancestors = new Set();
  const consume = size => { remaining -= size; if (remaining < 0) fail('invalid'); };
  const string = text => {
    consume(Buffer.byteLength(text) + 2);
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) consume(1);
      else if (code < 32) consume(5);
      else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) index++;
      else if (code >= 0xd800 && code <= 0xdfff) consume(3);
    }
  };
  const visit = (item, depth) => {
    if (--entries < 0 || depth > 32) fail('invalid');
    if (typeof item === 'string') return string(item);
    if (item === null || typeof item === 'boolean') return consume(item === null ? 4 : item ? 4 : 5);
    if (typeof item === 'number' && Number.isFinite(item)) return consume(String(item).length);
    if (!item || typeof item !== 'object' || item instanceof ArrayBuffer || ArrayBuffer.isView(item) || ancestors.has(item)) fail('invalid');
    const array = Array.isArray(item);
    if (array ? item.length > entries : Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) fail('invalid');
    ancestors.add(item); consume(2);
    if (array) for (let index = 0; index < item.length; index++) { consume(1); visit(item[index], depth + 1); }
    else for (const key in item) {
      if (!Object.hasOwn(item, key)) continue;
      string(key); consume(2); visit(item[key], depth + 1);
    }
    ancestors.delete(item);
  };
  visit(value, 0);
  return limit - remaining;
}

function validateBinary(value, limit) {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    if (value.byteLength > limit) fail('invalid');
    return;
  }
  if (!Array.isArray(value) || value.length > limit) fail('invalid');
  for (let index = 0; index < value.length; index++) if (!Number.isInteger(value[index]) || value[index] < 0 || value[index] > 255) fail('invalid');
}

function binaryBuffer(value, limit) {
  validateBinary(value, limit);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return Buffer.from(value);
}

function validateParams(method, params) {
  if (!params || typeof params !== 'object' || Array.isArray(params) || Object.getPrototypeOf(params) !== Object.prototype && Object.getPrototypeOf(params) !== null) fail('invalid');
  const exporting = method.startsWith('void.export.');
  const binaryLimit = method === 'blueprint.upload' ? 10_000_000 : exporting ? 32 * 1024 * 1024 : 0;
  if (params.bytes !== undefined) {
    if (!binaryLimit) fail('invalid');
    // Check the IPC allocation before inspecting or converting any other input.
    const length = params.bytes instanceof ArrayBuffer || ArrayBuffer.isView(params.bytes) ? params.bytes.byteLength : params.bytes?.length;
    if (!Number.isInteger(length) || length > binaryLimit) fail('invalid');
  }
  const document = ['blueprint.save', 'void.files.write', 'void.storage.save'].includes(method);
  const smallLimit = method === 'agents.send' ? 32 * 1024 : 64 * 1024;
  let smallSize = 2;
  for (const key in params) {
    if (!Object.hasOwn(params, key)) continue;
    if (!parameterKeys[method].includes(key)) fail('invalid');
    if (key === 'bytes') { validateBinary(params.bytes, binaryLimit); continue; }
    if (key === 'base64' && binaryLimit) {
      if (typeof params.base64 !== 'string' || params.base64.length > Math.ceil(binaryLimit / 3) * 4) fail('invalid');
      continue;
    }
    if ((document && ['text', 'content', 'document', 'value'].includes(key)) || exporting && key === 'text') {
      const limit = exporting ? 32 * 1024 * 1024 : 16_000_000;
      if (['text', 'content'].includes(key)) {
        if (typeof params[key] !== 'string' || Buffer.byteLength(params[key]) > limit) fail('invalid');
      } else validateJson(params[key], limit);
      continue;
    }
    if (method === 'agents.send' && key === 'body' && (typeof params.body !== 'string' || Buffer.byteLength(params.body) > 16 * 1024)) fail('invalid');
    smallSize += Buffer.byteLength(key) + 4 + validateJson(params[key], smallLimit, 1000);
    if (smallSize > smallLimit) fail('invalid');
  }
}

function serviceParams(params) {
  if (params.bytes === undefined) return params;
  const { bytes, ...rest } = params;
  return { ...rest, base64: binaryBuffer(bytes, 10_000_000).toString('base64') };
}

function boundsInWindow(bounds, window) {
  const [width, height] = window.getContentSize();
  const x = Math.min(width, Math.max(0, Math.round(bounds.x)));
  const y = Math.min(height, Math.max(0, Math.round(bounds.y)));
  return { x, y, width: Math.min(width - x, Math.max(0, Math.round(bounds.width))), height: Math.min(height - y, Math.max(0, Math.round(bounds.height))) };
}

export function createEmbeddedApps({ window, WebContentsView, session, shell, dialog, preload, secureWebPreferences, serviceOrigin, hostVersion, fetchImpl = fetch, writeFileImpl = writeFile, saveTimeout = 1500 }) {
  const clientId = randomUUID();
  const records = new Map();
  let active = null;
  let token;
  let project;
  let locale = 'en';
  let tokens = {};
  let bounds = { x: 0, y: 0, width: 0, height: 0 };
  let disposed = false;
  let closePending;
  let selectionPending = Promise.resolve();
  let activitySignature;
  let pendingBoard = null;
  let pendingText = null;

  const activity = ({ empty = false, force = false } = {}) => {
    const origin = serviceOrigin();
    if (!token || disposed || !origin) return;
    const body = JSON.stringify({ clientId, apps: empty ? [] : [...records.values()].filter(record => record.loaded).map(record => record.app), ...(!empty && project ? { location: project } : {}) });
    const signature = `${token}\n${body}`;
    if (!force && activitySignature === signature) return;
    activitySignature = signature;
    try {
      Promise.resolve(fetchImpl(`${origin}/api/v1/app-bridge/activity`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { 'content-type': 'application/json', Origin: origin, Authorization: `Bearer ${token}` }, body,
      })).then(response => response.body?.cancel()).catch(() => {});
    } catch { /* Observer leases expire when the local service cannot be reached. */ }
  };
  const activityTimer = setInterval(() => activity({ force: true }), 30_000);
  activityTimer.unref?.();

  const send = (record, name, params) => {
    if (!record.loaded || record.view.webContents.isDestroyed() || !appOrigin(record.app, record.view.webContents.mainFrame.url)) return;
    record.view.webContents.send('cosmic:bridge-event', { name, params });
  };
  const status = (record, state) => {
    record.state = state;
    if (!window.isDestroyed()) window.webContents.send('hivem1nd:embedded-status', { app: record.app, state });
  };
  const layout = () => {
    if (disposed || window.isDestroyed()) return;
    const visible = window.isVisible() && !window.isMinimized();
    for (const record of records.values()) {
      const nextBounds = boundsInWindow(bounds, window);
      record.view.setBounds(nextBounds);
      record.view.setVisible(active === record.app && record.state === 'ready' && nextBounds.width > 0 && nextBounds.height > 0);
      const shown = active === record.app && visible && nextBounds.width > 0 && nextBounds.height > 0;
      if (shown !== record.visible) { record.visible = shown; send(record, 'host.visible', { visible: shown }); }
    }
  };
  const openExternal = value => {
    try {
      const url = new URL(value);
      if (url.href.length > 2048 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
      Promise.resolve(shell.openExternal(url.href)).catch(() => {});
    } catch { /* An invalid or privileged URL never leaves the view. */ }
  };
  // The person's window is never raised for an agent's request; a window that is hidden or not in front only flashes.
  const notice = () => {
    try { if (!window.isDestroyed() && (!window.isVisible() || window.isMinimized() || !window.isFocused())) window.flashFrame?.(true); } catch { /* A notice is optional. */ }
  };
  // The service already stored the position; the project event makes Void read it again.
  const showText = () => {
    const open = pendingText, record = records.get('void');
    if (!open || !record?.loaded) return;
    pendingText = null;
    selectionPending = selectionPending.then(async () => {
      if (disposed) return;
      const selected = await serviceCall('void', 'void.open.switchTo', { location: open.project.id });
      if (!disposed && record.loaded) send(record, 'void.project', selected);
    }).catch(() => {});
  };
  const showBoard = () => {
    const open = pendingBoard, record = records.get('blueprint');
    if (!open || !record) return;
    pendingBoard = null;
    status(record, 'loading');
    Promise.resolve(record.view.webContents.loadURL(blueprintOpenUrl(open))).catch(() => { if (disposed) return; record.loaded = false; status(record, 'unavailable'); layout(); activity(); });
  };
  const makeRecord = app => {
    const partition = `persist:app-${app}`;
    const appSession = session.fromPartition(partition);
    const view = new WebContentsView({ webPreferences: { ...secureWebPreferences, partition, preload } });
    const record = { app, view, loaded: false, visible: false, state: 'idle', saved: null };
    const permission = (contents, name, origin) => contents === view.webContents && clipboardPermissions.has(name) && appOrigin(app, origin) && appOrigin(app, contents.mainFrame.url);
    appSession.setPermissionCheckHandler((contents, name, origin) => permission(contents, name, origin));
    appSession.setPermissionRequestHandler((contents, name, callback, details) => callback(permission(contents, name, details.requestingUrl ?? details.securityOrigin)));
    // Downloads must go through the native export picker rather than silently writing the app's chosen path.
    const preventDownload = event => event.preventDefault();
    appSession.on('will-download', preventDownload);
    record.cleanup = () => {
      appSession.removeListener('will-download', preventDownload);
      appSession.setPermissionCheckHandler(() => false);
      appSession.setPermissionRequestHandler((_contents, _name, callback) => callback(false));
    };
    view.setVisible(false);
    window.contentView.addChildView(view);
    const contents = view.webContents;
    contents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
    contents.on('will-attach-webview', event => event.preventDefault());
    const navigation = (event, value) => {
      const target = event.url ?? value;
      if (appOrigin(app, target)) return;
      event.preventDefault();
      if (event.isMainFrame !== false) openExternal(target);
    };
    contents.on('will-navigate', navigation);
    contents.on('will-frame-navigate', navigation);
    contents.on('will-redirect', navigation);
    contents.on('did-start-navigation', (_event, url, sameDocument, mainFrame) => {
      if (mainFrame === false) return;
      if (sameDocument && appOrigin(app, url)) return;
      record.loaded = false;
      status(record, 'loading');
      layout();
      activity();
    });
    contents.on('did-finish-load', () => {
      if (!appOrigin(app, contents.mainFrame.url)) { status(record, 'unavailable'); layout(); return; }
      record.loaded = true;
      status(record, 'ready');
      layout();
      send(record, 'host.visible', { visible: record.visible });
      send(record, 'host.locale', { locale });
      send(record, 'host.tokens', { tokens });
      activity();
      if (app === 'void') showText();
    });
    contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (mainFrame === false || code === -3) return;
      record.loaded = false;
      status(record, 'unavailable');
      layout();
      activity();
    });
    contents.on('render-process-gone', () => { record.loaded = false; status(record, 'unavailable'); layout(); activity(); });
    records.set(app, record);
    return record;
  };
  for (const name of ['resize', 'show', 'hide', 'minimize', 'restore']) window.on(name, layout);

  const serviceCall = async (app, method, params) => {
    if (!token || disposed) fail('unavailable');
    const origin = serviceOrigin();
    if (!origin) fail('unavailable');
    const response = await fetchImpl(`${origin}/api/v1/app-bridge/call`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(method === 'hello' ? 2500 : 30_000),
      headers: { 'content-type': 'application/json', Origin: origin, Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ app, method, params: serviceParams(params), clientId }),
    });
    const envelope = await response.json();
    if (!response.ok || envelope.error) fail(errors.has(envelope.error?.code) ? envelope.error.code : 'unavailable');
    const result = envelope.data;
    if (['blueprint.asset', 'void.files.asset'].includes(method) && typeof result?.base64 === 'string') {
      const bytes = Buffer.from(result.base64, 'base64');
      return { ...result, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    }
    return result;
  };
  const exportFile = async (record, method, params) => {
    if (!params || typeof params !== 'object' || Array.isArray(params)) fail('invalid');
    const name = typeof params.name === 'string' && params.name.length <= 255 ? path.basename(params.name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') : method === 'void.export.pdf' ? 'document.pdf' : 'document.md';
    let bytes;
    if (params.bytes !== undefined) {
      bytes = binaryBuffer(params.bytes, 32 * 1024 * 1024);
    } else if (typeof params.base64 === 'string') {
      if (params.base64.length > 45 * 1024 * 1024 || /[^A-Za-z0-9+/=]/.test(params.base64)) fail('invalid');
      bytes = Buffer.from(params.base64, 'base64');
      if (bytes.toString('base64') !== params.base64) fail('invalid');
    } else if (typeof params.text === 'string') bytes = Buffer.from(params.text);
    else if (method !== 'void.export.pdf') fail('invalid');
    if (bytes?.length > 32 * 1024 * 1024) fail('invalid');
    const selected = await dialog.showSaveDialog(window, { defaultPath: name, ...(method === 'void.export.pdf' ? { filters: [{ name: 'PDF', extensions: ['pdf'] }] } : {}) });
    if (selected.canceled || !selected.filePath) return { saved: false };
    bytes ??= await record.view.webContents.printToPDF({ printBackground: true });
    if (bytes.length > 32 * 1024 * 1024) fail('invalid');
    await writeFileImpl(selected.filePath, bytes);
    return { saved: true, name: path.basename(selected.filePath) };
  };

  return {
    clientId,
    update(input) {
      if (disposed || !input || ![null, 'blueprint', 'void'].includes(input.app)) fail('invalid');
      if (input.app === null && !input.token) {
        activity({ empty: true });
        active = null;
        token = undefined;
        project = null;
        layout();
        return;
      }
      if (!input.bounds || ['x', 'y', 'width', 'height'].some(key => !Number.isFinite(input.bounds[key]))) fail('invalid');
      if (typeof input.token !== 'string' || !input.token || input.token.length > 8192 || !['en', 'es'].includes(input.locale)) fail('invalid');
      const nextTokens = input.tokens ?? {};
      validateJson(nextTokens, 16384, 1000);
      if (!nextTokens || Array.isArray(nextTokens) || typeof nextTokens !== 'object' || JSON.stringify(nextTokens).length > 16384) fail('invalid');
      const previousToken = token;
      const previousProject = project;
      token = input.token;
      project = input.project ?? null;
      bounds = input.bounds;
      active = input.app;
      const localeChanged = locale !== input.locale;
      const tokensChanged = JSON.stringify(tokens) !== JSON.stringify(nextTokens);
      locale = input.locale;
      tokens = nextTokens;
      if (active) {
        const record = records.get(active) ?? makeRecord(active);
        if (record.state === 'idle' || record.state === 'unavailable') {
          status(record, 'loading');
          const target = active === 'blueprint' && pendingBoard ? blueprintOpenUrl(pendingBoard) : APP_TARGETS[active].url;
          if (active === 'blueprint') pendingBoard = null;
          Promise.resolve(record.view.webContents.loadURL(target)).catch(() => { if (disposed) return; record.loaded = false; status(record, 'unavailable'); layout(); activity(); });
        }
      }
      layout();
      for (const record of records.values()) {
        if (localeChanged) send(record, 'host.locale', { locale });
        if (tokensChanged) send(record, 'host.tokens', { tokens });
      }
      if (records.get('void')?.loaded && project && (project !== previousProject || token !== previousToken)) {
        const location = project, selectedToken = token;
        selectionPending = selectionPending.then(async () => {
          if (disposed || token !== selectedToken || project !== location) return;
          const selected = await serviceCall('void', 'void.open.switchTo', { location });
          if (!disposed && token === selectedToken && project === location) send(records.get('void'), 'void.project', selected);
        }).catch(() => {});
      }
      activity();
    },
    async call(event, method, params = {}) {
      try {
        const record = [...records.values()].find(item => item.view.webContents === event.sender);
        if (!record || disposed || !event.senderFrame || event.senderFrame !== record.view.webContents.mainFrame || !appOrigin(record.app, event.senderFrame.url)) fail('denied');
        if (!appMethodAllowed(record.app, method)) fail('invalid');
        validateParams(method, params);
        if (method === 'hello') {
          if (!params || params.app !== record.app || params.protocol !== 1 || typeof params.appVersion !== 'string' || params.appVersion.length > 128) fail('invalid');
          const result = await serviceCall(record.app, method, { ...params, ...(project ? { project } : {}) });
          return { result: { host: 'ONEM1ND', hostVersion, protocol: 1, locale, tokens, visible: record.visible, capabilities: [...APP_METHODS[record.app]], ...(typeof result?.person?.name === 'string' ? { person: { name: result.person.name } } : {}) } };
        }
        if (method === 'app.saved') { record.saved?.(); return { result: { saved: true } }; }
        if (method === 'void.open.pick') {
          const selected = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'Documents', extensions: ['md', 'txt', 'html', 'json'] }] });
          if (selected.canceled || !selected.filePaths[0]) return { result: null };
          return { result: await serviceCall(record.app, method, { path: selected.filePaths[0] }) };
        }
        if (method.startsWith('void.export.')) return { result: await exportFile(record, method, params) };
        return { result: await serviceCall(record.app, method, params) };
      } catch (error) { return errorResult(error); }
    },
    event(frame) {
      if (disposed || frame?.name !== 'app.bridge') return;
      const data = frame.envelope?.data;
      if (data?.name === 'app.open') {
        const params = data.params;
        if (data.app === 'blueprint' && typeof params?.id === 'string' && typeof params.location === 'string') { pendingBoard = params; showBoard(); notice(); }
        else if (data.app === 'void' && typeof params?.project?.id === 'string' && typeof params.path === 'string') { pendingText = params; showText(); notice(); }
        return;
      }
      if (!data || data.clientId === clientId || !events.has(data.name)) return;
      if (data.name.startsWith('host.') || data.name === 'app.save') return;
      for (const record of records.values()) {
        if (data.app && data.app !== record.app) continue;
        if (data.name.startsWith('blueprint.') && record.app !== 'blueprint') continue;
        if (data.name.startsWith('void.') && record.app !== 'void') continue;
        send(record, data.name, data.params);
      }
    },
    saveBeforeClose() {
      closePending ??= Promise.all([...records.values()].filter(record => record.loaded).map(record => new Promise(resolve => {
        const timeout = setTimeout(() => { record.saved = null; resolve(); }, saveTimeout);
        record.saved = () => { clearTimeout(timeout); record.saved = null; resolve(); };
        send(record, 'app.save');
      })));
      return closePending;
    },
    dispose() {
      if (disposed) return;
      activity({ empty: true });
      clearInterval(activityTimer);
      disposed = true;
      token = undefined;
      for (const name of ['resize', 'show', 'hide', 'minimize', 'restore']) window.removeListener(name, layout);
      for (const record of records.values()) {
        record.saved?.();
        record.cleanup();
        if (!window.isDestroyed()) window.contentView.removeChildView(record.view);
        if (!record.view.webContents.isDestroyed()) record.view.webContents.close();
      }
      records.clear();
    },
  };
}
