import { lstat, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CLIENTS, CoreError, canonicalJson, hashBytes, parseUnitId, uuidV8 } from './identity.mjs';
import { answersFor } from './projection.mjs';
import { cursorAgentCommand } from '../relay/cursor-wake.mjs';
import { commitTransaction, readBytes, revisionOf } from './store.mjs';
import { withLocks } from './store.mjs';

const LIFETIME_MS = 120000;
const PROMPT_MAX = 100000;
const TERMINAL = new Set(['started', 'failed', 'expired']);
const STARTABLE = new Set(CLIENTS);

export async function probeClients(options = {}) {
  const env = options.env ?? process.env;
  const found = {
    claude: await findExecutable('claude', env),
    codex: await findExecutable('codex', env),
    cursor: await findExecutable('agent', env),
  };
  const cursor = await cursorAgentCommand({ env, platform: options.platform ?? process.platform });
  const reports = {};
  for (const client of CLIENTS) {
    const command = client === 'cursor' ? (path.isAbsolute(cursor.command) ? cursor.command : null) : found[client];
    const installed = Boolean(command);
    let version = null;
    if (installed && options.spawnVersion === true && !String(command).toLowerCase().endsWith('.cmd')) {
      version = await versionOf(command, client === 'cursor' ? cursor.args : [], options);
    }
    reports[client] = {
      client,
      installed,
      command: installed ? command : null,
      version,
      nativeSupport: false,
      reason: installed ? 'native_login_unverified' : 'client_unavailable',
      capabilities: { create: false, resume: true, stop: false, exactApproval: false, modelSelection: false },
    };
  }
  return reports;
}

export function createNativeAdapter(client, options = {}) {
  if (!STARTABLE.has(client)) throw new CoreError(503, 'client_unavailable', 'That client cannot start a session.');
  const models = Array.isArray(options.models) ? options.models : [];
  const fixture = options.fixture === true;
  const nativeSupport = options.verifiedLogin === true && !fixture;
  return {
    client,
    nativeSupport,
    capabilities: {
      create: nativeSupport || fixture,
      resume: true,
      stop: true,
      exactApproval: nativeSupport,
      modelSelection: models.length > 0,
    },
    models,
    async probe() {
      return { client, nativeSupport, installed: true };
    },
    async create(request) {
      if (!this.capabilities.create) throw new CoreError(503, 'client_unavailable', 'The native client is not available.');
      if (request.model && !models.includes(request.model)) throw new CoreError(422, 'unsupported_model', 'The requested model is not installed.');
      assertNoBypass(request.argv ?? []);
      if (fixture) return acceptFixture(client, options.transcript ?? [], request);
      throw new CoreError(503, 'native_login_unavailable', 'The native login was not verified.');
    },
    async send() {
      return { submitted: false, ambiguous: true };
    },
    async observe() {
      return { activity: null, quota: null };
    },
    async requestPermission(nativeRequest) {
      const choice = (nativeRequest?.options ?? []).find((option) => option === 'allow-once' || option === 'reject-once');
      if (!choice || nativeRequest?.always === true) throw new CoreError(422, 'always_unavailable', 'The native request has no exact once decision.');
      return { decision: choice, requestId: nativeRequest.id };
    },
    async stop(session) {
      if (!session?.owned) return { acknowledged: false, code: 'stop_unavailable' };
      options.signaled?.push(session.pid);
      return { acknowledged: true, exitCode: 0 };
    },
    async close() {},
  };
}

export function parseCodexLine(line) {
  return parseRpc(line, ['initialize', 'initialized', 'thread/start', 'turn/start', 'turn/steer', 'turn/interrupt']);
}

export function parseCursorLine(line) {
  const message = parseRpc(line, ['initialize', 'authenticate', 'session/new', 'session/prompt', 'session/cancel']);
  if (message.method === 'initialize' && message.params?.protocolVersion !== 1) throw new CoreError(422, 'protocol_error', 'The ACP version is not supported.');
  if (message.result?.outcome === 'allow-always') throw new CoreError(422, 'protocol_error', 'A standing allow is not accepted.');
  return message;
}

