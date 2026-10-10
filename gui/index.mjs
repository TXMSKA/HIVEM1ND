import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { lstat, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CoreError } from '../engine/service/identity.mjs';
import { servicePaths } from '../engine/service/paths.mjs';
import { createStore } from '../engine/service/store.mjs';
import { composeCore } from '../engine/service/service.mjs';

const CAPABILITIES = Object.freeze(['read', 'chat.post', 'chat.manage', 'mailbox.read', 'approval.answer', 'grant.revoke', 'task.status', 'task.undo', 'unit.create', 'unit.connect', 'session.start', 'session.stop', 'layout.write', 'settings.write', 'home.manage', 'editor.read', 'editor.write', 'comment.write', 'proposal.answer', 'asset.write', 'watch', 'viewer.write']);

let active = null;

function fail(status, code, message) {
  throw new CoreError(status, code, message);
}

function originOf(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.origin !== value) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function startGui(input = {}) {
  if (!input.mindPath || typeof input.mindPath !== 'string') fail(422, 'mind_not_configured', 'The mind is not configured.');
  const mindPath = path.resolve(input.mindPath);
  const info = await lstat(mindPath).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) fail(422, 'mind_not_configured', 'The mind is not configured.');
  const user = await lstat(path.join(mindPath, 'user')).catch(() => null);
  if (!user?.isDirectory()) fail(422, 'mind_not_configured', 'The mind is not configured.');
  const embedded = input.embedded === true;
  const hostOrigin = input.hostOrigin ?? null;
  if (embedded && !originOf(hostOrigin)) fail(422, 'invalid_body', 'An embedded host needs one http or https origin.');
  if (hostOrigin != null && !originOf(hostOrigin)) fail(422, 'invalid_body', 'The host origin must be one http or https origin.');
  if (input.look != null && !['modern', 'high-contrast'].includes(input.look)) fail(422, 'invalid_body', 'The look is not supported.');
  if (input.language != null && !['en', 'es'].includes(input.language)) fail(422, 'invalid_body', 'The language is not supported.');
  if (active && path.resolve(active.mindPath) !== mindPath) fail(409, 'service_mind_conflict', 'Another mind owns the service lock.');
  if (!active) active = await boot(mindPath, input);
  const auth = await call(active.port, 'POST', '/api/v1/auth/local', {});
  if (auth.status !== 200) fail(auth.status, auth.json?.error?.code ?? 'service_unavailable', 'The viewer could not sign in.');
  const token = auth.json.token;
  const viewerId = auth.json.viewerId;
  if (input.look != null || input.language != null) {
    await call(active.port, 'PATCH', '/api/v1/viewer', { look: input.look ?? null, language: input.language ?? null }, token);
  }
  const handle = {
    origin: `http://127.0.0.1:${active.port}`,
    url: `http://127.0.0.1:${active.port}/gui/${viewerId}#/`,
    token,
    viewerId,
    embedded,
    capabilities: CAPABILITIES,
    dirty: false,
    stopped: false,
    async setTheme(look) {
      if (handle.stopped) return;
      await call(active.port, 'PATCH', '/api/v1/viewer', { look }, token);
    },
    async setLanguage(language) {
      if (handle.stopped) return;
      await call(active.port, 'PATCH', '/api/v1/viewer', { language }, token);
    },
    isDirty() {
      return handle.dirty === true;
    },
    async stop() {
      if (handle.stopped) return;
      handle.stopped = true;
      await call(active.port, 'POST', '/api/v1/auth/logout', null, token);
    },
  };
  return handle;
}

async function boot(mindPath, input) {
  const env = input.env ?? process.env;
  const paths = servicePaths({
    platform: input.platform ?? process.platform,
    env,
    home: input.home ?? os.homedir(),
    mindPath,
    machine: input.machine ?? os.hostname(),
  });
  await mkdir(paths.localDirectory, { recursive: true });
  const confineRoot = input.env ? path.dirname(input.env.LOCALAPPDATA ?? input.env.XDG_DATA_HOME ?? paths.cosmic) : null;
  const store = createStore({
    root: confineRoot ?? paths.cosmic,
    mindPath: paths.mind,
    localDirectory: paths.localDirectory,
    confineRoot,
    now: input.now,
  });
  const core = await composeCore({ store, paths, now: input.now, projects: [] });
  return { mindPath, port: core.http.port, core };
}

export async function closeGuiHost() {
  if (!active) return;
  await active.core.http.close();
  active = null;
}

function call(port, method, target, body, token) {
  const payload = body === undefined || body === null ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      method,
      path: target,
      headers: {
        host: `127.0.0.1:${port}`,
        origin: `http://127.0.0.1:${port}`,
        ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(method !== 'GET' && method !== 'POST' ? { 'idempotency-key': randomUUID() } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const json = raw && String(res.headers['content-type'] ?? '').includes('json') ? JSON.parse(raw) : null;
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}
