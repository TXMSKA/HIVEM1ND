import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, canonicalJson, hashText, isUuid } from './identity.mjs';
import { atomicWrite, withReceipt } from './store.mjs';
import { authorize, checkHost, checkLimits, checkOrigin, checkPeer, safeError } from './security.mjs';
import { readCollection, readDetail, readProjection } from './projection.mjs';
import { connectLead, createUnit, patchLayout, patchSettings } from './units.mjs';
import { createChat, patchChat, postChat, postMailbox, readChat, readMailbox } from './chats.mjs';
import { answerApproval, requestApproval, revokeGrant } from './approvals.mjs';
import { changeStatus, loadTask, reviewAuthority, undoStatus } from './tasks.mjs';
import { enqueueStart, stopSession } from './adapters.mjs';
import { createEventBus } from './events.mjs';
import { closeHome, exchange, openHome, status as homeStatus } from './home.mjs';
import { addNode, answerProposal, createAsset, createBoard, createComment, createText, list as listBoards, listComments, listProposals, readAsset, readAttachments, readEditor, registerResource, removeNode, replaceBoard, replaceRange, replaceText, replyComment, setCommentStatus, updateNode, writeAttachments } from './editors.mjs';
import { chatContains, createWatch, dispose as disposeWatch, disposeViewer, recordActivity, start as startWatch, stop as stopWatch } from './watch.mjs';
import { dispatch as dispatchMcp } from './mcp.mjs';

const PAGE_QUERY = ['limit', 'cursor', 'q', 'status', 'unitId', 'before'];
const STATIC_FILES = new Set([
  'index.html', 'styles.css', 'main.mjs', 'api.mjs', 'stream.mjs', 'state.mjs', 'i18n.mjs', 'components.mjs',
  'lists.mjs', 'map-geometry.mjs', 'map.mjs', 'hierarchy.mjs', 'chats.mjs', 'inspector.mjs', 'actions.mjs',
  'settings.mjs', 'qr.mjs', 'qr-render.mjs', 'phone.mjs', 'embed.mjs', 'editors.mjs', 'blueprint.mjs', 'void.mjs', 'markup.mjs',
]);

