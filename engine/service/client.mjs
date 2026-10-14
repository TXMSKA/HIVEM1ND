import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { lstat, readFile } from 'node:fs/promises';
import os from 'node:os';
import { localCosmic, mindKeyFor } from './paths.mjs';
import path from 'node:path';
import { CoreError, parseUnitId } from './identity.mjs';
import { readOwnedServiceBridge, restartService, runConfiguredService, stopService } from './service.mjs';
import { dispatchLocal, dispatchNative } from './bridge.mjs';

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
  for (const [name, previous] of sessions) {
    if (!previous.handle?.stopping || previous.handle.restarting) continue;
    for (const close of previous.closes) close();
    sessions.delete(name);
  }
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
    session = { mindPath, pending, handle: null, refs: 0, closes: new Set(), viewers: new Set(), recovery: null };
    sessions.set(key, session);
    runConfiguredService({
      mindPath,
      platform: options.platform,
      env: options.env,
      home: options.home ?? options.homeDir,
      cosmicPath: options.cosmicPath,
      hostname: options.machine ?? options.hostname,
      aclRunner: options.aclRunner,
      confineRoot: options.confineRoot,
      now: options.now,
      userKey: options.userKey,
      guardPort: options.guardPort,
      assetDir: options.assetDir,
      port: options.port,
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
  const origin = new URL(record.origin);
  let viewer;
  try {
    viewer = await issueViewer(origin, secret);
  } catch (error) {
    if (session.refs === 0 && sessions.get(key) === session) {
      sessions.delete(key);
      await stopService(handle);
    }
    throw error;
  }
  session.refs += 1;
  session.viewers.add(viewer.token);
  return {
    origin,
    token: viewer.token,
    viewerId: viewer.viewerId,
    secret,
    get service() { return session.handle; },
    mindPath,
    closed: false,
    async readiness() {
      const owned = await readOwnedServiceBridge({ ...options, mindPath });
      if (owned.descriptor && session.handle?.http && !session.handle.http.server.listening) return { state: 'stopped' };
      return { state: owned.absent ? 'stopped' : owned.descriptor ? 'running' : 'unknown' };
    },
    async recover() {
      session.recovery ??= (async () => {
        if (session.handle?.restarting) await session.handle.restarting;
        const owned = await readOwnedServiceBridge({ ...options, mindPath });
        if (owned.unrelated) throw new CoreError(409, 'service_mind_conflict', 'Another M1ND owns the service lock.');
        if (owned.descriptor && session.handle?.http && !session.handle.http.server.listening) await restartService(session.handle);
        if (owned.absent || session.handle?.stopping || session.handle?.bootstrapState?.valid === false) {
          session.handle = await runConfiguredService({ ...options, mindPath, port: Number(origin.port), hostname: options.machine ?? options.hostname });
          session.pending = Promise.resolve(session.handle);
        }
        const current = session.handle.bootstrapState?.record ?? session.handle.bootstrap;
        if (!current?.origin || new URL(current.origin).origin !== origin.origin) throw new CoreError(503, 'service_unavailable', 'Reopen HIVEM1ND using the local launcher.');
        return { origin: new URL(current.origin), secret: session.handle.bootstrapState?.secret ?? current.secret, handle: session.handle };
      })().finally(() => { session.recovery = null; });
      return session.recovery;
    },
    track(close) {
      session.closes.add(close);
      return () => session.closes.delete(close);
    },
    async release({ stop = false } = {}) {
      session.viewers.delete(viewer.token);
      await logoutViewer(origin, viewer.token);
      session.refs = Math.max(0, session.refs - 1);
      if (stop && session.refs === 0 && sessions.get(key) === session) {
        for (const close of session.closes) close();
        session.closes.clear();
        sessions.delete(key);
        await stopService(session.handle);
      }
    },
  };
}

export async function closeAttachedServices() {
  const open = [...sessions.values()];
  sessions.clear();
  for (const session of open) {
    const origin = session.handle?.bootstrapState?.record?.origin ?? session.handle?.bootstrap?.origin;
    if (origin) {
      for (const token of session.viewers) await logoutViewer(new URL(origin), token);
    }
    session.viewers?.clear();
    for (const close of session.closes) close();
    session.closes.clear();
    if (session.handle) await stopService(session.handle);
  }
}

export async function openRelayOperations(options = {}) {
  const { createRelay } = await import('../relay/store.mjs');
  const direct = () => createRelay(Object.fromEntries(Object.entries(options).filter(([key]) => ['mindPath', 'hostname', 'sessionId', 'client', 'scopeLock', 'pinnedRegistration', 'proveBinding', 'commitFile'].includes(key))));
  if (options.pinnedRegistration || options.internal === true) return direct();
  const env = options.env ?? process.env;
  if (env.HIVEM1ND_SERVICE_BRIDGE || env.HIVEM1ND_SERVICE_GRANT) return nativeOperations(options, env);
  if (await serviceMind(options)) {
    if (options.client === 'master') return personOperations(options);
    throw new CoreError(503, 'native_login_unverified', 'This 3.0 command needs its verified native service binding.');
  }
  // Existing 2.x minds retain their offline transport until their explicit service migration.
  return direct();
}

export async function serviceMind(options) {
  const version = await readFile(path.join(options.mindPath, 'user', 'VERSION'), 'utf8').catch(() => '');
  if (Number(/^\s*(\d+)\./.exec(version)?.[1]) >= 3) return true;
  try {
    const cosmic = options.cosmicPath ?? localCosmic({ platform: options.platform ?? process.platform, env: options.env ?? process.env, home: options.home ?? options.homeDir ?? os.homedir() });
    const root = path.join(cosmic, 'hivem1nd-service');
    const key = mindKeyFor(options.mindPath, options.platform ?? process.platform);
    if ((await lstat(path.join(root, key)).catch(() => null))?.isDirectory()) return true;
    const active = JSON.parse(await readFile(path.join(root, 'active.json'), 'utf8').catch(() => 'null'));
    return Boolean(active?.mindPath && path.resolve(active.mindPath) === path.resolve(options.mindPath));
  } catch { return false; }
}

export async function relayPolicy(options, input) {
  const env = options.env ?? process.env;
  if (env.HIVEM1ND_SERVICE_BRIDGE || env.HIVEM1ND_SERVICE_GRANT) {
    return dispatchNative(env.HIVEM1ND_SERVICE_BRIDGE, env.HIVEM1ND_SERVICE_GRANT, 'policy', input);
  }
  const owned = await readOwnedServiceBridge(options);
  if (!owned.descriptor) throw new CoreError(503, 'service_unavailable', 'The configured service is not running for this mind.');
  return dispatchLocal(owned.descriptor, 'policy', input);
}

function nativeOperations(options, env) {
  let connected = null;
  const tools = { register: 'register', send: 'send_message', inbox: 'list_inbox', read: 'read_inbox', history: 'history', threads: 'threads', status: 'status', events: 'events', reminder: 'reminder', delivery: 'delivery_status' };
  return Object.fromEntries(Object.entries(tools).map(([operation, name]) => [operation, async (args = {}) => {
    connected ??= await connectNativeService({ env, client: options.client, nativeSessionId: options.nativeSessionId });
    const forwarded = ['register', 'send', 'read'].includes(operation) ? { ...args, requestId: args.requestId ?? randomUUID() } : args;
    const received = await connected.callTool(name, forwarded);
    const body = JSON.parse(received.content?.find((item) => item.type === 'text')?.text ?? '{}');
    if (received.isError) throw new CoreError(403, body.error?.code ?? 'service_unavailable', body.error?.message ?? 'The service rejected the command.');
    return body.data;
  }]));
}

function personOperations(options) {
  const withViewer = async (run) => {
    const viewer = await connectService(options);
    try { return await run(viewer); } finally { await viewer.release(); }
  };
  const call = async (viewer, method, target, body) => {
    const response = await request(viewer, { method, path: `/api/v1${target}`, ...(body === undefined ? {} : { body }), ...(method === 'GET' ? {} : { headers: { 'idempotency-key': randomUUID() } }), timeoutMs: 5000 });
    if (response.status >= 400) throw new CoreError(response.status, response.json?.error?.code ?? 'service_unavailable', response.json?.error?.message ?? 'The person operation failed.');
    return response.json.data;
  };
  return {
    async register(args) {
      if (!['master', 'user'].includes(args.unit)) throw new CoreError(403, 'forbidden', 'The person cannot register an agent.');
      return withViewer(async () => ({ unit: 'master', client: 'master' }));
    },
    async status() {
      return withViewer(async (viewer) => {
        const view = await call(viewer, 'GET', '/view');
        return { units: view.units.map((unit) => ({ ...unit, scope: unit.scope?.id ?? (unit.scope?.kind === 'root' ? 'root' : `${unit.scope?.kind}:${unit.scope?.name}`) })), sessions: view.sessions };
      });
    },
    async awake(unitId) {
      const now = options.now?.() ?? Date.now();
      return withViewer(async (viewer) => (await call(viewer, 'GET', '/view')).sessions.some((session) => session.unitId === unitId && session.state !== 'stopped'
        && session.wake?.enabled === true && !session.wake.pausedReason && (session.wake.deadlineAt === null || Date.parse(session.wake.deadlineAt) > now)));
    },
    async send(args) {
      return withViewer(async (viewer) => {
        let unitId = args.to;
        if (!/^(root|env|project):/.test(unitId)) {
          const matches = (await call(viewer, 'GET', '/view')).units.filter((unit) => unit.unit.toLowerCase() === unitId.toLowerCase());
          if (matches.length !== 1) throw new CoreError(409, 'ambiguous_unit', 'The destination needs its canonical unit ID.');
          unitId = matches[0].id;
        }
        const result = await call(viewer, 'POST', `/mailboxes/${encodeURIComponent(unitId)}/messages`, {
          body: args.body, subject: args.subject, priority: args.priority ?? 'normal',
          attachments: (args.attachments ?? []).map((item) => typeof item === 'string' ? { path: item, kind: null } : item),
        });
        return result.message ?? result;
      });
    },
  };
}

export async function connectNativeService({ env = process.env, nativeSessionId = null, client = null } = {}) {
  const endpoint = env.HIVEM1ND_SERVICE_BRIDGE;
  const grant = env.HIVEM1ND_SERVICE_GRANT;
  const binding = { ...(nativeSessionId ? { nativeSessionId } : {}), ...(client ? { client } : {}) };
  const attached = await dispatchNative(endpoint, grant, 'attach', binding);
  let origin;
  try { origin = new URL(attached.origin); } catch { throw new CoreError(503, 'service_unavailable', 'The native service origin is invalid.'); }
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.pathname !== '/' || origin.search || origin.hash || !origin.port
      || typeof attached.token !== 'string' || !attached.sessionId || !attached.unitId) {
    throw new CoreError(503, 'service_unavailable', 'The native service binding is invalid.');
  }
  const connection = { ...attached, origin, closed: false };
  const initialized = await request(connection, {
    path: '/mcp',
    timeoutMs: 3000,
    body: { jsonrpc: '2.0', id: randomUUID(), method: 'initialize', params: { protocolVersion: '2025-03-26' } },
  });
  if (initialized.status !== 200 || initialized.json?.result?.protocolVersion !== '2025-03-26') {
    throw new CoreError(503, 'service_unavailable', 'The native service protocol could not be initialized.');
  }
  return {
    ...connection,
    async callTool(name, args) {
      const response = await request(connection, {
        path: '/mcp',
        timeoutMs: 3000,
        body: { jsonrpc: '2.0', id: args.requestId ?? randomUUID(), method: 'tools/call', params: { name, arguments: args } },
      });
      if (response.status !== 200 || !response.json?.result) {
        throw new CoreError(response.status ?? 503, response.json?.error?.code ?? 'service_unavailable', 'The native service operation failed.');
      }
      return response.json.result;
    },
    hook(event) { return dispatchNative(endpoint, grant, 'hook', { ...binding, event }); },
    close() { connection.closed = true; },
  };
}

