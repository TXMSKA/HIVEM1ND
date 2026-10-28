import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, request } from 'node:http';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { closeAttachedServices, connectService, subscribe } from '../engine/service/client.mjs';
import { CoreError } from '../engine/service/identity.mjs';
import { createSetupSession } from '../engine/setup.mjs';
import { createWizardServer } from './server.mjs';
import { fileURLToPath } from 'node:url';

const folderHosts = new WeakMap();
const recoveryLaunchers = new Set();

async function attachRecoveryHost(handle, service) {
  const token = randomBytes(32).toString('base64url');
  const sockets = new Set();
  const server = createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
        ...(req.headers.origin === handle.origin ? { 'access-control-allow-origin': handle.origin, vary: 'Origin' } : {}) });
      res.end(JSON.stringify(body));
    };
    try {
      if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
          || req.headers.host !== `127.0.0.1:${server.address().port}` || req.headers.origin !== handle.origin) fail(403, 'forbidden', 'The verified local viewer is required.');
      if (req.method === 'OPTIONS' && ['/status', '/recover'].includes(req.url)) {
        res.writeHead(204, { 'access-control-allow-origin': handle.origin, 'access-control-allow-methods': 'GET, POST',
          'access-control-allow-headers': 'Authorization, Content-Type', 'cache-control': 'no-store', vary: 'Origin' });
        res.end(); return;
      }
      const authorization = String(req.headers.authorization ?? '');
      const supplied = Buffer.from(authorization.startsWith('Bearer ') ? authorization.slice(7) : '');
      const expected = Buffer.from(token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected) || handle.stopped) fail(403, 'forbidden', 'The verified local viewer is required.');
      if (req.method === 'GET' && req.url === '/status') { reply(200, await handle.serviceStatus()); return; }
      if (req.method !== 'POST' || req.url !== '/recover') fail(404, 'not_found', 'The recovery operation does not exist.');
      if (String(req.headers['content-type']).split(';')[0] !== 'application/json') fail(415, 'invalid_body', 'JSON is required.');
      let body = '';
      for await (const chunk of req) { body += chunk.toString(); if (body.length > 16) fail(413, 'invalid_body', 'The request is too large.'); }
      if (JSON.stringify(JSON.parse(body)) !== '{}') fail(422, 'invalid_body', 'The request must be empty.');
      reply(200, await handle.recover());
    } catch (error) {
      reply(error.status ?? 503, { error: { code: error.code ?? 'service_unavailable', message: 'The owned service could not be recovered. Reopen ONEM1ND using its local launcher.' } });
    }
  });
  server.on('connection', socket => { sockets.add(socket); socket.unref(); socket.once('close', () => sockets.delete(socket)); });
  server.requestTimeout = 30_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  server.unref();
  const bridge = { origin: `http://127.0.0.1:${server.address().port}`, token };
  let viewerId = handle.viewerId;
  const bind = () => {
    service.service.recoveryHosts.delete(viewerId);
    viewerId = handle.viewerId;
    service.service.recoveryHosts.set(viewerId, bridge);
  };
  bind();
  const launcher = { bind, async close() {
    recoveryLaunchers.delete(launcher);
    service.service.recoveryHosts?.delete(viewerId);
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  } };
  recoveryLaunchers.add(launcher);
  return launcher;
}

export function createFolderReopen(input = {}, dependencies = {}) {
  let pending = null;
  return () => {
    pending ??= (async () => {
      const session = await (dependencies.createSetupSession ?? createSetupSession)({
        ...input, kitPath: input.kitPath ?? fileURLToPath(new URL('../', import.meta.url)),
        homeDir: input.homeDir ?? input.home, hostname: input.hostname ?? input.machine,
        resume: false, serviceSetup: true, serviceDryRun: false,
      });
      // Enter Location without answering or replacing the existing setup checkpoint.
      session.currentStep = 2;
      return (dependencies.createWizardServer ?? createWizardServer)({ session });
    })().catch(error => { pending = null; throw error; });
    return pending;
  };
}