const ROUTES = [
  ['GET', '/view', 'read', 'DPA', 'view'],
  ['GET', '/units', 'read', 'DPA', 'collection', 'units'],
  ['GET', '/leads', 'read', 'DPA', 'collection', 'leads'],
  ['GET', '/squads', 'read', 'DPA', 'collection', 'squads'],
  ['GET', '/projects', 'read', 'DPA', 'collection', 'projects'],
  ['GET', '/machines', 'read', 'DPA', 'collection', 'machines'],
  ['GET', '/sync', 'read', 'DPA', 'collection', 'sync'],
  ['GET', '/sessions', 'read', 'DPA', 'collection', 'sessions'],
  ['GET', '/units/:unitId', 'read', 'DPA', 'detail', 'units'],
  ['POST', '/units', 'unit.create', 'D', 'createUnit'],
  ['PUT', '/units/:unitId/lead', 'unit.connect', 'D', 'connectLead'],
  ['POST', '/units/:unitId/session', 'session.start', 'D', 'enqueueStart'],
  ['GET', '/session-requests/:requestId', 'read', 'DPA', 'detail', 'sessions'],
  ['POST', '/sessions/:sessionId/stop', 'session.stop', 'D', 'stopSession'],
  ['GET', '/layout', 'read', 'DP', 'layout'],
  ['PATCH', '/layout', 'layout.write', 'D', 'patchLayout'],
  ['GET', '/chats', 'read', 'DPA', 'collection', 'chats'],
  ['GET', '/chats/:chatId', 'read', 'DPA', 'detail', 'chats'],
  ['GET', '/chats/:chatId/messages', 'read', 'DPA', 'collection', 'messages'],
  ['POST', '/chats', 'chat.manage', 'D', 'createChat'],
  ['POST', '/chats/:chatId/messages', 'chat.post', 'DPA', 'postChat'],
  ['POST', '/chats/:chatId/read', 'read', 'DPA', 'readChat'],
  ['PATCH', '/chats/:chatId', 'chat.manage', 'D', 'patchChat'],
  ['GET', '/mailboxes', 'read', 'DPA', 'collection', 'mailboxes'],
  ['GET', '/mailboxes/:unitId/messages', 'read', 'DPA', 'collection', 'messages'],
  ['GET', '/mailboxes/:unitId/messages/:messageId', 'read', 'DPA', 'detail', 'messages'],
  ['POST', '/mailboxes/:unitId/messages', 'chat.post', 'DPA', 'postMailbox'],
  ['POST', '/mailboxes/:unitId/read', 'read', 'DPA', 'readMailbox'],
  ['GET', '/approvals', 'read', 'DPA', 'collection', 'approvals'],
  ['GET', '/approvals/:approvalId', 'read', 'DPA', 'detail', 'approvals'],
  ['GET', '/approvals/:approvalId/answers/:answerId', 'read', 'DPA', 'detail', 'approvals'],
  ['POST', '/approvals/request', 'approval.request', 'A', 'requestApproval'],
  ['POST', '/approvals/:approvalId/answer', 'approval.answer', 'DP', 'answerApproval'],
  ['GET', '/units/:unitId/approval-grants', 'read', 'DP', 'collection', 'approvals'],
  ['DELETE', '/units/:unitId/approval-grants/:grantId', 'grant.revoke', 'D', 'revokeGrant'],
  ['GET', '/grant-revocations/:requestId', 'read', 'DP', 'detail', 'approvals'],
  ['GET', '/tasks', 'read', 'DPA', 'collection', 'tasks'],
  ['GET', '/tasks/:taskId', 'read', 'DPA', 'detail', 'tasks'],
  ['GET', '/waiting', 'read', 'DPA', 'collection', 'waiting'],
  ['POST', '/tasks/:taskId/status', 'task.status', 'DPA', 'changeStatus'],
  ['POST', '/tasks/:taskId/undo', 'task.undo', 'DA', 'undoStatus'],
  ['GET', '/settings', 'read', 'DP', 'settings'],
  ['PATCH', '/settings', 'settings.write', 'D', 'patchSettings'],
  ['POST', '/settings/home-network', 'home.manage', 'D', 'home'],
  ['POST', '/auth/local', null, '', 'authLocal'],
  ['POST', '/auth/home', null, '', 'authHome'],
  ['POST', '/auth/logout', null, 'DP', 'logout'],
  ['GET', '/blueprint/boards', 'editor.read', 'DPA', 'editor'],
  ['GET', '/blueprint/boards/:resourceId', 'editor.read', 'DPA', 'editor'],
  ['POST', '/editors/register', 'editor.write', 'D', 'editor'],
  ['POST', '/blueprint/boards', 'editor.write', 'D', 'editor'],
  ['PUT', '/blueprint/boards/:resourceId', 'editor.write', 'DA', 'editor'],
  ['POST', '/blueprint/boards/:resourceId/nodes', 'editor.write', 'DA', 'editor'],
  ['PATCH', '/blueprint/boards/:resourceId/nodes/:nodeId', 'editor.write', 'DA', 'editor'],
  ['DELETE', '/blueprint/boards/:resourceId/nodes/:nodeId', 'editor.write', 'DA', 'editor'],
  ['GET', '/void/texts', 'editor.read', 'DPA', 'editor'],
  ['GET', '/void/texts/:resourceId', 'editor.read', 'DPA', 'editor'],
  ['POST', '/void/texts', 'editor.write', 'D', 'editor'],
  ['PUT', '/void/texts/:resourceId', 'editor.write', 'DA', 'editor'],
  ['POST', '/void/texts/:resourceId/ranges', 'editor.write', 'DA', 'editor'],
  ['GET', '/void/texts/:resourceId/proposals', 'editor.read', 'DPA', 'editor'],
  ['POST', '/void/texts/:resourceId/proposals/:proposalId/answer', 'proposal.answer', 'D', 'editor'],
  ['GET', '/editors/:resourceId/attachments', 'editor.read', 'DPA', 'editor'],
  ['PUT', '/editors/:resourceId/attachments', 'editor.write', 'D', 'editor'],
  ['GET', '/editors/:resourceId/comments', 'editor.read', 'DPA', 'editor'],
  ['POST', '/editors/:resourceId/comments', 'comment.write', 'DA', 'editor'],
  ['POST', '/editors/:resourceId/comments/:threadId/replies', 'comment.write', 'DA', 'editor'],
  ['PATCH', '/editors/:resourceId/comments/:threadId', 'comment.write', 'DA', 'editor'],
  ['GET', '/editors/:resourceId/assets/:assetId', 'editor.read', 'DPA', 'editor'],
  ['POST', '/editors/:resourceId/assets', 'asset.write', 'D', 'editor'],
  ['POST', '/watch', 'watch', 'D', 'watch'],
  ['DELETE', '/watch/:watchId', 'watch', 'D', 'watch'],
  ['GET', '/viewer', 'read', 'D', 'readViewer'],
  ['PATCH', '/viewer', 'viewer.write', 'D', 'patchViewer'],
  ['GET', '/events', 'read', 'DPA', 'events'],
];

export function routeTable() {
  return ROUTES.map(([method, template, operation, audience, handler, collection]) => ({
    method, template, operation, audience, handler, collection: collection ?? null,
  }));
}

export function decodeId(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.includes('%') || raw.includes('/') || raw.includes('\\') || raw.includes('..')) {
    throw new CoreError(422, 'invalid_path', 'The path id is not canonical.');
  }
  return raw;
}