export function parseClaudeLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    throw new CoreError(422, 'protocol_error', 'The stream line is not JSON.');
  }
  if (message?.type === 'system' && message.subtype === 'init' && typeof message.session_id !== 'string') {
    throw new CoreError(422, 'protocol_error', 'The Claude init event has no session id.');
  }
  if (message?.permissionDecision === 'allow' && message.hookSpecificOutput == null) {
    throw new CoreError(422, 'protocol_error', 'The permission decision is not a hook result.');
  }
  return message;
}

export async function enqueueStart(context, input) {
  const client = input?.client;
  if (!STARTABLE.has(client)) throw new CoreError(503, 'client_unavailable', 'That client cannot start a session.');
  const unit = parseUnitId(input.unitId);
  const state = await readBytes(context.store, path.join(context.paths.mind, 'user', 'state', `${unit.unit}.md`));
  if (!state) throw new CoreError(404, 'unit_not_found', 'The unit does not exist.');
  if (hashBytes(state) !== input.stateRevision) throw new CoreError(409, 'unit_changed', 'The unit changed before launch.');
  if (!answersFor(context.beat, context.now())) throw new CoreError(409, 'machine_unavailable', 'The target machine is not answering.');
  const prompt = input.prompt ?? null;
  if (prompt != null && (typeof prompt !== 'string' || Buffer.byteLength(prompt) > PROMPT_MAX)) {
    throw new CoreError(413, 'message_too_large', 'The start prompt is too large.');
  }
  const adapter = adapterFor(context, client);
  if (input.model && !adapter.models.includes(input.model)) throw new CoreError(422, 'unsupported_model', 'The requested model is not installed.');
  if (!adapter.capabilities.create) throw new CoreError(503, 'client_unavailable', 'The native client is not available.');
  const id = randomUUID();
  const request = {
    format: 'hivem1nd-session-request-v1',
    id,
    unitId: unit.id,
    targetMachine: input.targetMachine ?? context.paths.machine,
    requestedBy: context.principal?.unitId ?? 'root:master',
    sourceMachine: context.paths.machine,
    client,
    model: input.model ?? null,
    leadId: input.leadId ?? null,
    job: input.job ?? null,
    prompt,
    stateRevision: input.stateRevision,
    createdAt: new Date(context.now()).toISOString(),
    expiresAt: new Date(context.now() + LIFETIME_MS).toISOString(),
  };
  await writeJson(context, `user/relay/requests/${request.targetMachine}/${id}.json`, request);
  if (request.targetMachine !== context.paths.machine) return { status: 202, request, state: 'queued' };
  return consumeStart(context, id);
}

export async function consumeStart(context, requestId) {
  const request = await readJson(context, await findRequest(context, requestId));
  if (!request) throw new CoreError(404, 'request_not_found', 'The start request does not exist.');
  if (request.targetMachine !== context.paths.machine) return { status: 202, request, state: 'queued' };
  return withLocks(context.store, [`launch:${request.unitId}`, `request:${requestId}`], () => launch(context, request));
}

export async function recoverStarts(context) {
  const journals = await listJournals(context);
  const results = [];
  for (const journal of journals) {
    if (journal.phase === 'prepared' && journal.createAttempted !== true) {
      results.push(await consumeStart(context, journal.requestId));
      continue;
    }
    if (journal.phase === 'registered') {
      results.push({ requestId: journal.requestId, state: 'started', sessionId: journal.sessionId, recovered: true });
      continue;
    }
    if (journal.phase === 'failed') {
      results.push({ requestId: journal.requestId, state: 'failed', recovered: true });
      continue;
    }
    await writeJournal(context, { ...journal, phase: 'failed', error: 'launch_ambiguous' });
    const failed = await writeResult(context, { ...journal, id: journal.requestId }, 'failed', null, { code: 'launch_ambiguous', message: 'The launch could not be proved.' });
    results.push(failed);
  }
  return results;
}