function attachFolderReopen(http, token, mindPath, reopen) {
  let hosts = folderHosts.get(http.server);
  if (!hosts) {
    hosts = new Map();
    folderHosts.set(http.server, hosts);
    const [serve] = http.server.listeners('request');
    http.server.removeListener('request', serve);
    http.server.on('request', async (req, res) => {
      if (req.url !== '/api/v1/viewer/folder') return serve(req, res);
      const origin = `http://127.0.0.1:${http.port}`;
      const authorization = String(req.headers.authorization ?? '');
      const key = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      const host = hosts.get(key);
      const meta = { requestId: randomUUID(), readAt: new Date().toISOString(), eventCursor: http.bus.captureCursor(), sync: 'local' };
      const reply = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
        res.end(JSON.stringify(body));
      };
      try {
        if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || req.headers.host !== new URL(origin).host || (req.headers.origin !== undefined && req.headers.origin !== origin) || (req.method === 'POST' && req.headers.origin !== origin)) fail(403, 'forbidden', 'Local folder selection is required.');
        if (!['GET', 'POST'].includes(req.method)) fail(405, 'method_not_allowed', 'GET or POST is required.');
        if (!http.credentials.verify(key)) fail(401, 'invalid_session', 'The viewer session has ended.');
        if (!host) fail(403, 'forbidden', 'This viewer has no folder selection host.');
        if (req.method === 'GET') {
          reply(200, { contract: 'hivem1nd-gui-v3', data: { mindPath: host.mindPath }, meta }); // Compatibility: retain the service wire contract for existing viewers.
          return;
        }
        if (String(req.headers['content-type']).split(';')[0] !== 'application/json') fail(415, 'invalid_body', 'JSON is required.');
        let body = '';
        for await (const chunk of req) {
          body += chunk.toString();
          if (body.length > 16) fail(413, 'invalid_body', 'The request is too large.');
        }
        if (JSON.stringify(JSON.parse(body)) !== '{}') fail(422, 'invalid_body', 'The request must be empty.');
        const wizard = await host.reopen();
        reply(200, { contract: 'hivem1nd-gui-v3', data: { url: wizard.url }, meta }); // Compatibility: retain the service wire contract for existing viewers.
      } catch (error) {
        reply(error.status ?? 503, { error: { code: error.code ?? 'folder_unavailable', message: 'The folder selection could not be opened.' } });
      }
    });
  }
  hosts.set(token, { mindPath, reopen });
  return () => hosts.delete(token);
}

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
  if (!input.mindPath || typeof input.mindPath !== 'string') fail(422, 'mind_not_configured', 'The M1ND is not configured.');
  const mindPath = path.resolve(input.mindPath);
  const info = await lstat(mindPath).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) fail(422, 'mind_not_configured', 'The M1ND is not configured.');
  const user = await lstat(path.join(mindPath, 'user')).catch(() => null);
  if (!user?.isDirectory()) fail(422, 'mind_not_configured', 'The M1ND is not configured.');
  const embedded = input.embedded === true;
  const hostOrigin = input.hostOrigin ?? null;
  if (embedded && !originOf(hostOrigin)) fail(422, 'invalid_body', 'An embedded host needs one http or https origin.');
  if (hostOrigin != null && !originOf(hostOrigin)) fail(422, 'invalid_body', 'The host origin must be one http or https origin.');
  if (input.look != null && !['modern', 'high-contrast', 'nebula', 'txmska', 'coffee-cat', 'ntk'].includes(input.look)) fail(422, 'invalid_body', 'The look is not supported.');
  if (input.language != null && !['en', 'es'].includes(input.language)) fail(422, 'invalid_body', 'The language is not supported.');
  // Only a caller that asks for confinement gets it: a real M1ND may live anywhere, OneDrive included.
  const confineRoot = input.confineRoot ?? null;
  const service = await connectService({ ...input, mindPath, confineRoot });
  let token = null;
  let stream = null;
  let untrack = null;
  let detachFolder = null;
  let folderWizard = null;
  let recoveryLauncher = null;
  let recovering = null;
  try {
    const auth = await call(service.origin.port, 'POST', '/api/v1/auth/local', {
      embedded,
      hostOrigin: embedded ? hostOrigin : input.hostOrigin ?? null,
      look: input.look ?? null,
      language: input.language ?? null,
    }, service.secret);
    const session = auth.json?.data;
    if (auth.status !== 201 || !session?.token || !session.viewerId || !session.url) {
      fail(auth.status ?? 503, auth.json?.error?.code ?? 'service_unavailable', 'The viewer could not sign in.');
    }
    token = session.token;
    let viewerId = session.viewerId;
    let generation = service.service.nonce;
    const handle = {
      origin: service.origin.origin,
      url: session.url,
      token,
      viewerId,
      embedded,
      capabilities: session.capabilities,
      dirty: false,
      look: input.look ?? null,
      language: input.language ?? null,
      stopped: false,
      get service() { return service.service; },
      serviceStatus: () => service.readiness(),
      recover() {
        if (handle.stopped) fail(401, 'invalid_session', 'The viewer session has ended.');
        recovering ??= (async () => {
          const principal = service.service.receiptPrincipals?.get(token) ?? token;
          const current = await service.recover();
          if (generation === current.handle.nonce && current.handle.credentials) current.handle.credentials.verify(token);
          const auth = await call(current.origin.port, 'POST', '/api/v1/auth/local', {
            embedded, hostOrigin, look: handle.look, language: handle.language,
          }, current.secret);
          const viewer = auth.json?.data;
          if (auth.status !== 201 || !viewer?.token || !viewer.viewerId) fail(503, 'service_unavailable', 'The recovered viewer could not sign in.');
          if (handle.stopped) {
            await call(current.origin.port, 'POST', '/api/v1/auth/logout', {}, viewer.token).catch(() => {});
            fail(401, 'invalid_session', 'The viewer session has ended.');
          }
          stream?.close(); untrack?.(); detachFolder?.();
          const oldToken = token;
          token = viewer.token; viewerId = viewer.viewerId;
          generation = current.handle.nonce;
          service.service.receiptPrincipals?.set(token, principal);
          Object.assign(handle, { token, viewerId, url: viewer.url, capabilities: viewer.capabilities });
          await call(current.origin.port, 'POST', '/api/v1/auth/logout', {}, oldToken).catch(() => {});
          if (handle.dirty) await patchViewer(current.origin.port, token, { dirty: true });
          bindFolder();
          recoveryLauncher?.bind();
          await watchViewer();
          return { origin: handle.origin, token, viewerId, capabilities: viewer.capabilities };
        })().finally(() => { recovering = null; });
        return recovering;
      },
      async setTheme(look) {
        if (!['modern', 'high-contrast', 'nebula', 'txmska', 'coffee-cat', 'ntk'].includes(look)) fail(422, 'invalid_body', 'The look is not supported.');
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
        await recovering?.catch(() => {});
        stream?.close();
        untrack?.();
        detachFolder?.();
        await recoveryLauncher?.close();
        await folderWizard?.close();
        await call(service.origin.port, 'POST', '/api/v1/auth/logout', null, token).catch(() => {});
        await service.release();
      },
    };
    const reopenFolder = createFolderReopen({ ...input, mindPath });
    const bindFolder = () => {
      if (!service.service.http) return;
      detachFolder = attachFolderReopen(service.service.http, token, mindPath, async () => {
        folderWizard = await reopenFolder();
        if (handle.stopped) {
          await folderWizard.close();
          fail(401, 'invalid_session', 'The viewer session has ended.');
        }
        return folderWizard;
      });
    };
    bindFolder();
    const watchViewer = async () => {
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
    };
    await watchViewer();
    if (service.service.http) recoveryLauncher = await attachRecoveryHost(handle, service);
    return handle;
  } catch (error) {
    stream?.close();
    untrack?.();
    detachFolder?.();
    await recoveryLauncher?.close();
    await folderWizard?.close();
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
  for (const launcher of [...recoveryLaunchers]) await launcher.close();
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
    req.setTimeout(30_000, () => req.destroy(new CoreError(503, 'service_unavailable', 'The service request timed out.')));
    if (payload) req.end(payload);
    else req.end();
  });
}