export async function readJsonBody(req, { expect = 'any', limit = 1000000 } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new CoreError(413, 'request_too_large', 'The body is too large.');
    chunks.push(chunk);
  }
  if (size === 0) {
    if (expect === 'json') throw new CoreError(422, 'invalid_body', 'A JSON body is required.');
    return null;
  }
  if (expect === 'none') throw new CoreError(422, 'invalid_body', 'This route does not accept a body.');
  const type = String(req.headers['content-type'] ?? '');
  if (!type.startsWith('application/json')) throw new CoreError(415, 'invalid_body', 'Content-Type must be application/json.');
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new CoreError(422, 'invalid_body', 'The body must be a JSON object.');
    return parsed;
  } catch (error) {
    if (error instanceof CoreError) throw error;
    throw new CoreError(422, 'invalid_body', 'The body is not JSON.');
  }
}

export function respond(res, status, body, headers = {}) {
  const extra = {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  };
  if (status === 204) {
    res.writeHead(204, extra);
    res.end();
    return;
  }
  if (Buffer.isBuffer(body)) {
    res.writeHead(status, { ...extra, 'content-type': extra['content-type'] ?? 'application/octet-stream' });
    res.end(body);
    return;
  }
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { ...extra, 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

export async function serveStatic(assetDir, name) {
  if (!assetDir) throw new CoreError(503, 'service_unavailable', 'The browser shell is not packaged.');
  if (!STATIC_FILES.has(name)) throw new CoreError(404, 'not_found', 'The asset is not available.');
  const root = await realpath(assetDir).catch(() => { throw new CoreError(503, 'service_unavailable', 'The browser shell is not packaged.'); });
  const target = path.resolve(root, name);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new CoreError(404, 'not_found', 'The asset is not available.');
  const bytes = await readFile(target).catch((error) => {
    if (error?.code === 'ENOENT') throw new CoreError(503, 'service_unavailable', 'The browser shell is not packaged.');
    throw error;
  });
  return bytes;
}

export function serveEvents(res, bus, principal, cursor) {
  const headers = {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    connection: 'keep-alive',
  };
  res.writeHead(200, headers);
  res.flushHeaders();
  const subscriber = bus.subscribe(principal, {}, (frame) => {
    res.write(`event: ${frame.name}\ndata: ${JSON.stringify(frame.data)}\n\n`);
  });
  bus.replay(subscriber, cursor ?? null);
  return subscriber;
}

export async function createHttpServer(options) {
  const bus = options.bus ?? createEventBus({ now: options.now ?? (() => Date.now()), machine: options.paths?.machine ?? 'DESKTOP' });
  const credentials = options.credentials;
  const viewers = new Map();
  const watch = createWatch({ bus, now: options.now ?? (() => Date.now()) });
  options.watch = watch;
  const homeMemory = new Map();
  const homeState = {
    grant: null,
    credentials,
    bus,
    now: options.now ?? (() => Date.now()),
    interfaces: options.interfaces,
    listen: options.listen,
    schedule: options.schedule,
    bucket: { peers: new Map(), grantFailures: [] },
  };
  const bucket = { requests: [], streams: new Set(), peers: new Map(), grantFailures: [] };
  const compiled = routeTable().map(compile);
  const sockets = new Set();
  const server = createServer((req, res) => {
    dispatch(req, res).catch(async (error) => {
      if (res.headersSent || res.writableEnded) {
        res.destroy();
        return;
      }
      for await (const chunk of req) void chunk;
      const status = error instanceof CoreError ? error.status : 500;
      const headers = {};
      if (error?.retryAt) headers['retry-after'] = retryAfter(error.retryAt, options.now?.() ?? Date.now());
      if (error?.allow) headers.allow = error.allow;
      respond(res, status, safeError(error, randomUUID()), headers);
    });
  });

  async function dispatch(req, res) {
    const requestId = headerOne(req, 'x-request-id') ?? randomUUID();
    if (headerOne(req, 'x-request-id') && !isUuid(requestId)) throw new CoreError(422, 'invalid_body', 'The request id must be a UUID.');
    const eventCursor = headerOne(req, 'last-event-id') ?? null;
    const requested = splitTarget(req.url ?? '/');
    const listener = listenerOf(options, server);
    checkPeer(req.socket.remoteAddress, listener);
    checkHost(headerOne(req, 'host'), listener);
    const write = req.method !== 'GET' && req.method !== 'HEAD';
    checkOrigin(headerOne(req, 'origin') ?? null, listener, { write });
    const headerBytes = Object.entries(req.headers).reduce((sum, [key, value]) => sum + key.length + String(value).length, 0);
    checkLimits(bucket, { url: req.url ?? '', headerBytes, stream: requested.path === '/api/v1/events' }, options.now?.() ?? Date.now());
    if (requested.path === '/mcp') {
      await serveMcp(req, res, options, credentials);
      return;
    }
    if (requested.path.startsWith('/app/') || requested.path === '/' || requested.path.startsWith('/gui/')) {
      await serveEdge(req, res, requested.path, { assetDir: options.assetDir, viewers });
      return;
    }
    if (!requested.path.startsWith('/api/v1/') && requested.path !== '/api/v1') throw new CoreError(404, 'not_found', 'The route does not exist.');
    const relative = requested.path.slice('/api/v1'.length) || '/';
    const query = parseQuery(requested.search);
    const matches = compiled.filter((route) => route.regex.test(relative));
    if (matches.length === 0) throw new CoreError(404, 'not_found', 'The route does not exist.');
    const route = matches.find((item) => item.method === req.method);
    if (!route) {
      const error = new CoreError(405, 'method_not_allowed', 'The method is not allowed.');
      error.allow = [...new Set(matches.map((item) => item.method))].join(', ');
      throw error;
    }
    const params = paramsOf(route, relative);
    const bodyLimit = route.template.endsWith('/assets') ? 16000000 : 1000000;
    const body = await readJsonBody(req, { expect: bodyExpect(route, req.method), limit: bodyLimit });
    rejectUnknown(route, body);
    const credential = credentialFor(req, route, credentials, listener);
    const domain = domainContext(options, credential, bus);
    const object = await objectFor(route, domain, credential, params, body);
    const operation = operationFor(route, credential, body);
    if (operation) authorize(credential, operation, object);
    if (route.handler === 'events') {
      const principal = { ...domain.principal, stableId: credential.token, audience: credential.audience, viewerId: credential.viewerId ?? null };
      const subscriber = serveEvents(res, bus, principal, eventCursor);
      bucket.streams.add(subscriber);
      req.on('close', () => {
        bus.release(subscriber);
        bucket.streams.delete(subscriber);
      });
      return;
    }
    if (route.handler === 'authLocal' || route.handler === 'authHome' || route.handler === 'logout') {
      const outcome = await runAuth(route, { credentials, credential, listener, viewers, bus, body, options, homeState, peer: req.socket.remoteAddress, watch });
      respond(res, outcome.status, outcome.body ?? undefined, outcome.headers);
      return;
    }
    const run = () => invoke(route, { domain, params, query, body, credential, viewers, bus, options, homeState });
    if (route.handler === 'home') {
      const outcome = await rememberHome(homeMemory, credential, req, relative, body, requestId, run);
      respond(res, outcome.status ?? 200, { data: outcome.body, meta: { requestId, replayed: outcome.replayed === true }, sync: null });
      return;
    }
    const outcome = route.method === 'GET'
      ? await run()
      : await mutate(options, credential, req, relative, body, requestId, eventCursor, run);
    if (outcome.status === 204) {
      respond(res, 204);
      return;
    }
    if (outcome.raw) {
      res.writeHead(outcome.status ?? 200, {
        'content-type': outcome.type,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(outcome.raw);
      return;
    }
    const envelope = {
      data: outcome.body,
      meta: { requestId, replayed: outcome.replayed === true },
      sync: outcome.sync ?? null,
    };
    respond(res, outcome.status ?? 200, envelope);
  }

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await listen(server, options.host ?? '127.0.0.1', options.port ?? 0);
  return {
    server,
    bus,
    credentials,
    port: server.address().port,
    viewers,
    async close() {
      disposeWatch(watch);
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

function splitTarget(value) {
  const queryAt = value.indexOf('?');
  const path = queryAt === -1 ? value : value.slice(0, queryAt);
  const search = queryAt === -1 ? '' : value.slice(queryAt);
  if (path.includes('\\') || path.includes('//')) throw new CoreError(422, 'invalid_path', 'The path id is not canonical.');
  return { path, search };
}

async function serveMcp(req, res, options, credentials) {
  if (req.method !== 'POST') {
    const error = new CoreError(405, 'method_not_allowed', 'The method is not allowed.');
    error.allow = 'POST';
    throw error;
  }
  const accept = headerOne(req, 'accept') ?? '';
  if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
    throw new CoreError(406, 'invalid_body', 'Accept must include application/json and text/event-stream.');
  }
  const header = headerOne(req, 'authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const credential = token ? credentials.verify(token) : null;
  if (!credential) throw new CoreError(401, 'unauthorized', 'The credential is not valid.');
  let message;
  try {
    message = JSON.parse((await readRaw(req)).toString('utf8') || 'null');
  } catch {
    respond(res, 200, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  const type = String(req.headers['content-type'] ?? '');
  if (!type.startsWith('application/json')) throw new CoreError(415, 'invalid_body', 'Content-Type must be application/json.');
  const domain = domainContext(options, credential, options.bus);
  domain.credential = credential;
  const outcome = await dispatchMcp(domain, message);
  if (outcome.notification) {
    res.writeHead(202, { 'cache-control': 'no-store' });
    res.end();
    return;
  }
  respond(res, 200, outcome);
}

async function readRaw(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1000000) throw new CoreError(413, 'request_too_large', 'The body is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function serveEdge(req, res, pathname, { assetDir, viewers }) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const error = new CoreError(405, 'method_not_allowed', 'The method is not allowed.');
    error.allow = 'GET';
    throw error;
  }
  let name = 'index.html';
  if (pathname.startsWith('/gui/')) {
    const viewerId = decodeId(decodeURIComponent(pathname.split('/')[2] ?? ''));
    if (!viewers.has(viewerId)) throw new CoreError(404, 'not_found', 'The viewer does not exist.');
  } else if (pathname.startsWith('/app/')) {
    name = decodeStatic(pathname.slice('/app/'.length));
  }
  const bytes = await serveStatic(assetDir, name);
  respond(res, 200, bytes, {
    'content-type': contentType(name),
    'content-security-policy': csp(),
    'x-frame-options': 'DENY',
  });
}

function compile(route) {
  const names = [];
  const pattern = route.template.replace(/:([A-Za-z]+)/g, (_, name) => {
    names.push(name);
    return '([^/]+)';
  });
  return { ...route, names, regex: new RegExp(`^${pattern}$`) };
}

function paramsOf(route, relative) {
  const match = route.regex.exec(relative);
  const params = {};
  route.names.forEach((name, index) => {
    let decoded = match[index + 1];
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      throw new CoreError(422, 'invalid_path', 'The path id is not canonical.');
    }
    params[name] = decodeId(decoded);
  });
  return params;
}

function parseQuery(search) {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (raw.length === 0) return {};
  const query = {};
  for (const part of raw.split('&')) {
    const [key, value = ''] = part.split('=');
    if (query[key] !== undefined) throw new CoreError(422, 'invalid_query', 'A query field is repeated.');
    query[decodeURIComponent(key)] = decodeURIComponent(value);
  }
  return query;
}

function credentialFor(req, route, credentials, listener) {
  if (route.handler === 'authLocal') {
    if (listener.kind !== 'loopback') throw new CoreError(403, 'forbidden', 'Local login is only available on loopback.');
    return null;
  }
  if (route.handler === 'authHome') return null;
  const header = headerOne(req, 'authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new CoreError(401, 'unauthorized', 'The credential is not valid.');
  const record = credentials.verify(token);
  const audiences = expandAudience(route.audience);
  if (audiences.length > 0 && !audiences.includes(record.audience)) throw new CoreError(403, 'forbidden', 'The credential cannot call this route.');
  return record;
}

function expandAudience(value) {
  return value.split('').map((letter) => ({ D: 'desktop', P: 'phone', A: 'agent' }[letter])).filter(Boolean);
}

function operationFor(route, credential, body) {
  if (route.handler === 'changeStatus' && credential?.audience === 'phone') {
    if (body?.status === 'done') return 'task.accept';
    if (body?.status === 'open') return 'task.send-back';
    throw new CoreError(403, 'phone_read_only', 'Phone cannot change that.');
  }
  return route.operation;
}

async function objectFor(route, domain, credential, params, body) {
  if (credential?.audience === 'agent' && route.operation === 'read') return { scope: 'own', unitId: credential.unitId };
  if (route.handler === 'changeStatus' && credential?.audience === 'phone') {
    const task = await loadTask(domain, params.taskId);
    const reviewable = reviewAuthority(task).reviewable;
    if (body?.status === 'done') return { reviewable };
    if (body?.status === 'open') return { reviewable };
    throw new CoreError(403, 'phone_read_only', 'Phone cannot change that.');
  }
  if (route.operation === 'task.status' && credential?.audience === 'agent') return { unitId: credential.unitId };
  if (route.operation === 'mailbox.read') return { unitId: params.unitId ?? credential?.unitId };
  if (route.operation === 'approval.request') return { unitId: credential?.unitId };
  if (route.operation === 'editor.write' || route.operation === 'comment.write') return { attached: credential?.attached === true };
  return {};
}

function bodyExpect(route) {
  if (route.method === 'GET' || route.handler === 'events') return 'none';
  if (route.handler === 'logout' || route.handler === 'stopSession') return 'any';
  return 'json';
}

function rejectUnknown(route, body) {
  if (!body) return;
  const allowed = allowedBody(route.handler);
  if (!allowed) return;
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw new CoreError(422, 'invalid_body', 'The body contains an unknown field.');
  }
}

function allowedBody(handler) {
  const table = {
    createUnit: ['unit', 'role', 'scope', 'machine', 'leadId', 'job', 'model', 'position'],
    patchSettings: ['look', 'language', 'expectedRevision'],
    patchLayout: ['nodes', 'groups', 'expectedRevision'],
    patchViewer: ['presentation', 'dirty', 'look', 'language'],
    createChat: ['members', 'title'],
    authLocal: [],
    authHome: ['key', 'code'],
    home: ['enabled', 'addresses'],
  };
  return table[handler] ? new Set(table[handler]) : null;
}

function domainContext(options, credential, bus) {
  const audience = credential?.audience ?? 'desktop';
  return {
    store: options.store,
    paths: options.paths,
    now: options.now ?? (() => Date.now()),
    bus,
    projects: options.projects ?? [],
    watch: options.watch ?? null,
    ownedPids: options.ownedPids ?? new Set(),
    aliases: options.aliases ?? [],
    principal: {
      unitId: audience === 'agent' ? credential.unitId : 'root:master',
      audience,
      stableId: credential?.token ?? null,
      viewerId: credential?.viewerId ?? null,
    },
  };
}

function noteActivity(domain, resourceId) {
  if (!domain.watch || !resourceId) return;
  recordActivity(domain.watch, { unitId: domain.principal?.unitId, resourceId, at: new Date(domain.now()).toISOString() });
}

async function editorRoute(route, domain, params, query, body) {
  const id = params.resourceId;
  if (route.template === '/blueprint/boards' && route.method === 'GET') return { status: 200, body: await listBoards(domain, { ...query, kind: 'blueprint' }) };
  if (route.template === '/void/texts' && route.method === 'GET') return { status: 200, body: await listBoards(domain, { ...query, kind: 'void' }) };
  if ((route.template === '/blueprint/boards/:resourceId' || route.template === '/void/texts/:resourceId') && route.method === 'GET') return { status: 200, body: await readEditor(domain, id) };
  if (route.template === '/editors/register') return { status: 201, body: await registerResource(domain, body) };
  if (route.template === '/blueprint/boards' && route.method === 'POST') return { status: 201, body: await createBoard(domain, body) };
  if (route.template === '/void/texts' && route.method === 'POST') return { status: 201, body: await createText(domain, body) };
  if (route.template === '/blueprint/boards/:resourceId' && route.method === 'PUT') return { status: 200, body: await replaceBoard(domain, id, body) };
  if (route.template === '/void/texts/:resourceId' && route.method === 'PUT') {
    const saved = await replaceText(domain, id, body);
    noteActivity(domain, id);
    return { status: 200, body: saved };
  }
  if (route.template === '/void/texts/:resourceId/ranges') {
    const saved = await replaceRange(domain, id, body);
    noteActivity(domain, id);
    return { status: 200, body: saved };
  }
  if (route.template === '/void/texts/:resourceId/proposals') return { status: 200, body: await listProposals(domain, id, query) };
  if (route.template === '/void/texts/:resourceId/proposals/:proposalId/answer') return { status: 200, body: await answerProposal(domain, id, params.proposalId, body) };
  if (route.template === '/blueprint/boards/:resourceId/nodes') return { status: 201, body: await addNode(domain, id, body) };
  if (route.template === '/blueprint/boards/:resourceId/nodes/:nodeId' && route.method === 'PATCH') return { status: 200, body: await updateNode(domain, id, params.nodeId, body) };
  if (route.template === '/blueprint/boards/:resourceId/nodes/:nodeId' && route.method === 'DELETE') return { status: 200, body: await removeNode(domain, id, params.nodeId, body) };
  if (route.template === '/editors/:resourceId/attachments' && route.method === 'GET') return { status: 200, body: await readAttachments(domain, id) };
  if (route.template === '/editors/:resourceId/attachments' && route.method === 'PUT') return { status: 200, body: await writeAttachments(domain, id, body) };
  if (route.template === '/editors/:resourceId/comments' && route.method === 'GET') return { status: 200, body: await listComments(domain, id, query) };
  if (route.template === '/editors/:resourceId/comments' && route.method === 'POST') {
    const saved = await createComment(domain, id, body);
    noteActivity(domain, id);
    return { status: 201, body: saved };
  }
  if (route.template === '/editors/:resourceId/comments/:threadId/replies') {
    const saved = await replyComment(domain, id, params.threadId, body);
    noteActivity(domain, id);
    return { status: 200, body: saved };
  }
  if (route.template === '/editors/:resourceId/comments/:threadId') return { status: 200, body: await setCommentStatus(domain, id, params.threadId, body) };
  if (route.template === '/editors/:resourceId/assets') return { status: 201, body: await createAsset(domain, id, body) };
  if (route.template === '/editors/:resourceId/assets/:assetId') {
    const asset = await readAsset(domain, id, params.assetId);
    return { status: 200, raw: asset.bytes, type: asset.type };
  }
  throw new CoreError(404, 'not_found', 'The route does not exist.');
}

async function watchRoute(route, domain, params, body, credential) {
  if (!domain.watch) throw new CoreError(503, 'service_unavailable', 'That capability is not available yet.');
  if (route.method === 'DELETE') {
    stopWatch(domain.watch, params.watchId);
    return { status: 204, body: null };
  }
  let attached = true;
  if (body?.resourceId) {
    const editor = await readEditor(domain, body.resourceId).catch(() => null);
    attached = Boolean(editor && (editor.attached ?? []).includes(body.unitId));
  }
  const chatMember = body?.chatId ? await chatContains(domain, body.chatId, body.unitId) : true;
  const opened = await startWatch(domain.watch, {
    viewerId: credential.viewerId,
    token: credential.token,
    unitId: body?.unitId,
    resourceId: body?.resourceId ?? null,
    chatId: body?.chatId ?? null,
    attached,
    chatMember,
  });
  return { status: 200, body: opened };
}

async function invoke(route, scope) {
  const { domain, params, query, body, credential, viewers, options, homeState } = scope;
  validateQuery(route, query);
  if (route.handler === 'editor') return editorRoute(route, domain, params, query, body, credential);
  if (route.handler === 'watch') return watchRoute(route, domain, params, body, credential);
  if (route.handler === 'unavailable') {
    const injected = options.handlers?.[route.template];
    if (!injected) throw new CoreError(503, 'service_unavailable', 'That capability is not available yet.');
    return injected({ domain, params, query, body, credential });
  }
  if (route.handler === 'view') return { status: 200, body: await readProjection(domain, numbers(query)) };
  if (route.handler === 'collection') return { status: 200, body: await readCollection(domain, route.collection, numbers(query)) };
  if (route.handler === 'detail') return { status: 200, body: await readDetail(domain, route.collection, params.unitId ?? params.chatId ?? params.taskId ?? params.approvalId ?? params.requestId ?? params.messageId) };
  if (route.handler === 'layout') return { status: 200, body: await readDetail(domain, 'layout') };
  if (route.handler === 'settings') {
    const detail = safeSettings(await readDetail(domain, 'settings'), credential);
    return { status: 200, body: { ...detail, home: homeStatus(homeState) } };
  }
  if (route.handler === 'createUnit') {
    await createUnit(domain, body);
    return { status: 201, body: { unit: body.unit, role: body.role } };
  }
  if (route.handler === 'connectLead') {
    await connectLead(domain, params.unitId, body);
    return { status: 200, body: { unitId: params.unitId, leadId: body.leadId ?? null } };
  }
  if (route.handler === 'enqueueStart') return { status: 202, body: await enqueueStart(domain, { ...body, unitId: params.unitId }) };
  if (route.handler === 'stopSession') return { status: 200, body: await stopSession(domain, params.sessionId) };
  if (route.handler === 'patchLayout') {
    await patchLayout(domain, body);
    return { status: 200, body: await readDetail(domain, 'layout') };
  }
  if (route.handler === 'createChat') return { status: 201, body: await createChat(domain, body) };
  if (route.handler === 'postChat') return { status: 201, body: await postChat(domain, params.chatId, body) };
  if (route.handler === 'readChat') return { status: 200, body: await readChat(domain, params.chatId, body ?? {}) };
  if (route.handler === 'patchChat') return { status: 200, body: await patchChat(domain, params.chatId, body) };
  if (route.handler === 'postMailbox') return { status: 201, body: await postMailbox(domain, params.unitId, body) };
  if (route.handler === 'readMailbox') return { status: 200, body: await readMailbox(domain, params.unitId, body ?? {}) };
  if (route.handler === 'requestApproval') return { status: 201, body: await requestApproval(domain, body) };
  if (route.handler === 'answerApproval') return { status: 200, body: await answerApproval(domain, params.approvalId, body) };
  if (route.handler === 'revokeGrant') return { status: 200, body: await revokeGrant(domain, params.unitId, params.grantId, body ?? {}) };
  if (route.handler === 'changeStatus') {
    const operation = credential.audience === 'phone' ? (body.status === 'done' ? 'task.accept' : 'task.send-back') : 'task.status';
    void operation;
    return { status: 200, body: await changeStatus(domain, params.taskId, body) };
  }
  if (route.handler === 'undoStatus') return { status: 200, body: await undoStatus(domain, params.taskId, body) };
  if (route.handler === 'home') {
    if (body.enabled === true) return { status: 201, body: await openHome(homeState, body) };
    if (body.enabled === false) return { status: 200, body: await closeHome(homeState) };
    throw new CoreError(422, 'invalid_body', 'Home control needs enabled.');
  }
  if (route.handler === 'patchSettings') {
    await patchSettings(domain, body);
    return { status: 200, body: await readDetail(domain, 'settings') };
  }
  if (route.handler === 'readViewer') return { status: 200, body: viewers.get(credential.viewerId) ?? { presentation: null, dirty: false } };
  if (route.handler === 'patchViewer') {
    const current = { ...(viewers.get(credential.viewerId) ?? {}), ...body };
    viewers.set(credential.viewerId, current);
    scope.bus.emit({ name: 'viewer.changed', viewerId: credential.viewerId, data: { viewerId: credential.viewerId } });
    return { status: 200, body: current };
  }
  throw new CoreError(503, 'service_unavailable', 'That capability is not available yet.');
}

function validateQuery(route, query) {
  const page = route.handler === 'editor' ? [...PAGE_QUERY, 'project', 'kind'] : PAGE_QUERY;
  const allowed = route.method === 'GET' && route.handler !== 'detail' && route.handler !== 'layout' && route.handler !== 'settings' && route.handler !== 'readViewer' && route.handler !== 'events'
    ? new Set(page)
    : new Set();
  for (const key of Object.keys(query)) {
    if (!allowed.has(key)) throw new CoreError(422, 'invalid_query', 'The query contains an unknown field.');
  }
}

function numbers(query) {
  const next = { ...query };
  if (next.limit !== undefined) next.limit = Number(next.limit);
  return next;
}

function safeSettings(detail, credential) {
  if (credential?.audience !== 'phone') return detail;
  const settings = detail.settings ?? {};
  return { settings: { look: settings.look ?? null, language: settings.language ?? null }, revision: detail.revision };
}

async function rememberHome(memory, credential, req, relative, body, requestId, run) {
  const key = headerOne(req, 'idempotency-key');
  if (!isUuid(key)) throw new CoreError(400, 'idempotency_required', 'Idempotency-Key must be a UUID.');
  const bodyHash = hashText(canonicalJson(body));
  const prior = memory.get(`${credential.token}:${key}`);
  if (prior && (prior.path !== relative || prior.bodyHash !== bodyHash)) throw new CoreError(409, 'idempotency_conflict', 'This idempotency key was already used with a different request.');
  if (prior) return { ...prior.outcome, replayed: true };
  const outcome = await run();
  memory.set(`${credential.token}:${key}`, { path: relative, bodyHash, outcome });
  void requestId;
  return outcome;
}

async function mutate(options, credential, req, relative, body, requestId, eventCursor, run) {
  const key = headerOne(req, 'idempotency-key');
  if (!isUuid(key)) throw new CoreError(400, 'idempotency_required', 'Idempotency-Key must be a UUID.');
  return withReceipt(options.store, {
    principal: credential.token,
    key,
    method: req.method,
    path: relative,
    body,
    requestId,
    eventCursor,
  }, async (receipt) => {
    const outcome = await run();
    await atomicWrite(options.store, path.join(options.store.localDirectory, 'receipts', receipt.principalHash, `${receipt.key}.json`), Buffer.from(`${canonicalJson({
      ...receipt,
      status: outcome.status ?? 200,
      response: outcome.body ?? null,
    })}\n`));
    return outcome;
  });
}

async function runAuth(route, scope) {
  if (route.handler === 'authLocal') {
    const viewerId = randomUUID();
    const issued = scope.credentials.issue({
      audience: 'desktop',
      unitId: 'root:master',
      viewerId,
      expiresAt: new Date((scope.options.now?.() ?? Date.now()) + 12 * 60 * 60 * 1000).toISOString(),
    });
    scope.viewers.set(viewerId, { presentation: null, dirty: false });
    return { status: 200, body: { token: issued.token, capabilities: issued.capabilities, viewerId } };
  }
  if (route.handler === 'authHome') {
    if (scope.listener.kind !== 'lan') throw new CoreError(403, 'forbidden', 'Home exchange is only available on the home network.');
    return { status: 200, body: await exchange(scope.homeState, scope.body, scope.peer) };
  }
  scope.credentials.revoke(scope.credential.token);
  if (scope.watch) disposeViewer(scope.watch, scope.credential.token);
  scope.bus.closePrincipal(scope.credential.token);
  scope.viewers.delete(scope.credential.viewerId);
  return { status: 204, body: null };
}

function listenerOf(options, server) {
  const address = server.address();
  return {
    kind: options.listenerKind ?? 'loopback',
    address: options.bindAddress ?? '127.0.0.1',
    port: address?.port,
    netmask: options.netmask ?? '255.255.255.255',
  };
}

function headerOne(req, name) {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value ?? null;
}

function retryAfter(retryAt, now) {
  const seconds = Math.ceil((Date.parse(retryAt) - now) / 1000);
  return String(Math.max(1, seconds));
}

function contentType(name) {
  if (name.endsWith('.css')) return 'text/css; charset=utf-8';
  if (name.endsWith('.mjs') || name.endsWith('.js')) return 'text/javascript; charset=utf-8';
  return 'text/html; charset=utf-8';
}

function csp() {
  return "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
}

function decodeStatic(name) {
  if (name.includes('%') || name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new CoreError(404, 'not_found', 'The asset is not available.');
  }
  return name;
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
}