export async function registerNative(context, input) {
  const sessionId = uuidV8(['session', context.paths.machine, input.client, input.nativeSessionId, input.unitId]);
  const registration = {
    kind: 'registration',
    registrationId: randomUUID(),
    instanceId: `service-${context.paths.machine}`,
    sessionId,
    unit: parseUnitId(input.unitId).unit,
    unitId: input.unitId,
    scopeId: parseUnitId(input.unitId).scope.id,
    nativeSessionId: input.nativeSessionId,
    client: input.client,
    machine: context.paths.machine,
    registeredAt: new Date(context.now()).toISOString(),
    activity: 'idle',
    activityObservedAt: new Date(context.now()).toISOString(),
    quota: null,
    quotaObservedAt: null,
  };
  assertNoSecret(canonicalJson(registration));
  await writeJson(context, `user/relay/sessions/${registration.registrationId}.json`, registration);
  return registration;
}

export async function stopSession(context, sessionId) {
  const journal = (await listJournals(context)).find((item) => item.sessionId === sessionId);
  if (!journal?.pid || !context.ownedPids?.has(journal.pid)) {
    throw new CoreError(409, 'stop_unavailable', 'The session is not an owned native process.');
  }
  const adapter = adapterFor(context, journal.client);
  const stopped = await adapter.stop({ owned: true, pid: journal.pid, sessionId });
  if (stopped.acknowledged !== true) throw new CoreError(409, 'stop_unavailable', 'The native process did not acknowledge the stop.');
  const status = {
    format: 'hivem1nd-session-status-v1',
    sessionId,
    state: 'stopped',
    machine: context.paths.machine,
    at: new Date(context.now()).toISOString(),
    reason: 'native-acknowledged',
  };
  await writeJson(context, `user/relay/session-status/${sessionId}/${randomUUID()}.json`, status);
  if (context.watch && journal.unitId) {
    const { clearUnit } = await import('./watch.mjs');
    clearUnit(context.watch, journal.unitId);
  }
  return status;
}

async function launch(context, request) {
  const existing = await latestResult(context, request.id);
  if (existing && TERMINAL.has(existing.state)) return { status: 200, request, result: existing, replayed: true };
  const journals = await listJournals(context);
  const current = journals.find((item) => item.requestId === request.id);
  if (Date.parse(request.expiresAt) <= context.now()) {
    if (current && current.phase !== 'failed') await writeJournal(context, { ...current, phase: 'failed' });
    return finish(context, request, 'expired', null, { code: 'approval_expired', message: 'The start request expired.' });
  }
  if (!answersFor(context.beat, context.now())) throw new CoreError(409, 'machine_unavailable', 'The target machine is not answering.');
  const state = await readBytes(context.store, statePath(context, request.unitId));
  if (!state || hashBytes(state) !== request.stateRevision) throw new CoreError(409, 'unit_changed', 'The unit changed before launch.');
  if (journals.some((item) => item.unitId === request.unitId && item.requestId !== request.id && item.phase !== 'failed')) {
    throw new CoreError(409, 'unit_in_use', 'The unit already has a launch in progress.');
  }
  if (current?.phase === 'spawned' || current?.createAttempted === true) {
    return finish(context, request, 'failed', null, { code: 'launch_ambiguous', message: 'The launch could not be proved.' });
  }
  await writeJournal(context, { requestId: request.id, unitId: request.unitId, client: request.client, phase: 'prepared', pid: null, sessionId: null, createAttempted: false, at: stamp(context) });
  if (context.launchFault === 'prepared') throw new CoreError(500, 'injected_crash', 'Injected crash before native creation.');
  await writeJournal(context, { requestId: request.id, unitId: request.unitId, client: request.client, phase: 'prepared', pid: null, sessionId: null, createAttempted: true, at: stamp(context) });
  if (context.launchFault === 'gap') throw new CoreError(500, 'injected_crash', 'Injected crash during native creation.');
  const adapter = adapterFor(context, request.client);
  const created = await adapter.create({ ...request, cwd: context.projects?.[0]?.localPath ?? null });
  const pid = created.pid;
  context.ownedPids ??= new Set();
  context.ownedPids.add(pid);
  await writeJournal(context, { requestId: request.id, unitId: request.unitId, client: request.client, phase: 'spawned', pid, sessionId: null, createAttempted: true, nativeSessionId: created.nativeSessionId, at: stamp(context) });
  if (context.launchFault === 'spawned') throw new CoreError(500, 'injected_crash', 'Injected crash after spawn.');
  const registration = await registerNative(context, { client: request.client, nativeSessionId: created.nativeSessionId, unitId: request.unitId });
  await writeJournal(context, { requestId: request.id, unitId: request.unitId, client: request.client, phase: 'registered', pid, sessionId: registration.sessionId, createAttempted: true, at: stamp(context) });
  await preload(context, request);
  return finish(context, request, 'started', registration.sessionId, null);
}

