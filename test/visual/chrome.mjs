import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const CHROME = process.env.HIVEM1ND_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

// A condition wait: polls a predicate and never sleeps for a fixed time.
export async function until(predicate, { timeout = 15000, interval = 40, message = 'condition' } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start <= timeout) {
    try { last = await predicate(); if (last) return last; } catch (error) { last = error; }
    await delay(interval);
  }
  const detail = last instanceof Error ? `: ${last.message}` : '';
  throw new Error(`Timed out after ${timeout} ms waiting for ${message}${detail}`);
}

// Chrome DevTools Protocol over the Node built-in WebSocket, one multiplexed browser connection.
class Connection {
  constructor(socket) {
    this.socket = socket; this.nextId = 1; this.pending = new Map(); this.listeners = new Map();
    socket.addEventListener('message', event => this.onMessage(event.data));
    socket.addEventListener('close', () => { for (const { reject } of this.pending.values()) reject(new Error('The DevTools connection closed.')); this.pending.clear(); });
  }
  static async open(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(new Error('The DevTools connection failed.')), { once: true }); });
    return new Connection(socket);
  }
  onMessage(data) {
    const message = JSON.parse(String(data));
    if (message.id) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`)); else entry.resolve(message.result ?? {});
      return;
    }
    for (const handler of this.listeners.get(`${message.sessionId ?? ''}:${message.method}`) ?? []) handler(message.params);
  }
  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(sessionId, method, handler) {
    const key = `${sessionId ?? ''}:${method}`;
    const list = this.listeners.get(key) ?? [];
    list.push(handler); this.listeners.set(key, list);
  }
  close() { try { this.socket.close(); } catch { /* already closed */ } }
}

export class Browser {
  static async launch({ executable = CHROME } = {}) {
    const userData = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-chrome-'));
    const port = await freePort();
    const child = spawn(executable, [
      '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, '--remote-debugging-address=127.0.0.1',
      '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-component-update',
      '--disable-background-networking', '--disable-default-apps', '--disable-translate', '--mute-audio', '--force-device-scale-factor=1',
      '--hide-crash-restore-bubble', '--disable-features=Translate,MediaRouter,OptimizationHints', '--lang=en-US', 'about:blank',
    ], { stdio: 'ignore', windowsHide: true });
    const browser = new Browser(child, userData, port);
    try {
      const info = await until(async () => {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null);
        return response?.ok ? response.json() : null;
      }, { timeout: 30000, message: 'Chrome DevTools' });
      browser.version = info.Browser;
      browser.connection = await Connection.open(info.webSocketDebuggerUrl);
    } catch (error) {
      await browser.close();
      throw error;
    }
    return browser;
  }
  constructor(child, userData, port) { this.child = child; this.userData = userData; this.port = port; this.version = null; this.connection = null; this.pages = new Set(); }
  async newPage() {
    const { targetId } = await this.connection.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.connection.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this, targetId, sessionId);
    await page.init();
    this.pages.add(page);
    return page;
  }
  async close() {
    for (const page of [...this.pages]) await page.close().catch(() => undefined);
    this.connection?.close();
    const exited = new Promise(resolve => this.child.once('exit', resolve));
    if (this.child.exitCode === null) {
      try { this.child.kill(); } catch { /* gone */ }
      await Promise.race([exited, delay(5000)]);
    }
    if (this.child.exitCode === null && this.child.pid) {
      await new Promise(resolve => spawn('taskkill', ['/PID', String(this.child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).once('exit', resolve));
    }
    await rm(this.userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }).catch(() => undefined);
  }
}

const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' }, Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 }, Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 }, ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 }, ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 }, Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 }, F2: { key: 'F2', code: 'F2', keyCode: 113 }, Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
};
const MODIFIERS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

export class Page {
  constructor(browser, targetId, sessionId) {
    this.browser = browser; this.targetId = targetId; this.sessionId = sessionId; this.connection = browser.connection;
    this.errors = []; this.routes = []; this.mouse = { x: 0, y: 0 }; this.viewport = null; this.failedRequests = [];
  }
  send(method, params) { return this.connection.send(method, params, this.sessionId); }
  on(method, handler) { this.connection.on(this.sessionId, method, handler); }
  async init() {
    await this.send('Page.enable'); await this.send('Runtime.enable'); await this.send('Network.enable');
    this.on('Runtime.exceptionThrown', event => {
      const details = event.exceptionDetails ?? {};
      const frames = (details.stackTrace?.callFrames ?? []).slice(0, 6).map(frame => `${frame.functionName || '?'} ${frame.url?.split('/').at(-1) ?? ''}:${frame.lineNumber}`).join(' > ');
      this.errors.push(`${details.exception?.description ?? details.text ?? 'exception'}${frames ? ` @ ${frames}` : ''}`);
    });
    this.on('Network.loadingFailed', event => { if (!event.canceled) this.failedRequests.push(event.errorText); });
    this.on('Fetch.requestPaused', event => this.paused(event));
    this.on('Page.javascriptDialogOpening', () => { this.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => undefined); });
  }
  async setViewport(width, height, { mobile = false, language = 'en' } = {}) {
    this.viewport = [width, height];
    const choice = language === 'es' ? 'es' : 'en';
    const languages = choice === 'es' ? ['es-ES', 'es'] : ['en-US', 'en'];
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height });
    await this.send('Emulation.setUserAgentOverride', { userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36' : '', acceptLanguage: choice === 'es' ? 'es-ES,es;q=0.9' : 'en-US' }).catch(() => undefined);
    // The opening and pairing frames choose a language before any viewer exists: the stored choice, else navigator.languages.
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const choice = ${JSON.stringify(choice)}; const languages = ${JSON.stringify(languages)}; try { localStorage.setItem('hivem1nd:language', choice); } catch (error) {} const define = (name, value) => { try { Object.defineProperty(Navigator.prototype, name, { configurable: true, get() { return value; } }); } catch (error) {} }; define('languages', languages); define('language', languages[0]); })();` });
  }
  async setMedia(features) { await this.send('Emulation.setEmulatedMedia', { features }); }
  async navigate(url) {
    const loaded = new Promise(resolve => { this.on('Page.loadEventFired', resolve); });
    await this.send('Page.navigate', { url });
    await Promise.race([loaded, delay(15000)]);
  }
  async eval(fn, ...args) {
    const expression = typeof fn === 'function' ? `(${fn})(...${JSON.stringify(args)})` : String(fn);
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value;
  }
  // Wait for an in-page predicate (function or expression); the page is polled, never slept on.
  async waitFor(fn, { timeout = 15000, message = null, args = [] } = {}) {
    return until(() => this.eval(fn, ...args), { timeout, message: message ?? String(fn).slice(0, 140) });
  }
  async rect(selector, { index = 0 } = {}) {
    return this.eval((sel, nth) => {
      const nodes = [...document.querySelectorAll(sel)].filter(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      const node = nodes[nth]; if (!node) return null;
      node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, selector, index);
  }
  async point(target, options = {}) {
    if (Array.isArray(target)) return { x: target[0], y: target[1] };
    if (target && typeof target === 'object' && 'x' in target) return target;
    const rect = await until(() => this.rect(target, options), { timeout: options.timeout ?? 10000, message: `visible ${target}` });
    return { x: rect.x + (options.at?.[0] ?? 0.5) * rect.w, y: rect.y + (options.at?.[1] ?? 0.5) * rect.h };
  }
  async mouseEvent(type, x, y, extra = {}) {
    this.mouse = { x, y };
    await this.send('Input.dispatchMouseEvent', { type, x, y, button: extra.button ?? 'none', buttons: extra.buttons ?? 0, clickCount: extra.clickCount ?? 0, modifiers: extra.modifiers ?? 0 });
  }
  async hover(target, options) { const p = await this.point(target, options); await this.mouseEvent('mouseMoved', p.x, p.y); return p; }
  async click(target, options = {}) {
    const p = await this.point(target, options);
    const modifiers = (options.modifiers ?? []).reduce((sum, name) => sum + MODIFIERS[name], 0);
    await this.mouseEvent('mouseMoved', p.x, p.y, { modifiers });
    await this.mouseEvent('mousePressed', p.x, p.y, { button: 'left', buttons: 1, clickCount: options.count ?? 1, modifiers });
    await this.mouseEvent('mouseReleased', p.x, p.y, { button: 'left', buttons: 0, clickCount: options.count ?? 1, modifiers });
    return p;
  }
  async doubleClick(target, options = {}) {
    const p = await this.point(target, options);
    await this.mouseEvent('mouseMoved', p.x, p.y);
    for (const count of [1, 2]) {
      await this.mouseEvent('mousePressed', p.x, p.y, { button: 'left', buttons: 1, clickCount: count });
      await this.mouseEvent('mouseReleased', p.x, p.y, { button: 'left', buttons: 0, clickCount: count });
    }
    return p;
  }
  async drag(from, to, { steps = 12, hold = false } = {}) {
    const a = await this.point(from), b = await this.point(to);
    await this.mouseEvent('mouseMoved', a.x, a.y);
    await this.mouseEvent('mousePressed', a.x, a.y, { button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= steps; step += 1) await this.mouseEvent('mouseMoved', a.x + (b.x - a.x) * step / steps, a.y + (b.y - a.y) * step / steps, { button: 'left', buttons: 1 });
    if (!hold) await this.mouseEvent('mouseReleased', b.x, b.y, { button: 'left', buttons: 0, clickCount: 1 });
    return { a, b };
  }
  async release() { await this.mouseEvent('mouseReleased', this.mouse.x, this.mouse.y, { button: 'left', buttons: 0, clickCount: 1 }); }
  async wheel(x, y, deltaX, deltaY) { await this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY }); }
  async type(text) {
    for (const char of String(text)) {
      if (char === '\n') { await this.press('Enter'); continue; }
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: char, text: char, unmodifiedText: char });
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: char });
    }
  }
  async insertText(text) { await this.send('Input.insertText', { text: String(text) }); }
  async press(name, { modifiers = [] } = {}) {
    const [first, second] = name.includes('+') ? [name.split('+').slice(0, -1), name.split('+').at(-1)] : [modifiers, name];
    const mask = first.reduce((sum, item) => sum + MODIFIERS[item.toLowerCase()], 0);
    const key = KEYS[second] ?? { key: second, code: /^[a-z]$/i.test(second) ? `Key${second.toUpperCase()}` : second, keyCode: second.length === 1 ? second.toUpperCase().charCodeAt(0) : 0, text: second.length === 1 && !mask ? second : undefined };
    await this.send('Input.dispatchKeyEvent', { type: key.text && !mask ? 'keyDown' : 'rawKeyDown', modifiers: mask, key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, ...(key.text && !mask ? { text: key.text } : {}) });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: mask, key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode });
  }
  async focus(selector) { await this.eval(sel => document.querySelector(sel)?.focus(), selector); }
  async selectAll() { await this.press('ctrl+a'); }
  // Fill an input the way a person does: focus it, select its content, type the new text.
  async fill(selector, text, { clear = true } = {}) {
    await this.click(selector);
    if (clear) { await this.selectAll(); await this.press('Backspace'); }
    await this.type(text);
  }
  async screenshot(file, expected) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    const bytes = Buffer.from(data, 'base64');
    const size = pngSize(bytes);
    if (expected && (size.width !== expected[0] || size.height !== expected[1])) throw new Error(`Screenshot is ${size.width}x${size.height}, expected ${expected[0]}x${expected[1]}.`);
    if (file) await writeFile(file, bytes);
    return { bytes, ...size };
  }
  // Request interception: the first matching route decides; a route returns 'continue', 'fail', { fulfill } or a promise of those.
  async route(match, handler) {
    const route = { match, handler };
    this.routes.push(route);
    if (this.routes.length === 1) await this.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    return () => { this.routes = this.routes.filter(item => item !== route); };
  }
  async paused(event) {
    const request = { url: event.request.url, method: event.request.method, headers: event.request.headers, body: event.request.postData ?? null };
    let action = 'continue';
    try {
      for (const route of [...this.routes]) {
        if (!route.match(request)) continue;
        action = await route.handler(request);
        break;
      }
    } catch { action = 'continue'; }
    try {
      if (action === 'fail') await this.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'ConnectionRefused' });
      else if (action && typeof action === 'object' && action.fulfill) await this.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: action.fulfill.status ?? 200, responseHeaders: Object.entries(action.fulfill.headers ?? {}).map(([name, value]) => ({ name, value })), body: Buffer.from(action.fulfill.body ?? '').toString('base64') });
      else await this.send('Fetch.continueRequest', { requestId: event.requestId });
    } catch { /* the page navigated away */ }
  }
  async close() {
    this.browser.pages.delete(this);
    await this.connection.send('Target.closeTarget', { targetId: this.targetId }).catch(() => undefined);
  }
}

export function pngSize(bytes) {
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG.');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
