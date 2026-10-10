import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { closeAttachedServices, connectService, subscribe } from '../engine/service/client.mjs';
import { CoreError } from '../engine/service/identity.mjs';

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
  const confineRoot = input.confineRoot ?? (input.env?.LOCALAPPDATA ? path.dirname(input.env.LOCALAPPDATA) : input.env?.XDG_DATA_HOME ? path.dirname(input.env.XDG_DATA_HOME) : null);
  const service = await connectService({ ...input, mindPath, confineRoot });
  let token = null;
  let stream = null;
  let untrack = null;
  try {
    const auth = await call(service.origin.port, 'POST', '/api/v1/auth/local', {
      embedded,
      hostOrigin: embedded ? hostOrigin : input.hostOrigin ?? null,
      look: input.look ?? null,
      language: input.language ?? null,
    }, service.secret);
    if (auth.status !== 200 || !auth.json?.token || !auth.json?.viewerId || !auth.json?.url) {
      fail(auth.status ?? 503, auth.json?.error?.code ?? 'service_unavailable', 'The viewer could not sign in.');
    }
    token = auth.json.token;
    const viewerId = auth.json.viewerId;
    const handle = {
      origin: service.origin.origin,
      url: auth.json.url,
      token,
      viewerId,
      embedded,
      capabilities: auth.json.capabilities,
      dirty: false,
      look: input.look ?? null,
      language: input.language ?? null,
      stopped: false,
      async setTheme(look) {
        if (!['modern', 'high-contrast'].includes(look)) fail(422, 'invalid_body', 'The look is not supported.');
        await patchViewer(service.origin.port, token, { look });
        handle.look = look;
      },
      async setLanguage(language) {
        if (!['en', 'es'].includes(language)) fail(422, 'invalid_body', 'The language is not supported.');
        await patchViewer(service.origin.port, token, { language });
        handle.language = language;
      },
      isDirty() {
        return handle.dirty === true;
      },
      async stop() {
        if (handle.stopped) return;
        handle.stopped = true;
        stream?.close();
        untrack?.();
        await call(service.origin.port, 'POST', '/api/v1/auth/logout', null, token).catch(() => {});
        await service.release();
      },
    };
    let ready;
    const readyPromise = new Promise((resolve, reject) => { ready = { resolve, reject }; });
    const viewerClient = { origin: service.origin, token, closed: false };
    stream = subscribe(viewerClient, (frame) => {
      if (frame.event === 'stream.ready') ready.resolve();
      if (frame.event === 'error') ready.reject(new CoreError(frame.status ?? 503, 'service_unavailable', 'The viewer stream did not start.'));
      if (frame.event !== 'viewer.changed') return;
      const body = frame.data?.data ?? {};
      if (body.viewerId !== viewerId) return;
      if (typeof body.dirty === 'boolean') handle.dirty = body.dirty;
      if (body.look !== undefined) handle.look = body.look;
      if (body.language !== undefined) handle.language = body.language;
    });
    untrack = service.track(stream.close);
    const timeout = setTimeout(() => ready.reject(new CoreError(503, 'service_unavailable', 'The viewer stream did not start.')), 3000);
    try {
      await readyPromise;
    } finally {
      clearTimeout(timeout);
    }
    return handle;
  } catch (error) {
    stream?.close();
    untrack?.();
    if (token) await call(service.origin.port, 'POST', '/api/v1/auth/logout', null, token).catch(() => {});
    await service.release({ stop: true });
    throw error;
  }
}

async function patchViewer(port, token, body) {
  const result = await call(port, 'PATCH', '/api/v1/viewer', body, token);
  if (result.status !== 200) fail(result.status ?? 503, result.json?.error?.code ?? 'service_unavailable', 'The viewer could not be updated.');
}

export async function closeGuiHost() {
  await closeAttachedServices();
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