async function finish(context, request, state, sessionId, error) {
  const result = await writeResult(context, request, state, sessionId, error);
  return { status: state === 'started' ? 200 : 409, request, result, replayed: false };
}

async function writeResult(context, request, state, sessionId, error) {
  const previous = await latestResult(context, request.id);
  if (previous && TERMINAL.has(previous.state)) return previous;
  const result = {
    format: 'hivem1nd-session-result-v1',
    id: randomUUID(),
    requestId: request.id,
    machine: context.paths.machine,
    state,
    sessionId,
    error,
    at: stamp(context),
  };
  assertNoSecret(canonicalJson(result));
  await writeJson(context, `user/relay/request-results/${request.id}/${result.id}.json`, result);
  return result;
}

async function preload(context, request) {
  if (!request.prompt) return null;
  const markerPath = `user/relay/preloads/${request.id}.json`;
  if (await readJson(context, markerPath)) return null;
  const messageId = request.id;
  const bytes = Buffer.from(`id: ${messageId}\nfrom: master\nfrom-id: root:master\nto-id: ${request.unitId}\nkind: message\nrequest-id: ${request.id}\ntimestamp: ${stamp(context)}\n\n${request.prompt}\n`);
  const message = `user/inbox/${parseUnitId(request.unitId).unit}/${stamp(context).replace(/[-:]/g, '').replace('.000Z', '').replace('T', '-')}-${context.paths.machine}-${messageId}.md`;
  await commit(context, [
    { relative: markerPath, bytes: jsonBytes({ requestId: request.id, messageId }) },
    { relative: message, bytes },
  ]);
  return messageId;
}

async function latestResult(context, requestId) {
  const directory = path.join(context.paths.mind, 'user', 'relay', 'request-results', requestId);
  let names = [];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith('.json'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const results = [];
  for (const name of names) {
    const value = await readJson(context, `user/relay/request-results/${requestId}/${name}`);
    if (value) results.push(value);
  }
  results.sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || (left.id < right.id ? -1 : 1));
  return results.at(-1) ?? null;
}

async function listJournals(context) {
  const directory = path.join(context.paths.localDirectory, 'session-starts');
  let names = [];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith('.json'));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const journals = [];
  for (const name of names) {
    const bytes = await readBytes(context.store, path.join(directory, name));
    if (bytes) journals.push(JSON.parse(bytes.toString('utf8')));
  }
  return journals;
}

async function writeJournal(context, journal) {
  const relative = path.join(context.paths.localDirectory, 'session-starts', `${journal.requestId}.json`);
  const current = await readBytes(context.store, relative);
  await commitTransaction(context.store, {
    id: randomUUID(),
    entries: [{ resource: `session-starts/${journal.requestId}.json`, recordPath: relative, beforeRevision: revisionOf(current), afterBytes: jsonBytes(journal) }],
    events: [],
  });
}