export async function request(client, spec) {
  if (client.closed) throw new Error('The service client is closed.');
  const payload = spec.body === undefined ? null : Buffer.from(JSON.stringify(spec.body));
  return new Promise((resolve, reject) => {
    let timer = null;
    const fail = (error) => { if (timer) clearTimeout(timer); reject(error); };
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
      res.once('aborted', () => fail(new CoreError(503, 'service_unavailable', 'The service response was interrupted.')));
      res.once('error', () => fail(new CoreError(503, 'service_unavailable', 'The service response failed.')));
      res.once('close', () => {
        if (!res.complete) fail(new CoreError(503, 'service_unavailable', 'The service response was interrupted.'));
      });
      res.on('end', () => {
        if (timer) clearTimeout(timer);
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          const json = raw.length > 0 && String(res.headers['content-type'] ?? '').includes('json') ? JSON.parse(raw) : null;
          resolve({ status: res.statusCode, json, raw, headers: res.headers });
        } catch { fail(new CoreError(502, 'invalid_json', 'The service response is not valid JSON.')); }
      });
    });
    req.on('error', fail);
    if (spec.timeoutMs) timer = setTimeout(() => {
      const error = new CoreError(503, 'service_unavailable', 'The service request timed out.');
      req.destroy(error);
      fail(error);
    }, spec.timeoutMs);
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
    let disconnected = false;
    const disconnect = () => {
      if (disconnected || stopped) return;
      disconnected = true;
      listener({ event: 'disconnect' });
      schedule();
    };
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
        disconnect();
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
      res.once('aborted', disconnect);
      res.once('error', disconnect);
      res.once('close', () => { if (!res.complete) disconnect(); });
      res.once('end', disconnect);
    });
    req.on('error', disconnect);
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

