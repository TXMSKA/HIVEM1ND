import { lstat, open, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CoreError, canonicalJson, isUuid, parseTaskId, parseUnitId } from './identity.mjs';
import { assertNoLinks } from './paths.mjs';
import { createAppTokenStore, protectLocalFile, verifyLocalPermissions } from './security.mjs';
import { atomicWrite } from './store.mjs';

const APP = Object.freeze({ id: 'hivem1nd', name: 'HIVEM1ND', kind: 'app' });
const MODES = ['fast', 'normal', 'thinking'];
const alias = name => typeof name === 'string' ? name.replace(/:latest$/, '') : '';
const fail = (code, status = 503) => { throw new CoreError(status, code, code === 'unsupported_launch_choice'
  ? 'The selected local model and mode cannot be applied.' : 'The local Lyra connection is unavailable.'); };

function lyraHome(options) {
  const env = options.env ?? process.env, home = options.home ?? os.homedir();
  if (env.LYRA_HOME) return path.resolve(env.LYRA_HOME);
  const root = process.platform === 'win32' ? env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return path.join(root, 'Cosmic', 'apps', 'Lyra');
}

async function privateRead(file, options, maximum) {
  await assertNoLinks(file);
  await verifyLocalPermissions(file, options);
  const handle = await open(file, 'r');
  try {
    const state = await handle.stat();
    if (!state.isFile() || state.nlink !== 1 || state.size > maximum
      || typeof process.getuid === 'function' && state.uid !== process.getuid()) fail('lyra_unavailable');
    const text = await handle.readFile('utf8');
    await assertNoLinks(file);
    const current = await lstat(file);
    if (current.dev !== state.dev || current.ino !== state.ino) fail('lyra_unavailable');
    return text;
  } finally { await handle.close(); }
}