async function findRequest(context, requestId) {
  const directory = path.join(context.paths.mind, 'user', 'relay', 'requests');
  let machines = [];
  try {
    machines = await readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
  for (const machine of machines) {
    const relative = `user/relay/requests/${machine}/${requestId}.json`;
    if (await readBytes(context.store, absolute(context, relative))) return relative;
  }
  return '';
}

function adapterFor(context, client) {
  const adapter = context.adapters?.[client] ?? createNativeAdapter(client, { models: context.models ?? [] });
  return adapter;
}

function acceptFixture(client, transcript, request) {
  if (client === 'codex') {
    const start = transcript.map(parseCodexLine).find((line) => line.result?.thread?.id);
    if (!start) throw new CoreError(422, 'protocol_error', 'The Codex transcript has no thread id.');
    return { nativeSessionId: start.result.thread.id, pid: 4101, fixture: true };
  }
  if (client === 'cursor') {
    const start = transcript.map(parseCursorLine).find((line) => line.result?.sessionId);
    if (!start) throw new CoreError(422, 'protocol_error', 'The ACP transcript has no session id.');
    return { nativeSessionId: start.result.sessionId, pid: 4102, fixture: true };
  }
  const init = transcript.map(parseClaudeLine).find((line) => line.type === 'system' && line.subtype === 'init');
  if (!init?.session_id || (request.nativeSessionId && init.session_id !== request.nativeSessionId)) {
    throw new CoreError(422, 'protocol_error', 'The Claude init session does not match.');
  }
  return { nativeSessionId: init.session_id, pid: 4103, fixture: true };
}

function parseRpc(line, methods) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    throw new CoreError(422, 'protocol_error', 'The protocol line is not JSON.');
  }
  if (message.method && !methods.includes(message.method)) throw new CoreError(422, 'protocol_error', 'The protocol method is not supported.');
  if (message.method === 'initialize' && message.params?.clientInfo && !message.params.clientInfo.name) {
    throw new CoreError(422, 'protocol_error', 'The initialize client is incomplete.');
  }
  return message;
}

function assertNoBypass(argv) {
  if (argv.some((arg) => /dangerously-skip-permissions|bypassPermissions/i.test(String(arg)))) {
    throw new CoreError(422, 'unsupported_action', 'Permission bypass flags are not accepted.');
  }
}

function assertNoSecret(text) {
  if (/token|pipe|authorization|secret/i.test(text)) throw new CoreError(422, 'invalid_body', 'A session record contains a secret.');
}

async function findExecutable(name, env) {
  const pathValue = env.PATH || env.Path || '';
  const extensions = env.PATHEXT ? env.PATHEXT.split(';') : ['.exe', '.cmd', ''];
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, extension && !name.toLowerCase().endsWith(extension.toLowerCase()) ? `${name}${extension}` : name);
      try {
        const stats = await lstat(candidate);
        if (stats.isFile()) return candidate;
      } catch {
        /* Absent candidates are not installed. */
      }
    }
  }
  return null;
}

function versionOf(command, args, options) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, [...args, '--version'], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolve(null);
      return;
    }
    options.fixture?.children?.push(child);
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 1500);
    child.stdout?.on('data', (chunk) => {
      output += chunk.toString('utf8');
    });
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(output.trim().slice(0, 120) || null);
    });
    child.once('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

async function writeJson(context, relative, value) {
  await commit(context, [{ relative, bytes: jsonBytes(value) }]);
}

async function readJson(context, relative) {
  if (!relative) return null;
  const bytes = await readBytes(context.store, absolute(context, relative));
  return bytes ? JSON.parse(bytes.toString('utf8')) : null;
}

async function commit(context, records) {
  await commitTransaction(context.store, {
    id: randomUUID(),
    entries: records.map((record) => ({
      resource: record.relative,
      recordPath: absolute(context, record.relative),
      beforeRevision: null,
      afterBytes: record.bytes,
    })),
    events: [],
  });
}

function statePath(context, unitId) {
  return path.join(context.paths.mind, 'user', 'state', `${parseUnitId(unitId).unit}.md`);
}

function stamp(context) {
  return new Date(context.now()).toISOString();
}

function jsonBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`);
}

function absolute(context, relative) {
  if (path.isAbsolute(relative)) return relative;
  return path.join(context.paths.mind, ...relative.split('/'));
}