export function bindNative(client, binding = {}) {
  if (!binding.bridge || !binding.proof || Object.hasOwn(binding.proof, 'handshake')) {
    return { nativeSupport: false, reason: 'native_login_unverified' };
  }
  try {
    const proof = binding.proof;
    const unit = parseUnitId(proof.unitId);
    if (!proof.nativeSessionId || !proof.machine || !proof.client) {
      return { nativeSupport: false, reason: 'native_login_unverified' };
    }
    const adapter = binding.bridge.adapters?.[proof.client];
    if (!adapter || adapter.confirm?.({ ...proof, unitId: unit.id }) !== true) {
      return { nativeSupport: false, reason: 'native_login_unverified' };
    }
    return { nativeSupport: true, client, unitId: unit.id };
  } catch {
    return { nativeSupport: false, reason: 'native_login_unverified' };
  }
}

export async function legacyOperation(client, name, args = {}) {
  const requestId = typeof args.requestId === 'string' && args.requestId ? args.requestId : randomUUID();
  const forwarded = { ...args, requestId };
  if (client?.operations && typeof client.operations[name] === 'function') return client.operations[name](forwarded);
  return request(client, {
    path: '/mcp',
    body: { jsonrpc: '2.0', id: requestId, method: 'tools/call', params: { name, arguments: forwarded } },
  });
}

async function issueViewer(origin, secret) {
  const response = await request({ origin, token: secret, closed: false }, {
    method: 'POST',
    path: '/api/v1/auth/local',
    body: { embedded: false, hostOrigin: null, look: null, language: null },
  });
  if (response.status !== 201 || typeof response.json?.data?.token !== 'string') {
    throw new CoreError(503, 'bootstrap_unavailable', 'The local viewer could not be issued.');
  }
  return response.json.data;
}

async function logoutViewer(origin, token) {
  await request({ origin, token, closed: false }, { method: 'POST', path: '/api/v1/auth/logout', body: {} }).catch(() => {});
}

export function close(client) {
  client.closed = true;
}