async function responseJson(response) {
  if (response.status === 204) { await response.body?.cancel(); return undefined; }
  const reader = response.body?.getReader();
  if (!reader) fail('lyra_unavailable');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length; if (size > 1048576) fail('lyra_unavailable');
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function http(options, record, method, route, auth, body, signal) {
  const response = await (options.fetch ?? fetch)(`http://127.0.0.1:${record.port}${route}`, {
    method, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(options.requestTimeoutMs ?? 10000), ...(signal ? [signal] : [])]),
    headers: { 'Accept-Language': 'en', ...(auth ? { Authorization: auth } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const value = await responseJson(response);
  if (!response.ok) {
    const code = ['unauthenticated', 'pending', 'revoked', 'forbidden'].includes(value?.error?.code) ? value.error.code : 'lyra_unavailable';
    fail(code);
  }
  return value;
}

// Discovery reads the same private record as the installed shared client; it never starts Lyra.
export async function discoverLyra(options = {}) {
  try {
    const home = lyraHome(options), file = path.join(home, 'run', 'service.json');
    const source = await privateRead(file, options, 1048576), record = JSON.parse(source);
    if (record.version !== 1 || !Number.isSafeInteger(record.pid) || record.pid < 1
      || !Number.isSafeInteger(record.port) || record.port < 1 || record.port > 65535
      || typeof record.serviceVersion !== 'string' || !Number.isFinite(Date.parse(record.startedAt))) return null;
    if (options.verifyOwner) { if (await options.verifyOwner(record, home) !== true) return null; }
    else { try { process.kill(record.pid, 0); } catch { return null; } }
    const health = await http({ ...options, requestTimeoutMs: options.discoveryTimeoutMs ?? 1000 }, record, 'GET', '/v1/health');
    if (health?.ok !== true || health.serviceVersion !== record.serviceVersion || await readFile(file, 'utf8') !== source) return null;
    return { ...record, home };
  } catch { return null; }
}

function catalogModels(status) {
  if (status?.ollama?.running !== true || !Array.isArray(status.installed)) return [];
  const installed = new Set(status.installed.map(item => alias(item.name)));
  const models = [];
  if (installed.has('lyra-base') && ['fast', 'normal'].every(mode => alias(status.modes?.[mode]?.model) === 'lyra-base')) {
    models.push({ id: 'lyra-base', title: 'Lyra base', efforts: [], modes: ['fast', 'normal',
      ...(!installed.has('lyra-thinking') && alias(status.modes?.thinking?.model) === 'lyra-thinking' ? ['thinking'] : [])] });
  }
  if (installed.has('lyra-thinking') && alias(status.modes?.thinking?.model) === 'lyra-thinking') {
    models.push({ id: 'lyra-thinking', title: 'Lyra thinking', efforts: [], modes: ['thinking'] });
  }
  return models;
}

export function resolveLyraChoice(choice, status) {
  if (!choice || Object.keys(choice).sort().join(',') !== 'client,effort,mode,model'
    || choice.client !== 'lyra' || choice.effort !== null || !MODES.includes(choice.mode)) fail('unsupported_launch_choice', 422);
  const model = catalogModels(status).find(item => item.id === alias(choice.model) && item.modes.includes(choice.mode));
  if (!model) fail('unsupported_launch_choice', 422);
  return { ...choice, model: model.id };
}

const str = maximum => ({ type: 'string', minLength: 1, maxLength: maximum });
const uuid = str(36), revision = str(64), run = { runId: uuid }, request = { requestId: uuid };
const list = (items, maximum) => ({ type: 'array', items, maxItems: maximum });
const enumeration = values => ({ type: 'string', enum: values });
const roles = ['coordinator', 'planner', 'builder', 'reviewer'];
function definition(name, en, es, effect, properties, optional = []) {
  return { name, title: { en, es }, description: en, effect, private: true,
    inputSchema: { type: 'object', properties, required: Object.keys(properties).filter(key => !optional.includes(key)), additionalProperties: false } };
}

// C15 / T088 titles and the installed ToolProperty subset, not the MCP union schemas.
export function lyraToolDefinitions() {
  return [
    definition('m1nd_read', 'Read the M1ND', 'Leer el M1ND', 'read', { resourceId: str(512), cursor: str(300), limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['cursor', 'limit']),
    definition('message_send', 'Send a message', 'Enviar un mensaje', 'send', { recipientIds: list(str(256), 255), text: str(8000) }),
    definition('message_read', 'Read messages', 'Leer mensajes', 'change', { messageIds: list(uuid, 200) }),
    definition('plan_confirm_start', 'Confirm plan start', 'Confirmar el inicio del plan', 'change', { ...run, attemptId: uuid, ...request }),
    definition('plan_step', 'Report a step', 'Informar un paso', 'change', { ...run, attemptId: uuid, eventId: str(180), step: enumeration(['tests', 'build', 'edit', 'plan', 'review', 'work']), state: enumeration(['started', 'completed']), ...request }),
    definition('plan_report', 'Report a task', 'Informar una tarea', 'change', { ...run, attemptId: uuid, outcome: enumeration(['delivered', 'failed']), summary: str(8000), ...request }),
    definition('plan_dispatch', 'Dispatch a task', 'Asignar una tarea', 'change', { ...run, role: enumeration(roles), taskId: str(256), expectedRevision: revision, ...request }, ['taskId']),
    definition('plan_send', 'Send a message', 'Enviar un mensaje', 'send', { ...run, recipientRoles: list(enumeration(roles), 4), text: str(8000), ...request }),
    definition('plan_read', 'Read messages', 'Leer mensajes', 'change', { ...run, messageIds: list(uuid, 200), ...request }),
    definition('plan_extend', 'Request more messages', 'Solicitar más mensajes', 'change', { ...run, count: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, reason: str(8000), expectedRevision: revision, ...request }),
    definition('plan_agree', 'Agree more messages', 'Acordar más mensajes', 'change', { ...run, extensionId: uuid, expectedRevision: revision, ...request }),
    definition('file_read', 'Read a file', 'Leer un archivo', 'read', { path: str(4096), start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 0 } }),
    definition('file_write', 'Write a file', 'Escribir un archivo', 'change', { path: str(4096), expectedRevision: revision, text: { type: 'string', maxLength: 8000 } }, ['expectedRevision']),
  ];
}

function matches(schema, value) {
  if (schema.type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => Object.hasOwn(schema.properties, key) && matches(schema.properties[key], value[key]))
    && schema.required.every(key => Object.hasOwn(value, key));
  if (schema.type === 'array') return Array.isArray(value) && value.length > 0 && value.length <= schema.maxItems
    && new Set(value).size === value.length && value.every(item => matches(schema.items, item));
  if (schema.type === 'integer') return Number.isSafeInteger(value) && value >= (schema.minimum ?? 0) && value <= (schema.maximum ?? Number.MAX_SAFE_INTEGER);
  return typeof value === 'string' && Array.from(value).length >= (schema.minLength ?? 0)
    && Array.from(value).length <= (schema.maxLength ?? Infinity) && (!schema.enum || schema.enum.includes(value));
}

export function validateLyraInput(name, input) {
  const tool = lyraToolDefinitions().find(item => item.name === name);
  if (!tool || !matches(tool.inputSchema, input) || Buffer.byteLength(JSON.stringify(input)) > 8192) fail('invalid_body', 422);
  for (const key of ['runId', 'attemptId', 'extensionId', 'requestId']) if (Object.hasOwn(input, key) && !isUuid(input[key])) fail('invalid_body', 422);
  if (input.messageIds?.some(id => !isUuid(id))) fail('invalid_body', 422);
  for (const id of input.recipientIds ?? []) parseUnitId(id);
  if (Object.hasOwn(input, 'expectedRevision') && !/^[a-f0-9]{64}$/.test(input.expectedRevision)) fail('invalid_body', 422);
  if (Object.hasOwn(input, 'taskId')) parseTaskId(input.taskId);
  if (name === 'file_read' && (input.end < input.start || input.end - input.start > 8000)) fail('invalid_body', 422);
  return { ...input, ...(name === 'file_write' ? { expectedRevision: input.expectedRevision ?? null } : {}),
    ...(name === 'plan_dispatch' ? { taskId: input.taskId ?? null } : {}) };
}

const registrations = new Map();
const appRegistrations = new WeakMap();
export async function registerLyraTools(connection) {
  const key = `${connection.home}\0${connection.pid}\0${connection.startedAt}`;
  if (!registrations.has(key)) {
    const work = connection.call('PUT', '/v1/tools', { tools: lyraToolDefinitions() });
    registrations.set(key, work);
    work.catch(() => { if (registrations.get(key) === work) registrations.delete(key); });
  }
  await registrations.get(key);
}

async function connect(options, tokens, signal) {
  const record = await (options.discover ?? discoverLyra)(options);
  if (!record || !Number.isSafeInteger(record.port) || record.port < 1 || record.port > 65535
    || !Number.isSafeInteger(record.pid) || record.pid < 1 || typeof record.home !== 'string') fail('lyra_offline');
  let token = await tokens.get();
  const register = async () => {
    if (!appRegistrations.has(tokens)) {
      const work = Promise.resolve().then(async () => {
        const key = options.bootstrap ? await options.bootstrap(record) : await privateRead(path.join(record.home, 'secrets', 'bootstrap.key'), options, 43);
        if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key)) fail('lyra_unavailable');
        const result = await http(options, record, 'POST', '/v1/apps/register', `Bootstrap ${key}`, APP, signal);
        if (result?.app?.id !== APP.id || result.app.kind !== 'app') fail('lyra_unavailable');
        await tokens.set(result.token); return result.token;
      });
      appRegistrations.set(tokens, work);
    }
    const work = appRegistrations.get(tokens);
    try { token = await work; } finally { if (appRegistrations.get(tokens) === work) appRegistrations.delete(tokens); }
  };
  const reauthenticate = async () => {
    const latest = await tokens.get();
    if (latest && latest !== token) token = latest;
    else await register();
  };
  if (!token) await register();
  const call = async (method, route, body, operationSignal = signal) => {
    try { return await http(options, record, method, route, `Bearer ${token}`, body, operationSignal); }
    catch (error) {
      if (error.code !== 'unauthenticated') throw error;
      await reauthenticate();
      return http(options, record, method, route, `Bearer ${token}`, body, operationSignal);
    }
  };
  const current = await call('GET', '/v1/apps/current');
  if (current?.id !== APP.id || current.kind !== 'app') fail('lyra_unavailable');
  if (current.status !== 'granted') fail(current.status === 'revoked' ? 'lyra_revoked' : 'lyra_pending');
  if (!['chat', 'models', 'tools'].every(scope => current.scopes?.includes(scope))) fail('lyra_scopes_required');
  const isGranted = async () => {
    const app = await call('GET', '/v1/apps/current');
    return app?.id === APP.id && app.kind === 'app' && app.status === 'granted' && ['chat', 'models', 'tools'].every(scope => app.scopes?.includes(scope));
  };
  return { ...record, call, isGranted, async chat(body, signal) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await (options.fetch ?? fetch)(`http://127.0.0.1:${record.port}/v1/chat`, { method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', 'Accept-Language': body.language, Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      if (response.status !== 401 || attempt) {
        if (!response.ok) { await responseJson(response); fail('lyra_unavailable'); }
        return response;
      }
      await response.body?.cancel(); await reauthenticate();
      const app = await call('GET', '/v1/apps/current');
      if (app.status !== 'granted' || !['chat', 'models', 'tools'].every(scope => app.scopes?.includes(scope))) fail('lyra_revoked');
    }
  } };
}

