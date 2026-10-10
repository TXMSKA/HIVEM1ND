import { request as httpRequest } from 'node:http';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { CoreError } from './identity.mjs';
import { runConfiguredService, stopService } from './service.mjs';

const sessions = new Map();

export async function connectService(options = {}) {
  if (options.origin && options.token && !options.mindPath) {
    return { origin: new URL(options.origin), token: options.token, closed: false };
  }
  if (!options.mindPath || typeof options.mindPath !== 'string') {
    throw new CoreError(422, 'mind_not_configured', 'The mind is not configured.');
  }
  const mindPath = path.resolve(options.mindPath);
  const info = await lstat(mindPath).catch(() => null);
  const user = info?.isDirectory() && !info.isSymbolicLink() ? await lstat(path.join(mindPath, 'user')).catch(() => null) : null;
  if (!info?.isDirectory() || info.isSymbolicLink() || !user?.isDirectory() || user.isSymbolicLink()) {
    throw new CoreError(422, 'mind_not_configured', 'The mind is not configured.');
  }
  const key = process.platform === 'win32' ? mindPath.toLowerCase() : mindPath;
  if ([...sessions.keys()].some((item) => item !== key)) {
    throw new CoreError(409, 'service_mind_conflict', 'Another mind owns the service lock.');
  }
  let session = sessions.get(key);
  if (!session) {
    let resolveHandle;
    let rejectHandle;
    const pending = new Promise((resolve, reject) => {
      resolveHandle = resolve;
      rejectHandle = reject;
    });
    session = { mindPath, pending, handle: null, refs: 0, closes: new Set() };
    sessions.set(key, session);
    runConfiguredService({
      mindPath,
      platform: options.platform,
      env: options.env,
      home: options.home,
      cosmicPath: options.cosmicPath,
      hostname: options.machine ?? options.hostname,
      aclRunner: options.aclRunner,
      confineRoot: options.confineRoot,
      now: options.now,
      userKey: options.userKey,
      guardPort: options.guardPort,
      assetDir: options.assetDir,
    }).then((handle) => {
      session.handle = handle;
      resolveHandle(handle);
    }, (error) => {
      if (sessions.get(key) === session) sessions.delete(key);
      rejectHandle(error);
    });
  }
  const handle = await session.pending;
  const record = handle.bootstrapState?.record ?? handle.bootstrap;
  const secret = handle.bootstrapState?.secret ?? record?.secret;
  if (!record?.origin || !secret || handle.bootstrapState?.valid === false) {
    if (session.refs === 0 && sessions.get(key) === session) {
      sessions.delete(key);
      await stopService(handle);
    }
    throw new CoreError(503, 'bootstrap_unavailable', 'The bootstrap file could not be protected.');
  }
  session.refs += 1;
  return {
    origin: new URL(record.origin),
    secret,
    service: handle,
    mindPath,
    closed: false,
    track(close) {
      session.closes.add(close);
      return () => session.closes.delete(close);
    },
    async release({ stop = false } = {}) {
      session.refs = Math.max(0, session.refs - 1);
      if (stop && session.refs === 0 && sessions.get(key) === session) {
        for (const close of session.closes) close();
        session.closes.clear();
        sessions.delete(key);
        await stopService(handle);
      }
    },
  };
}

export async function closeAttachedServices() {
  const open = [...sessions.values()];
  sessions.clear();
  for (const session of open) {
    for (const close of session.closes) close();
    session.closes.clear();
    if (session.handle) await stopService(session.handle);
  }
}

export async function request(client, spec) {
  if (client.closed) throw new Error('The service client is closed.');
  const payload = spec.body === undefined ? null : Buffer.from(JSON.stringify(spec.body));
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: client.origin.hostname,
      port: client.origin.port,
      method: spec.method ?? 'POST',
      path: spec.path,
      headers: {
        host: client.origin.host,
        origin: client.origin.origin,
        authorization: `Bearer ${client.token}`,
        accept: spec.accept ?? 'application/json, text/event-stream',
        ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
        ...(spec.headers ?? {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const json = raw.length > 0 && String(res.headers['content-type'] ?? '').includes('json') ? JSON.parse(raw) : null;
        resolve({ status: res.statusCode, json, raw, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

export function subscribe(client, listener = () => {}) {
  if (!client?.origin || !client?.token) throw new CoreError(503, 'service_unavailable', 'The viewer stream is not connected.');
  let stopped = false;
  let req = null;
  let timer = null;
  const close = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    req?.destroy();
    req = null;
  };
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(run, 250);
    timer.unref?.();
  };
  const run = () => {
    if (stopped) return;
    req = httpRequest({
      hostname: client.origin.hostname,
      port: client.origin.port,
      path: '/api/v1/events',
      headers: {
        host: client.origin.host,
        origin: client.origin.origin,
        authorization: `Bearer ${client.token}`,
        accept: 'text/event-stream',
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        if (!stopped) listener({ event: 'error', status: res.statusCode });
        schedule();
        return;
      }
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        let split = buffer.indexOf('\n\n');
        while (split >= 0) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const parsed = parseFrame(frame);
          if (parsed) listener(parsed);
          split = buffer.indexOf('\n\n');
        }
      });
      res.on('end', schedule);
    });
    req.on('error', () => { if (!stopped) schedule(); });
    req.end();
  };
  run();
  return { close };
}

function parseFrame(frame) {
  let event = 'message';
  const data = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  if (data.length === 0) return null;
  try {
    return { event, data: JSON.parse(data.join('\n')) };
  } catch {
    return null;
  }
}

export function bindNative(client, binding) {
  if (!binding?.verifiedLogin) return { nativeSupport: false, reason: 'native_login_unverified' };
  return { nativeSupport: true, client };
}

export async function legacyOperation(client, name, args) {
  return request(client, { path: '/mcp', body: { jsonrpc: '2.0', id: args?.requestId ?? 1, method: 'tools/call', params: { name, arguments: args ?? {} } } });
}

export function close(client) {
  client.closed = true;
}