function boundedRequest(input, choice, tools) {
  const messages = input.messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > 30 || messages.at(-1)?.role !== 'user'
    || messages.some(message => !message || Object.keys(message).sort().join(',') !== 'content,role'
      || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.length || message.content.length > 8000)
    || messages.reduce((sum, item) => sum + item.content.length, 0) > 16000 || typeof input.context !== 'string' || input.context.length > 12000
    || !['en', 'es'].includes(input.language) || !Array.isArray(tools) || tools.length > 16) fail('lyra_input_limit', 413);
  const body = { messages, mode: choice.mode, priority: 'background', context: input.context, language: input.language,
    memory: false, cloud: false, tools, speak: false };
  if (Buffer.byteLength(JSON.stringify(body)) > 100 * 1024) fail('lyra_input_limit', 413);
  return body;
}

async function* ndjson(body, signal) {
  const reader = body?.getReader(); if (!reader) fail('lyra_protocol_error');
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true }); let pending = '', size = 0;
  const parse = line => { if (Buffer.byteLength(line) > 65536) fail('lyra_protocol_error'); return JSON.parse(line); };
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length; if (size > 16 * 1024 * 1024) fail('lyra_protocol_error');
      pending += decoder.decode(part.value, { stream: true }); let end;
      while ((end = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, end); pending = pending.slice(end + 1); if (line.trim()) yield parse(line); }
      if (Buffer.byteLength(pending) > 65536) fail('lyra_protocol_error');
    }
    pending += decoder.decode(); if (pending.trim()) yield parse(pending);
  } finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function streamLyraTurn(connection, input, handlers = {}) {
  const controller = new AbortController();
  const tools = handlers.tools ?? [];
  // C15 always sends an explicit tool selection, which selects Lyra's 900-second tool turn.
  const limit = 905000;
  const deadline = setTimeout(() => controller.abort(), Math.min(limit, handlers.deadlineMs ?? limit));
  const signal = AbortSignal.any([controller.signal, ...(handlers.signal ? [handlers.signal] : [])]);
  const pending = new Map(); let terminal = false, started = false;
  try {
    const choice = resolveLyraChoice(input.choice, await connection.call('GET', '/v1/models', undefined, signal));
    const body = boundedRequest(input, choice, tools);
    const response = await connection.chat(body, signal);
    if (!/^application\/x-ndjson(?:;|$)/i.test(response.headers.get('content-type') ?? '')) { await response.body?.cancel(); fail('lyra_protocol_error'); }
    await handlers.onAccepted?.();
    for await (const event of ndjson(response.body, signal)) {
      signal.throwIfAborted();
      if (terminal || !event || typeof event.type !== 'string') fail('lyra_protocol_error');
      if (event.type === 'start') {
        if (started || event.mode !== choice.mode || alias(event.model) !== choice.model || event.provider !== 'local'
          || typeof event.fellBack !== 'boolean' || event.fellBack !== (choice.mode === 'thinking' && choice.model === 'lyra-base')) fail('unsupported_launch_choice', 422);
        started = true; await handlers.onStarted?.(event);
      } else if (event.type === 'error') {
        if (typeof event.code !== 'string') fail('lyra_protocol_error');
        terminal = true; fail(event.code === 'timeout' ? 'lyra_timeout' : 'lyra_turn_failed');
      } else if (!started) fail('lyra_protocol_error');
      else if (event.type === 'tool_call') {
        if (!isUuid(event.id) || !tools.includes(event.name) || !['allowed', 'ask'].includes(event.permission)) fail('lyra_protocol_error');
        const signature = canonicalJson(event);
        if (pending.has(event.id)) { if (pending.get(event.id).signature !== signature) fail('lyra_protocol_error'); continue; }
        validateLyraInput(event.name, event.input);
        const work = Promise.resolve().then(async () => {
          if (connection.isGranted && !await connection.isGranted()) fail('lyra_revoked');
          const result = await handlers.onToolCall(event, signal);
          signal.throwIfAborted();
          await connection.call('POST', `/v1/tool-calls/${event.id}/result`, result, signal);
        });
        pending.set(event.id, { signature, work });
        work.catch(() => controller.abort());
      } else if (event.type === 'text') { if (typeof event.text !== 'string' || event.text.length > 65536) fail('lyra_protocol_error'); }
      else if (event.type === 'done') terminal = true;
      else if (event.type !== 'thinking') fail('lyra_protocol_error');
      await handlers.onEvent?.(event);
    }
    if (!terminal || !started) fail('lyra_protocol_error');
    await Promise.all([...pending.values()].map(item => item.work));
    signal.throwIfAborted();
    return { ended: true, started: true };
  } catch (error) {
    if (handlers.signal?.aborted) fail('lyra_cancelled');
    if (controller.signal.aborted) fail('lyra_timeout');
    if (error instanceof CoreError) throw error;
    fail('lyra_protocol_error');
  } finally { clearTimeout(deadline); controller.abort(); await Promise.allSettled([...pending.values()].map(item => item.work)); }
}

export async function closeLyraTurn(turn) {
  turn?.controller.abort();
  await turn?.done;
  return { acknowledged: true };
}

export function openLyraAdapter(options = {}) {
  const sessions = new Map(); let tokens, authentication = Promise.resolve();
  const reconnect = (context, signal) => {
    tokens ??= options.tokens ?? createAppTokenStore(context);
    const work = authentication.catch(() => {}).then(() => connect({ ...options, store: context.store }, tokens, signal));
    authentication = work.then(() => {});
    authentication.catch(() => {});
    return work;
  };
  const adapter = {
    client: 'lyra', nativeSupport: true,
    capabilities: { create: true, resume: false, stop: true, exactApproval: true, modelSelection: true, scopedContent: true },
    async describe(context = {}) {
      try {
        const connection = await reconnect(context.paths ? context : { ...context, paths: { localDirectory: context.localDirectory } });
        const models = catalogModels(await connection.call('GET', '/v1/models'));
        return { id: 'lyra', title: 'Lyra', connected: models.length > 0, availability: models.length ? 'granted' : 'models-unavailable', models,
          quota: { known: false, remainingPercent: null, period: null }, scopeEnforced: true, context: { known: false, compact: false } };
      } catch (error) {
        return { id: 'lyra', title: 'Lyra', connected: false, availability: ['lyra_pending', 'lyra_revoked', 'lyra_scopes_required'].includes(error.code) ? error.code : 'lyra_offline',
          models: [], quota: { known: false, remainingPercent: null, period: null }, scopeEnforced: true, context: { known: false, compact: false } };
      }
    },
    async create(request) {
      if (!request.launchScope || request.runsIn?.client !== 'lyra') fail('scope_unavailable', 409);
      const context = { paths: { localDirectory: path.dirname(path.dirname(request.probeDirectory)) }, store: request.store ?? options.store };
      const connection = await reconnect(context);
      resolveLyraChoice(request.runsIn, await connection.call('GET', '/v1/models'));
      await registerLyraTools(connection);
      const nativeSessionId = randomUUID(), executionId = randomUUID();
      sessions.set(nativeSessionId, { request, connection, executionId, nativeSessionId, unitId: request.unitId, stopped: false, turn: null, messages: [] });
      return { nativeSessionId, executionId, pid: null, owned: true };
    },
    async confirm(proof) {
      const session = sessions.get(proof?.nativeSessionId);
      return Boolean(session && !session.stopped && proof.client === 'lyra' && (!proof.unitId || proof.unitId === session.unitId)
        && (!proof.executionId || proof.executionId === session.executionId));
    },
    async bindContent(proof, read) {
      if (!await this.confirm(proof)) fail('scope_unavailable', 409);
      sessions.get(proof.nativeSessionId).contentReader = read;
      return { bound: true };
    },
    async runtimeAvailable() { return false; },
    async registered(request, registration, context) {
      const session = sessions.get(registration.nativeSessionId);
      if (!session || session.unitId !== registration.unitId) fail('scope_unavailable', 409);
      session.context = context; session.registration = registration;
      const { bindLocalTools } = await import('./bridge.mjs');
      session.tools = await bindLocalTools({ ...context, localAppLive: () => session.turn?.connection?.isGranted() ?? true }, registration);
      startTurn(session, request.prompt ?? (request.taskId ? `Carry out assigned task ${request.taskId}.` : 'Read the M1ND and prepare for this conversation.'), request);
      return { pending: true };
    },
    async send(input) {
      const session = sessions.get(input.nativeSessionId);
      if (!session || session.stopped || input.unitId && input.unitId !== session.unitId) return { submitted: false };
      if (session.turn) return { submitted: false, deferred: true };
      const key = input.messageIds?.length ? canonicalJson(input.messageIds) : null;
      session.submissions ??= new Set();
      if (key && session.submissions.has(key)) return { submitted: true };
      const turn = startTurn(session, input.text, {});
      const result = await turn.accepted;
      if (result && key) session.submissions.add(key);
      return result ? { submitted: true } : { submitted: false };
    },
    async completeTask(input) {
      const session = sessions.get(input.nativeSessionId);
      if (!session || session.unitId !== input.unitId || session.stopped) fail('scope_unavailable', 409);
      session.taskTerminal = true;
      if (!session.turn) await session.context.localTaskEnded?.(session.registration);
      return { acknowledged: true };
    },
    async observe(input) {
      const session = sessions.get(input?.nativeSessionId);
      return { activity: session ? session.turn ? 'busy' : 'idle' : null, quota: null };
    },
    async stop(input) {
      const session = [...sessions.values()].find(item => item.executionId === input.executionId && (!input.sessionId || item.registration?.sessionId === input.sessionId));
      if (!input.owned || !session) return { acknowledged: false };
      session.stopped = true;
      await closeLyraTurn(session.turn);
      sessions.delete(session.nativeSessionId);
      return { acknowledged: true };
    },
    async close() {
      await Promise.all([...sessions.values()].map(async session => {
        session.stopped = true; await closeLyraTurn(session.turn);
        (session.context?.ownedExecutions ?? session.context?.store?.ownedExecutions)?.delete(session.executionId);
      }));
      sessions.clear();
    },
  };

  function startTurn(session, text, lifecycle) {
    const controller = new AbortController(); let accept;
    const accepted = new Promise(resolve => { accept = resolve; });
    const turn = { controller, accepted, done: null }; session.turn = turn;
    turn.done = Promise.resolve().then(async () => {
      await session.tools.verify();
      const connection = await reconnect(session.context, controller.signal);
      turn.connection = connection;
      await registerLyraTools(connection);
      const file = path.join(session.request.probeDirectory, 'lyra-context.json');
      await assertNoLinks(file);
      const saved = await privateRead(file, { store: session.context.store }, 100 * 1024).then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (saved && (saved.unitId !== session.unitId || saved.sessionId !== session.registration.sessionId)) fail('scope_unavailable', 409);
      let messages = [...(saved?.messages ?? session.messages), { role: 'user', content: text }];
      while (messages.length > 30 || messages.reduce((sum, message) => sum + message.content.length, 0) > 16000 && messages.length > 1) messages.shift();
      const context = JSON.stringify({ unitId: session.unitId, role: session.tools.role, taskId: session.request.taskId, resources: session.tools.resources });
      let output = '';
      const checkpoint = async () => {
        await atomicWrite(session.context.store, file, Buffer.from(canonicalJson({ unitId: session.unitId, sessionId: session.registration.sessionId, messages })));
        await protectLocalFile(file, { store: session.context.store });
      };
      boundedRequest({ messages, context, language: 'en' }, session.request.runsIn, session.tools.names);
      await checkpoint();
      await streamLyraTurn(connection, { messages, context, language: 'en', choice: session.request.runsIn }, {
        signal: controller.signal, tools: session.tools.names, deadlineMs: options.deadlineMs,
        onAccepted: () => accept(true),
        onStarted: event => { turn.started = true; return lifecycle.onLocalStarted?.(event); },
        onToolCall: (event, signal) => session.tools.call(event, signal),
        onEvent: async event => {
          if (event.type === 'text') output = (output + event.text).slice(0, 8000);
          await options.onEvent?.({ nativeSessionId: session.nativeSessionId, event });
        },
      });
      if (output) messages.push({ role: 'assistant', content: output });
      while (messages.length > 30 || messages.reduce((sum, message) => sum + message.content.length, 0) > 16000) messages.shift();
      await checkpoint(); session.messages = messages;
    }).catch(async error => { turn.failed = true; accept(false); await lifecycle.onLocalFailed?.(error); }).finally(async () => {
      controller.abort(); if (session.turn === turn) session.turn = null;
      if (turn.failed && !turn.started && !session.stopped) await lifecycle.onLocalAborted?.();
      if (session.taskTerminal && !session.stopped) await session.context.localTaskEnded?.(session.registration);
    });
    turn.done.catch(() => {});
    return turn;
  }
  return adapter;
}
