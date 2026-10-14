import { lstat, readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CLIENTS, CoreError, canonicalJson, hashBytes, inboxDirectory, parseTaskId, parseUnitId, uuidV8 } from './identity.mjs';
import { loadTask } from './tasks.mjs';
import { answersFor, readDetail } from './projection.mjs';
import { publishDomainEvents } from './events.mjs';
import { readUnitState } from './state.mjs';
import { cursorAgentCommand } from '../relay/cursor-wake.mjs';
import { commitTransaction, readBytes, revisionOf } from './store.mjs';
import { withLocks } from './store.mjs';

const LIFETIME_MS = 120000;
const PROMPT_MAX = 100000;
const TERMINAL = new Set(['started', 'failed', 'expired', 'canceled']);
const STARTABLE = new Set(CLIENTS);

export async function probeClients(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const reports = {};
  for (const client of CLIENTS) {
    const located = await locateClient(client, env, platform);
    const unwrapped = located && client !== 'cursor' ? await unwrapLaunch(located.command, client) : null;
    const command = client === 'cursor' ? located?.command ?? null : unwrapped?.command ?? null;
    const installed = Boolean(command);
    let version = null;
    if (installed && options.spawnVersion === true && !String(command).toLowerCase().endsWith('.cmd')) {
      const prefix = client === 'cursor' ? located.args ?? [] : unwrapped.args.slice(0, -launchArgs(client).length);
      version = await versionOf(command, prefix, options);
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

export function clientRecords(reports) {
  return CLIENTS.map((id) => {
    const installed = reports?.[id]?.installed === true;
    return { id, enabled: installed, installed, supported: ['claude', 'codex', 'cursor'].includes(id), reason: reports?.[id]?.reason ?? null };
  });
}

export function createNativeAdapter(client, options = {}) {
  if (!STARTABLE.has(client)) throw new CoreError(503, 'client_unavailable', 'That client cannot start a session.');
  const models = Array.isArray(options.models) ? options.models : [];
  const fixture = options.fixture === true;
  const live = options.live === true || Boolean(options.command) || Boolean(options.spawn);
  const children = new Map();
  const sessions = new Map();
  return {
    client,
    nativeSupport: false,
    capabilities: {
      create: ['claude', 'codex', 'cursor'].includes(client) && (fixture || (options.verifiedLogin !== false && live)),
      resume: true,
      stop: true,
      exactApproval: false,
      modelSelection: models.length > 0,
    },
    models,
    async probe() {
      return { client, nativeSupport: this.nativeSupport, installed: this.capabilities.create };
    },
    async create(request) {
      if (!this.capabilities.create) throw new CoreError(503, 'client_unavailable', 'The native client is not available.');
      if (request.model && !models.includes(request.model)) throw new CoreError(422, 'unsupported_model', 'The requested model is not installed.');
      assertNoBypass(request.argv ?? []);
      if (fixture) {
        const created = acceptFixture(client, options.transcript ?? [], request);
        sessions.set(created.nativeSessionId, { ...created, unitId: request.unitId, closedTurns: [] });
        return created;
      }
      const nativeLaunch = options.createNativeLaunch?.({ ...request, client }) ?? null;
      request = { ...request, nativeMcp: nativeLaunch?.mcp ?? null };
      if (client === 'claude' && !request.nativeSessionId) request.nativeSessionId = randomUUID();
      let child;
      try {
        const resolved = options.command
          ? { command: options.command, args: options.args ?? launchArgs(client, request) }
          : await resolveLaunch(client, options.env ?? process.env, options.platform ?? process.platform, request);
        if (!resolved?.command) throw new CoreError(503, 'client_unavailable', 'The native client is not available.');
        assertNoBypass(resolved.args);
        child = (options.spawn ?? spawn)(resolved.command, resolved.args, {
          shell: false,
          windowsHide: true,
          cwd: request.cwd || undefined,
          env: nativeLaunch ? { ...(options.env ?? process.env), ...nativeLaunch.env } : options.env ?? process.env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error) {
        nativeLaunch?.close();
        throw error;
      }
      child.once?.('exit', () => nativeLaunch?.close());
      if (child?.pid) children.set(child.pid, child);
      let opened = null;
      let deadline;
      try {
        opened = await Promise.race([
          openOwnedChannel(client, child, request, options.timeoutMs ?? 30000),
          new Promise((_, reject) => { deadline = setTimeout(() => reject(unavailable()), options.timeoutMs ?? 30000); }),
        ]);
        clearTimeout(deadline);
        this.nativeSupport = true;
        const record = opened.session ?? { turnId: null, closedTurns: [] };
        record.nativeSessionId = opened.nativeSessionId;
        record.pid = child.pid;
        record.child = child;
        record.incoming = opened.incoming;
        record.rpc = opened.rpc;
        record.unitId = request.unitId ?? null;
        record.nativeLaunch = nativeLaunch;
        record.timeoutMs = options.timeoutMs ?? 30000;
        if (!Array.isArray(record.closedTurns)) record.closedTurns = [];
        sessions.set(opened.nativeSessionId, record);
        if (client === 'claude') pumpClaude(record);
        nativeLaunch?.ready(opened.nativeSessionId);
        return { nativeSessionId: opened.nativeSessionId, pid: child.pid, owned: true };
      } catch (error) {
        clearTimeout(deadline);
        nativeLaunch?.close();
        opened?.incoming?.close();
        const exited = await finishChild(child, true);
        if (exited === null) {
          const ambiguous = new CoreError(409, 'launch_ambiguous', 'The launch could not be proved or stopped.');
          ambiguous.ownedPid = child.pid;
          throw ambiguous;
        }
        if (child?.pid) children.delete(child.pid);
        if (error instanceof CoreError && error.code === 'client_unavailable') throw error;
        throw new CoreError(503, 'client_unavailable', 'The native client is not available.');
      }
    },
    async confirm(proof) {
      if (!proof || proof.client !== client || typeof proof.nativeSessionId !== 'string') return false;
      const session = sessions.get(proof.nativeSessionId);
      if (fixture && session) return !proof.unitId || proof.unitId === session.unitId;
      if (!session?.child || session.child.exitCode != null || session.child.killed === true) return false;
      if (proof.unitId && session.unitId && proof.unitId !== session.unitId) return false;
      return true;
    },
    async registered(request, registration, context) {
      const session = sessions.get(registration.nativeSessionId);
      if (session && context) {
        session.onCompleted = async () => {
          if (!session.taskTerminal || request.runMode !== 'task') return;
          await stopSession(context, registration.sessionId, { confirmed: true });
        };
        session.child?.once?.('exit', () => stopSession(context, registration.sessionId, { confirmed: true }).catch(() => {}));
      }
      return options.onNativeRegistered?.({ request, registration });
    },
    async completeTask(input) {
      const session = sessions.get(input.nativeSessionId);
      if (!session || session.unitId !== input.unitId) throw new CoreError(409, 'stop_unavailable', 'The native task binding is unavailable.');
      session.taskTerminal = true;
      session.terminalTurnId = session.turnId;
      return { acknowledged: true };
    },
    async taskEnded(input) {
      if (!fixture) throw new CoreError(409, 'stop_unavailable', 'Only the native transport observes completion.');
      await sessions.get(input.nativeSessionId)?.onCompleted?.();
    },
    async send(input = {}) {
      const session = sessions.get(input?.nativeSessionId);
      if (!session?.child || session.child.exitCode != null || session.child.killed === true) return { submitted: false };
      const text = typeof input.text === 'string' ? input.text : '';
      try {
        if (client === 'codex') return await submitCodex(session, text);
        if (client === 'cursor') return await submitCursor(session, text);
        return await submitClaude(session, text);
      } catch {
        return { submitted: false, ambiguous: true };
      }
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
      const child = children.get(session.pid);
      if (!child) {
        if (!fixture) return { acknowledged: false, code: 'stop_unavailable' };
        options.signaled?.push(session.pid);
        releaseSession(sessions, session.pid);
        return { acknowledged: true, exitCode: 0 };
      }
      const exitCode = await finishChild(child, true);
      if (exitCode !== null) {
        releaseSession(sessions, session.pid);
        children.delete(session.pid);
      }
      options.signaled?.push(session.pid);
      return { acknowledged: exitCode !== null, exitCode };
    },
    async close() {
      for (const item of sessions.values()) {
        item.nativeLaunch?.close();
        item.incoming?.close();
      }
      sessions.clear();
      await Promise.all([...children.values()].map((child) => finishChild(child)));
      children.clear();
    },
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
    throw new CoreError(422, 'protocol_error', 'The native initialization event has no session id.');
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
  const state = (await readUnitState(context, unit))?.bytes;
  if (!state || /^removed:\s*true\s*$/m.test(state.toString('utf8').split(/\r?\n\r?\n/, 1)[0])) throw new CoreError(404, 'unit_not_found', 'The unit does not exist.');
  const id = input.approvalId ? uuidV8(['session-child', input.approvalId])
    : context.receipt ? uuidV8(['session-request', context.receipt.principalHash, context.receipt.key]) : randomUUID();
  const targetMachine = input.targetMachine ?? state.toString('utf8').match(/^machine:\s*(\S+)/m)?.[1] ?? context.paths.machine;
  const previous = await readJson(context, `user/relay/requests/${targetMachine}/${id}.json`);
  if (previous) return input.queueOnly === true ? { status: 202, request: previous, result: await latestResult(context, id), state: 'queued' } : consumeStart(context, id);
  if (hashBytes(state) !== input.stateRevision) throw new CoreError(409, 'unit_changed', 'The unit changed before launch.');
  if (!answersFor(await currentBeat(context), context.now())) throw new CoreError(409, 'machine_unavailable', 'The target machine is not answering.');
  const prompt = input.prompt ?? null;
  if (prompt != null && (typeof prompt !== 'string' || Buffer.byteLength(prompt) > PROMPT_MAX)) {
    throw new CoreError(413, 'message_too_large', 'The start prompt is too large.');
  }
  const role = state.toString('utf8').match(/^role:\s*(\S+)/m)?.[1];
  if (input.runMode !== undefined && !['task', 'chat'].includes(input.runMode)) throw new CoreError(422, 'invalid_body', 'The run mode is not valid.');
  const runMode = input.runMode ?? (role === 'executor' ? 'task' : 'chat');
  const taskId = input.taskId ?? null;
  if (taskId !== null) {
    parseTaskId(taskId);
    const task = await loadTask(context, taskId);
    if (task.toId !== unit.id) throw new CoreError(422, 'invalid_binding', 'The task belongs to another unit.');
  }
  if (runMode === 'task' && taskId === null && !prompt?.trim()) throw new CoreError(422, 'task_required', 'A task or task prompt is required.');
  const adapter = adapterFor(context, client);
  if (input.model && !adapter.models.includes(input.model)) throw new CoreError(422, 'unsupported_model', 'The requested model is not installed.');
  if (!adapter.capabilities.create) throw new CoreError(503, 'client_unavailable', 'The native client is not available.');
  if (targetMachine === context.paths.machine && !registeredProjectCwd(context, unit.id)) throw new CoreError(503, 'client_unavailable', 'The unit has no registered project path.');
  const request = {
    format: 'hivem1nd-session-request-v1',
    id,
    unitId: unit.id,
    targetMachine,
    requestedBy: context.principal?.unitId ?? 'root:master',
    sourceMachine: context.paths.machine,
    client,
    model: input.model ?? null,
    leadId: input.leadId ?? null,
    job: input.job ?? null,
    prompt,
    runMode,
    taskId,
    launchKind: 'cli',
    approvalId: input.approvalId ?? null,
    stateRevision: input.stateRevision,
    createdAt: new Date(context.now()).toISOString(),
    expiresAt: new Date(context.now() + LIFETIME_MS).toISOString(),
  };
  await writeJson(context, `user/relay/requests/${request.targetMachine}/${id}.json`, request);
  if (request.targetMachine !== context.paths.machine) return { status: 202, request, state: 'queued' };
  if (input.queueOnly === true) {
    await writeJournal(context, { requestId: id, unitId: unit.id, client, phase: 'prepared', pid: null, sessionId: null, createAttempted: false, at: stamp(context) });
    return { status: 202, request, state: 'queued' };
  }
  return consumeStart(context, id);
}

export async function consumeStart(context, requestId) {
  context.store.sessionLaunches ??= new Map();
  if (context.store.sessionLaunches.has(requestId)) return context.store.sessionLaunches.get(requestId);
  const work = Promise.resolve().then(async () => {
    const request = await readJson(context, await findRequest(context, requestId));
    if (!request) throw new CoreError(404, 'request_not_found', 'The start request does not exist.');
    if (request.targetMachine !== context.paths.machine) return { status: 202, request, state: 'queued' };
    return withLocks(context.store, [`launch:${request.unitId}`, `request:${requestId}`], () => launch(context, request));
  }).finally(() => context.store.sessionLaunches.delete(requestId));
  context.store.sessionLaunches.set(requestId, work);
  return work;
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
    if (journal.phase === 'failed' || journal.phase === 'stopped') {
      results.push({ requestId: journal.requestId, state: journal.phase, recovered: true });
      continue;
    }
    await writeJournal(context, { ...journal, phase: 'ambiguous', error: 'launch_ambiguous' });
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
    runMode: input.runMode ?? 'chat',
    taskId: input.taskId ?? null,
    launchKind: input.launchKind ?? 'manual-app',
  };
  assertNoSecret(canonicalJson(registration));
  await writeJson(context, `user/relay/sessions/${registration.registrationId}.json`, registration);
  return registration;
}

export function projectSessionRequest(value) {
  const request = value?.request ?? value ?? {};
  const result = value?.result ?? null;
  let state = result?.state ?? value?.state ?? 'queued';
  let error = result?.error ?? null;
  const expiresAt = request.expiresAt ?? null;
  if (value?.consumed !== true && (!result || !TERMINAL.has(result.state)) && value?.now != null && expiresAt && Date.parse(expiresAt) <= value.now) {
    state = 'expired';
    error = error ?? { code: 'approval_expired', message: 'The start request expired.' };
  }
  return {
    requestId: request.id ?? request.requestId ?? null,
    unitId: request.unitId ?? null,
    machine: result?.machine ?? request.targetMachine ?? request.machine ?? null,
    state,
    sessionId: result?.sessionId ?? null,
    error,
    expiresAt,
    client: request.client ?? null,
    runMode: request.runMode ?? 'task',
    taskId: request.taskId ?? null,
    launchKind: request.launchKind ?? 'cli',
  };
}

export async function stopSession(context, sessionId, input = {}) {
  return withLocks(context.store, [`stop:${sessionId}`], () => stopOwnedSession(context, sessionId, input));
}

// Applying a reviewed configuration never grants ownership of an app process.
// Active CLI work needs an adapter-supported reload or an explicit close first.
export async function reloadReviewedClient(context, { client, target, previewId, checkOnly = false }) {
  const journals = (await listJournals(context)).filter(item => item.client === client && !['failed', 'stopped'].includes(item.phase)
    && item.pid && context.ownedPids?.has(item.pid));
  const adapter = context.adapters?.[client];
  if (journals.length && typeof adapter?.reload !== 'function') throw new CoreError(409, 'client_reload_required', 'Close the running HIVEM1ND sessions, then apply the reviewed changes.');
  if (checkOnly || !journals.length) return;
  const result = await adapter.reload({ owned: true, target, previewId, sessions: journals.map(({ pid, sessionId }) => ({ pid, sessionId })) });
  if (result?.acknowledged !== true) throw new CoreError(409, 'client_reload_required', 'The owned client did not confirm its reload; close its HIVEM1ND sessions and retry.');
}

async function stopOwnedSession(context, sessionId, input) {
  if (input?.confirmed !== true) throw new CoreError(422, 'invalid_body', 'Stopping a session needs confirmation.');
  const statusDirectory = `user/relay/session-status/${sessionId}`;
  let names = [];
  try { names = await readdir(absolute(context, statusDirectory)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const name of names.filter((name) => name.endsWith('.json'))) {
    const status = await readJson(context, `${statusDirectory}/${name}`);
    if (status?.sessionId === sessionId && status.state === 'stopped' && status.reason === 'native-acknowledged'
      && status.machine === context.paths.machine) return { sessionId, state: 'stopped', acknowledged: true };
  }
  const registration = await registrationFor(context, sessionId);
  if (registration?.machine && registration.machine !== context.paths.machine) {
    throw new CoreError(409, 'remote_session', 'The session belongs to another machine.');
  }
  const journal = (await listJournals(context)).find((item) => item.sessionId === sessionId);
  if (!journal?.pid || !context.ownedPids?.has(journal.pid)) {
    throw new CoreError(409, 'stop_unavailable', 'The session is not an owned native process.');
  }
  const adapter = adapterFor(context, journal.client);
  if (adapter.capabilities?.stop !== true || typeof adapter.stop !== 'function') throw new CoreError(409, 'stop_unavailable', 'The native client cannot stop this session.');
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
  const relative = `${statusDirectory}/${randomUUID()}.json`;
  await commitTransaction(context.store, { id: randomUUID(), entries: [
    { resource: relative, recordPath: absolute(context, relative), beforeRevision: null, afterBytes: jsonBytes(status) },
    ...(input.onAcknowledged ? await input.onAcknowledged(status) : []),
  ], events: [] });
  context.ownedPids.delete(journal.pid);
  await writeJournal(context, { ...journal, phase: 'stopped', at: stamp(context) });
  context.credentials?.revokeSession?.(sessionId);
  if (context.watch && journal.unitId) {
    const { clearUnit } = await import('./watch.mjs');
    clearUnit(context.watch, journal.unitId);
  }
  if (context.bus) publishDomainEvents(context, [{ name: 'session.changed', unitId: journal.unitId, data: { session: await readDetail(context, 'sessions', sessionId) } },
    { name: 'unit.changed', unitId: journal.unitId, data: { unit: await readDetail(context, 'units', journal.unitId) } }]);
  return { sessionId, state: 'stopping', acknowledged: true };
}

export async function completeSessionTask(context, sessionId, input) {
  const registration = await registrationFor(context, sessionId);
  if (!registration || sessionId !== context.principal?.sessionId || registration.unitId !== context.principal?.unitId || registration.runMode !== 'task'
    || registration.launchKind !== 'cli' || !['delivered', 'failed'].includes(input?.outcome)) {
    throw new CoreError(422, 'invalid_binding', 'The completion must belong to the assigned task session.');
  }
  if (input.taskId !== undefined && input.taskId !== registration.taskId) throw new CoreError(422, 'invalid_binding', 'The task does not match this session.');
  if (registration.taskId) {
    const task = await loadTask(context, registration.taskId);
    if (task.toId !== registration.unitId || input.outcome === 'delivered' && !['review', 'done', 'closed'].includes(task.status)) {
      throw new CoreError(409, 'task_not_terminal', 'The assigned task has not been delivered or closed.');
    }
  }
  const adapter = adapterFor(context, registration.client);
  if (await adapter.confirm?.(registration) !== true) throw new CoreError(409, 'stop_unavailable', 'The native completion cannot be verified.');
  if (typeof adapter.completeTask !== 'function') throw new CoreError(409, 'stop_unavailable', 'The native client cannot observe task completion.');
  const journal = (await listJournals(context)).find((item) => item.sessionId === sessionId);
  if (!journal || !context.ownedPids?.has(journal.pid)) throw new CoreError(409, 'stop_unavailable', 'The native task is not owned by this service.');
  await writeJournal(context, { ...journal, taskCompletion: { taskId: registration.taskId, outcome: input.outcome, at: stamp(context) } });
  const result = await adapter.completeTask(registration);
  if (result?.acknowledged !== true) throw new CoreError(409, 'stop_unavailable', 'The native completion was not acknowledged.');
  return { sessionId, taskId: registration.taskId, state: 'awaiting-native-completion' };
}

export async function assertChatSession(context, sessionId) {
  const registration = await registrationFor(context, sessionId);
  const adapter = registration && context.adapters?.[registration.client];
  if (!registration || registration.unitId !== context.principal?.unitId || registration.runMode !== 'chat'
    || registration.machine !== context.paths.machine || await adapter?.confirm?.(registration) !== true) {
    throw new CoreError(403, 'invalid_binding', 'Only a bound, connected chat session may request another CLI.');
  }
  return registration;
}

export async function cancelStart(context, requestId) {
  const request = await readJson(context, await findRequest(context, requestId));
  if (!request) throw new CoreError(404, 'request_not_found', 'The start request does not exist.');
  const marker = `user/relay/request-cancellations/${requestId}.json`;
  await withLocks(context.store, [`cancel:${requestId}`], async () => {
    if (!await readJson(context, marker)) await writeJson(context, marker, { requestId, at: stamp(context) });
  });
  if (request.targetMachine !== context.paths.machine) return { status: 202, requestId, state: 'canceling' };
  return withLocks(context.store, [`launch:${request.unitId}`, `request:${requestId}`], async () => {
    await cancelOwnedStart(context, request);
    return { status: 200, requestId, state: 'canceled' };
  });
}

async function cancelOwnedStart(context, request) {
  const journal = (await listJournals(context)).find((item) => item.requestId === request.id);
  if (journal?.pid && journal.phase !== 'stopped') {
    if (journal.sessionId) await stopSession(context, journal.sessionId, { confirmed: true });
    else {
      if (!context.ownedPids?.has(journal.pid)) throw new CoreError(409, 'stop_unavailable', 'The uncertain launch cannot be stopped safely.');
      const stopped = await adapterFor(context, journal.client).stop({ owned: true, pid: journal.pid });
      if (stopped?.acknowledged !== true) throw new CoreError(409, 'stop_unavailable', 'The uncertain launch cannot be stopped safely.');
      context.ownedPids.delete(journal.pid);
      await writeJournal(context, { ...journal, phase: 'stopped', at: stamp(context) });
    }
  } else if (journal?.createAttempted && !['failed', 'stopped'].includes(journal.phase)) {
    throw new CoreError(409, 'stop_unavailable', 'The uncertain launch cannot be stopped safely.');
  }
  return writeResult(context, request, 'canceled', journal?.sessionId ?? null, null);
}

async function registrationFor(context, sessionId) {
  const directory = path.join(context.paths.mind, 'user', 'relay', 'sessions');
  let names = [];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith('.json'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const records = [];
  for (const name of names) {
    const record = await readJson(context, `user/relay/sessions/${name}`);
    if (record?.sessionId === sessionId) records.push(record);
  }
  const latest = records.sort((left, right) => String(right.registeredAt ?? '').localeCompare(String(left.registeredAt ?? '')))[0];
  if (!latest) return null;
  const cli = records.find((record) => record.launchKind === 'cli' && ['unitId', 'client', 'machine', 'nativeSessionId'].every((key) => record[key] === latest[key]));
  return cli ? { ...latest, launchKind: 'cli', runMode: cli.runMode, taskId: cli.taskId } : latest;
}

async function launch(context, request) {
  if (await readJson(context, `user/relay/request-cancellations/${request.id}.json`)) {
    return { status: 200, request, result: await cancelOwnedStart(context, request), replayed: true };
  }
  const existing = await latestResult(context, request.id);
  if (existing && TERMINAL.has(existing.state)) return { status: 200, request, result: existing, replayed: true };
  const journals = await listJournals(context);
  const current = journals.find((item) => item.requestId === request.id);
  if (current?.createAttempted === true) {
    await writeJournal(context, { ...current, phase: 'ambiguous' });
    return finish(context, request, 'failed', null, { code: 'launch_ambiguous', message: 'The launch could not be proved.' });
  }
  if (Date.parse(request.expiresAt) <= context.now()) {
    if (current && current.phase !== 'failed') await writeJournal(context, { ...current, phase: 'failed' });
    return finish(context, request, 'expired', null, { code: 'approval_expired', message: 'The start request expired.' });
  }
  if (!answersFor(await currentBeat(context), context.now())) throw new CoreError(409, 'machine_unavailable', 'The target machine is not answering.');
  const state = (await readUnitState(context, parseUnitId(request.unitId)))?.bytes;
  if (!state || hashBytes(state) !== request.stateRevision) throw new CoreError(409, 'unit_changed', 'The unit changed before launch.');
  const cwd = registeredProjectCwd(context, request.unitId);
  if (!cwd) throw new CoreError(503, 'client_unavailable', 'The unit has no registered project path.');
  if (journals.some((item) => item.unitId === request.unitId && item.requestId !== request.id && !['failed', 'stopped'].includes(item.phase) && item.createAttempted === true)) {
    throw new CoreError(409, 'unit_in_use', 'The unit already has a launch in progress.');
  }
  await writeJournal(context, { requestId: request.id, unitId: request.unitId, client: request.client, phase: 'prepared', pid: null, sessionId: null, createAttempted: false, at: stamp(context) });
  if (context.launchFault === 'prepared') throw new CoreError(500, 'injected_crash', 'Injected crash before native creation.');
  await writeJournal(context, { requestId: request.id, unitId: request.unitId, client: request.client, phase: 'prepared', pid: null, sessionId: null, createAttempted: true, at: stamp(context) });
  if (context.launchFault === 'gap') throw new CoreError(500, 'injected_crash', 'Injected crash during native creation.');
  const adapter = adapterFor(context, request.client);
  let created;
  try {
    created = await adapter.create({ ...request, cwd });
  } catch (error) {
    if (error?.ownedPid) {
      context.ownedPids ??= new Set();
      context.ownedPids.add(error.ownedPid);
      await writeJournal(context, { requestId: request.id, unitId: request.unitId, client: request.client, phase: 'ambiguous', pid: error.ownedPid, sessionId: null, createAttempted: true, at: stamp(context) });
      return finish(context, request, 'failed', null, { code: 'launch_ambiguous', message: 'The native launch has not been confirmed.' });
    }
    if (error instanceof CoreError && (error.code === 'client_unavailable' || error.code === 'protocol_error')) {
      await writeJournal(context, { requestId: request.id, unitId: request.unitId, client: request.client, phase: 'failed', pid: null, sessionId: null, createAttempted: true, at: stamp(context) });
      await writeResult(context, request, 'failed', null, { code: error.code, message: error.message });
    }
    throw error;
  }
  const pid = created.pid;
  context.ownedPids ??= new Set();
  context.ownedPids.add(pid);
  await writeJournal(context, { requestId: request.id, unitId: request.unitId, client: request.client, phase: 'spawned', pid, sessionId: null, createAttempted: true, nativeSessionId: created.nativeSessionId, at: stamp(context) });
  if (context.launchFault === 'spawned') throw new CoreError(500, 'injected_crash', 'Injected crash after spawn.');
  const registration = await registerNative(context, { client: request.client, nativeSessionId: created.nativeSessionId, unitId: request.unitId, runMode: request.runMode, taskId: request.taskId, launchKind: 'cli' });
  await writeJournal(context, { requestId: request.id, unitId: request.unitId, client: request.client, phase: 'registered', pid, sessionId: registration.sessionId, createAttempted: true, at: stamp(context) });
  try {
    await adapter.registered?.(request, registration, context);
  } catch (error) {
    await stopSession(context, registration.sessionId, { confirmed: true });
    await writeJournal(context, { requestId: request.id, unitId: request.unitId, client: request.client, phase: 'failed', pid, sessionId: registration.sessionId, createAttempted: true, at: stamp(context) });
    return finish(context, request, 'failed', null, { code: error.code ?? 'native_login_unverified', message: 'The native session could not enter Relay.' });
  }
  if (await readJson(context, `user/relay/request-cancellations/${request.id}.json`)) return { status: 200, request, result: await cancelOwnedStart(context, request) };
  await preload(context, request);
  return finish(context, request, 'started', registration.sessionId, null);
}

async function finish(context, request, state, sessionId, error) {
  const result = await writeResult(context, request, state, sessionId, error);
  return { status: state === 'started' ? 200 : 409, request, result, replayed: false };
}

async function writeResult(context, request, state, sessionId, error) {
  const previous = await latestResult(context, request.id);
  if (previous && TERMINAL.has(previous.state) && state !== 'canceled') return previous;
  if (previous?.state === 'canceled') return previous;
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
  if (!request.prompt && !request.taskId) return null;
  const markerPath = `user/relay/preloads/${request.id}.json`;
  if (await readJson(context, markerPath)) return null;
  const messageId = request.id;
  const assignment = request.prompt ?? `Carry out assigned task ${request.taskId}.`;
  const lifecycle = request.runMode === 'task'
    ? `After terminal delivery or failure of ${request.taskId ?? 'this task'}, call session_complete with outcome delivered or failed. The CLI closes only after native completion.`
    : 'This chat remains open until explicitly stopped. Use session_open to request another connected CLI with approval.';
  const bytes = Buffer.from(`id: ${messageId}\nfrom: master\nfrom-id: root:master\nto-id: ${request.unitId}\nkind: message\nrequest-id: ${request.id}\nrun-mode: ${request.runMode}\ntask-id: ${request.taskId ?? ''}\ntimestamp: ${stamp(context)}\n\n${assignment}\n\n${lifecycle}\n`);
  const message = `${inboxDirectory(parseUnitId(request.unitId))}/${stamp(context).replace(/[-:]/g, '').replace('.000Z', '').replace('T', '-')}-${context.paths.machine}-${messageId}.md`;
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
  results.sort((left, right) => Number(left.state === 'canceled') - Number(right.state === 'canceled') || Date.parse(left.at) - Date.parse(right.at) || (left.id < right.id ? -1 : 1));
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

async function currentBeat(context) {
  if (context.beat) return context.beat;
  const machine = context.paths?.machine;
  if (!context.paths?.origin || !machine) return null;
  try {
    return JSON.parse(await readFile(path.join(context.paths.origin, 'machines', machine, 'service.json'), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function readStartRequest(context, requestId, options = {}) {
  const relative = await findRequest(context, requestId);
  const request = relative ? await readJson(context, relative) : null;
  if (!request) throw new CoreError(404, 'request_not_found', 'The start request does not exist.');
  const snapshot = async () => {
    const result = await latestResult(context, requestId);
    const current = (await listJournals(context)).find((item) => item.requestId === requestId) ?? null;
    const consumed = current?.createAttempted === true && current?.phase !== 'failed';
    const canceling = !result || result.state !== 'canceled' ? await readJson(context, `user/relay/request-cancellations/${requestId}.json`) : null;
    return { request, result: canceling ? { ...result, state: 'canceling' } : result, now: context.now(), consumed, state: current && !result ? 'starting' : 'queued', current };
  };
  const loaded = await snapshot();
  if (options.readOnly !== true && request.targetMachine === context.paths.machine && !loaded.result && !loaded.consumed && Date.parse(request.expiresAt) > context.now()) {
    consumeStart(context, requestId).catch(() => {});
  }
  if (options.readOnly === true || loaded.consumed || TERMINAL.has(loaded.result?.state) || Date.parse(request.expiresAt) > context.now()) return loaded;
  return withLocks(context.store, [`request:${requestId}`], async () => {
    const fresh = await snapshot();
    if (!fresh.consumed && !TERMINAL.has(fresh.result?.state)) {
      if (fresh.current && fresh.current.phase !== 'failed') await writeJournal(context, { ...fresh.current, phase: 'failed', pid: null });
      fresh.result = await writeResult(context, request, 'expired', null, { code: 'approval_expired', message: 'The start request expired.' });
    }
    return fresh;
  });
}

function adapterFor(context, client) {
  const adapter = context.adapters?.[client] ?? createNativeAdapter(client, { models: context.models ?? [] });
  return adapter;
}

function acceptFixture(client, transcript, request) {
  if (client === 'codex') {
    const start = transcript.map(parseCodexLine).find((line) => line.result?.thread?.id);
    if (!start) throw new CoreError(422, 'protocol_error', 'The native transcript/thread has no thread id.');
    return { nativeSessionId: start.result.thread.id, pid: 4101, fixture: true };
  }
  if (client === 'cursor') {
    const start = transcript.map(parseCursorLine).find((line) => line.result?.sessionId);
    if (!start) throw new CoreError(422, 'protocol_error', 'The ACP transcript has no session id.');
    return { nativeSessionId: start.result.sessionId, pid: 4102, fixture: true };
  }
  const init = transcript.map(parseClaudeLine).find((line) => line.type === 'system' && line.subtype === 'init');
  if (!init?.session_id || (request.nativeSessionId && init.session_id !== request.nativeSessionId)) {
    throw new CoreError(422, 'protocol_error', 'The native initialization session does not match.');
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

function cleanPath(value) {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.replaceAll('\\\\', '\\') : normalized;
}

function launchArgs(client, request = {}) {
  if (client === 'codex') return ['app-server', '--listen', 'stdio://'];
  if (client === 'cursor') return ['acp'];
  const args = ['--print', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', '--session-id', request.nativeSessionId ?? randomUUID()];
  if (request.nativeMcp) {
    const { name, command, args: serverArgs } = request.nativeMcp;
    args.push('--mcp-config', JSON.stringify({ mcpServers: { [name]: { command, args: serverArgs } } }));
  }
  return args;
}

const EXPLICIT_EXECUTABLE = {
  claude: 'HIVEM1ND_CLAUDE',
  codex: 'HIVEM1ND_CODEX',
  cursor: 'HIVEM1ND_CURSOR',
};

function explicitExecutable(client, env) {
  const key = EXPLICIT_EXECUTABLE[client];
  if (!key || env[key] == null || env[key] === '') return undefined;
  const value = env[key];
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\0\r\n]/.test(value)) return null;
  return value;
}

async function regularFile(file) {
  try {
    const stats = await lstat(file);
    return stats.isFile() && !stats.isSymbolicLink() ? file : null;
  } catch {
    return null;
  }
}

async function discoverCodex(env) {
  if (typeof env.LOCALAPPDATA !== 'string' || !path.isAbsolute(env.LOCALAPPDATA)) return null;
  const bin = path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
  let names;
  try {
    names = await readdir(bin, { withFileTypes: true });
  } catch {
    return null;
  }
  const found = [];
  for (const entry of names.slice(0, 32)) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (entry.name === '.' || entry.name === '..' || entry.name.includes('..')) continue;
    const directory = path.join(bin, entry.name);
    try {
      const stats = await lstat(directory);
      if (!stats.isDirectory() || stats.isSymbolicLink()) continue;
    } catch {
      continue;
    }
    const file = await regularFile(path.join(directory, 'codex.exe'));
    if (!file) continue;
    const stats = await lstat(file);
    found.push({ file, mtime: stats.mtimeMs });
  }
  found.sort((left, right) => right.mtime - left.mtime || left.file.localeCompare(right.file));
  return found[0]?.file ?? null;
}

async function discoverClaude(env) {
  const homes = [env.USERPROFILE, env.HOME].filter((item) => typeof item === 'string' && path.isAbsolute(item));
  for (const home of homes) {
    for (const relative of [['.local', 'bin', 'claude.exe'], ['.local', 'bin', 'claude.cmd']]) {
      const file = await regularFile(path.join(home, ...relative));
      if (file) return file;
    }
  }
  if (typeof env.APPDATA === 'string' && path.isAbsolute(env.APPDATA)) {
    return regularFile(path.join(env.APPDATA, 'npm', 'claude.cmd'));
  }
  return null;
}

async function locateClient(client, env, platform) {
  const explicit = explicitExecutable(client, env);
  if (explicit === null) return null;
  if (explicit) {
    const file = await regularFile(explicit);
    if (!file) return null;
    return { command: file, args: [] };
  }
  if (client === 'cursor') {
    const cursor = await cursorAgentCommand({ env, platform });
    if (!path.isAbsolute(cursor.command)) return null;
    const file = await regularFile(cursor.command);
    if (!file) return null;
    return { command: file, args: cursor.args };
  }
  const onPath = await findExecutable(client, env);
  if (onPath) return { command: onPath, args: [] };
  const discovered = client === 'codex' ? await discoverCodex(env) : client === 'claude' ? await discoverClaude(env) : null;
  return discovered ? { command: discovered, args: [] } : null;
}

export async function resolveLaunch(client, env = process.env, platform = process.platform, request = {}) {
  const located = await locateClient(client, env, platform);
  if (!located) return null;
  if (client === 'cursor') return { command: located.command, args: [...located.args, ...launchArgs(client, request)] };
  return unwrapLaunch(located.command, client, request);
}

function registeredProjectCwd(context, unitId) {
  const projects = (context.projects ?? []).filter((item) => item?.name && typeof item.localPath === 'string' && item.eligible !== false);
  let projectName = null;
  try {
    projectName = parseUnitId(unitId).project;
  } catch {
    projectName = null;
  }
  if (projectName) return projects.find((item) => item.name === projectName)?.localPath ?? null;
  return projects.length === 1 ? projects[0].localPath : null;
}

async function unwrapLaunch(file, client, request = {}) {
  if (!file) return null;
  if (!file.toLowerCase().endsWith('.cmd')) return { command: file, args: launchArgs(client, request) };
  let text = '';
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  const root = path.dirname(file);
  const expanded = text.replaceAll('%dp0%', `${root}${path.sep}`).replaceAll('%~dp0', `${root}${path.sep}`);
  const exe = [...expanded.matchAll(/"([^"\r\n]+\.exe)"/gi)].map((match) => match[1]).find((item) => !/[/\\]node\.exe$/i.test(item) && !item.includes('%'));
  if (exe) {
    try {
      const stats = await lstat(exe);
      if (stats.isFile() && !stats.isSymbolicLink()) return { command: cleanPath(exe), args: launchArgs(client, request) };
    } catch {
      // The wrapper names an executable that is not installed.
    }
  }
  const script = [...expanded.matchAll(/"([^"\r\n]+\.js)"/gi)].map((match) => match[1]).find((item) => !item.includes('%'));
  if (!script) return null;
  let node = process.execPath;
  try {
    const bundled = path.join(root, 'node.exe');
    if ((await lstat(bundled)).isFile()) node = bundled;
  } catch {
    // Use the Node executable that is already running this service.
  }
  return { command: node, args: [script, ...launchArgs(client, request)] };
}

function unavailable() {
  return new CoreError(503, 'client_unavailable', 'The native client is not available.');
}

function loginFailed(text) {
  return /not logged in|requires\s+openai\s+auth|uv_os_get_passwd|enomem/i.test(String(text));
}

// requiresOpenaiAuth describes the provider. A null account with that flag still needs sign-in.
function accountReady(message) {
  const result = message?.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  if (!Object.hasOwn(result, 'account')) return false;
  if (typeof result.requiresOpenaiAuth !== 'boolean') return false;
  if (result.account === null) return result.requiresOpenaiAuth === false;
  if (typeof result.account !== 'object' || Array.isArray(result.account)) return false;
  return result.account.type === 'chatgpt' || result.account.type === 'apiKey';
}

async function openOwnedChannel(client, child, request, timeoutMs) {
  const incoming = readLines(child, timeoutMs);
  const session = { nativeSessionId: null, turnId: null, closedTurns: [] };
  try {
    if (client === 'claude') {
      const nativeSessionId = await claudeHandshake(child, request, incoming);
      return { nativeSessionId, incoming, rpc: null, session: null };
    }
    const rpc = openRpc(child, incoming, session, timeoutMs);
    const nativeSessionId = client === 'codex' ? await codexHandshake(rpc, request) : await cursorHandshake(rpc, request);
    session.nativeSessionId = nativeSessionId;
    return { nativeSessionId, incoming, rpc, session };
  } catch (error) {
    incoming.close();
    throw error;
  }
}

function releaseSession(sessions, pid) {
  for (const [id, item] of sessions) {
    if (item.pid !== pid) continue;
    item.nativeLaunch?.close();
    item.incoming?.close();
    sessions.delete(id);
  }
}

async function submitCodex(session, text) {
  const input = [{ type: 'text', text }];
  // turn/steer echoes turnId. turn/start is the call that returns turn.id.
  const expected = typeof session.turnId === 'string' && session.turnId ? session.turnId : null;
  const started = expected
    ? await session.rpc.call('turn/steer', { threadId: session.nativeSessionId, expectedTurnId: expected, input })
    : await session.rpc.call('turn/start', { threadId: session.nativeSessionId, input });
  if (expected) {
    const turnId = started?.result?.turnId;
    if (typeof turnId !== 'string' || turnId !== expected) return { submitted: false, ambiguous: true };
    return { submitted: true };
  }
  const turnId = started?.result?.turn?.id;
  if (typeof turnId !== 'string' || !turnId) return { submitted: false, ambiguous: true };
  if (!session.closedTurns?.includes(turnId)) session.turnId = turnId;
  return { submitted: true };
}

async function submitCursor(session, text) {
  const prompted = await session.rpc.call('session/prompt', {
    sessionId: session.nativeSessionId,
    prompt: [{ type: 'text', text }],
  });
  if (!prompted?.result || typeof prompted.result !== 'object') return { submitted: false, ambiguous: true };
  if (typeof prompted.result.stopReason === 'string') await session.onCompleted?.();
  return { submitted: true };
}

async function submitClaude(session, text) {
  if (session.submission) return { submitted: false, ambiguous: true };
  let timer;
  const submitted = new Promise((resolve) => {
    session.submission = (result) => { clearTimeout(timer); session.submission = null; resolve(result); };
    timer = setTimeout(() => session.submission?.({ submitted: false, ambiguous: true }), session.timeoutMs);
  });
  try {
    sendLine(session.child, { type: 'user', message: { role: 'user', content: text } });
  } catch {
    session.submission?.({ submitted: false });
    return { submitted: false };
  }
  return submitted;
}

async function pumpClaude(session) {
  while (session.child.exitCode == null && !session.child.killed) {
    let message;
    try { message = parseClaudeLine(await session.incoming.line()); }
    catch (error) {
      if (error?.timeout === true) continue;
      session.submission?.({ submitted: false, ambiguous: true });
      break;
    }
    if (message.session_id && message.session_id !== session.nativeSessionId) continue;
    if (message.type === 'assistant' || message.type === 'result') {
      session.submission?.({ submitted: !message.is_error, ...(message.is_error ? { ambiguous: true } : {}) });
      session.submission = null;
    }
    if (message.type === 'result' && message.session_id === session.nativeSessionId) await session.onCompleted?.().catch(() => {});
  }
}

function startupInstruction(request) {
  const lines = [`Unit: ${request.unitId ?? ''}`];
  if (typeof request.job === 'string' && request.job) lines.push(`Job: ${request.job}`);
  if (typeof request.model === 'string' && request.model) lines.push(`Model: ${request.model}`);
  if (typeof request.leadId === 'string' && request.leadId) lines.push(`Lead: ${request.leadId}`);
  lines.push('Read the unit role, job and lead from the registered files and stay ready.');
  if (request.runMode === 'task') lines.push(`Assigned task: ${request.taskId ?? 'the task prompt in the mailbox'}. After terminal delivery or failure, call session_complete with outcome delivered or failed. The CLI closes after native completion is acknowledged.`);
  else if (request.runMode === 'chat') lines.push('Remain open as a chat until the person stops this session. Use session_open to request another CLI with approval.');
  return lines.join('\n');
}

async function claudeHandshake(child, request, incoming) {
  sendLine(child, { type: 'user', message: { role: 'user', content: startupInstruction(request) } });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const line = await incoming.line();
    if (loginFailed(line) || loginFailed(incoming.stderr())) throw unavailable();
    let message;
    try {
      message = parseClaudeLine(line);
    } catch {
      continue;
    }
    if (message?.type === 'result' && message.is_error) throw unavailable();
    if (message?.type === 'system' && message.subtype === 'init' && message.session_id === request.nativeSessionId) return request.nativeSessionId;
  }
  throw unavailable();
}

function noteTurn(session, message) {
  if (!session || message?.method !== 'turn/completed') return;
  const params = message.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return;
  const turn = params.turn;
  const turnId = turn && typeof turn === 'object' && !Array.isArray(turn) ? turn.id : null;
  if (typeof params.threadId !== 'string' || typeof turnId !== 'string' || !turnId) return;
  if (params.threadId !== session.nativeSessionId) return;
  if (!Array.isArray(session.closedTurns)) session.closedTurns = [];
  if (session.closedTurns.length >= 16) session.closedTurns.shift();
  session.closedTurns.push(turnId);
  if (session.turnId === turnId) session.turnId = null;
  if (session.terminalTurnId === turnId) session.onCompleted?.().catch(() => {});
}

function openRpc(child, incoming, session, timeoutMs) {
  let nextId = 1;
  let stopped = false;
  let started = false;
  const pending = new Map();
  const early = new Map();
  const failAll = (error) => {
    stopped = true;
    for (const waiter of [...pending.values()]) waiter.reject(error);
    early.clear();
  };
  const remember = (message) => {
    if (!message || message.id == null || message.method != null) return;
    if (message.result === undefined && message.error == null) return;
    const waiter = pending.get(message.id);
    if (!waiter) {
      if (!early.has(message.id) && early.size >= 8) early.delete(early.keys().next().value);
      early.set(message.id, message);
      return;
    }
    if (message.error != null) waiter.reject(unavailable());
    else waiter.resolve(message);
  };
  // A turn/completed notice arrives while no request is waiting, so the read loop stays up.
  const pump = async () => {
    while (!stopped) {
      let line;
      try {
        line = await incoming.line();
      } catch (error) {
        if (!stopped && error?.timeout === true) continue;
        failAll(unavailable());
        break;
      }
      if (stopped) break;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        if (loginFailed(line) || loginFailed(incoming.stderr())) failAll(unavailable());
        continue;
      }
      if (loginFailed(incoming.stderr())) {
        failAll(unavailable());
        break;
      }
      if (message?.error != null && loginFailed(JSON.stringify(message.error))) {
        remember(message);
        failAll(unavailable());
        break;
      }
      if (message?.method && message.id == null) {
        noteTurn(session, message);
        continue;
      }
      if (typeof message?.method === 'string' && (typeof message.id === 'string' || typeof message.id === 'number')) {
        // An unimplemented native permission request cannot wait indefinitely or imply approval.
        try { sendLine(child, { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'This native request is not supported by the attached service.' } }); }
        catch { failAll(unavailable()); }
        continue;
      }
      remember(message);
    }
  };
  incoming.onEnd(() => failAll(unavailable()));
  const ensure = () => {
    if (started) return;
    started = true;
    pump().catch(() => {});
  };
  return {
    call(method, params) {
      const id = nextId;
      nextId += 1;
      let timer;
      const promise = new Promise((resolve, reject) => {
        const waiter = {
          done: false,
          resolve(message) {
            if (waiter.done) return;
            waiter.done = true;
            clearTimeout(timer);
            pending.delete(id);
            resolve(message);
          },
          reject(error) {
            if (waiter.done) return;
            waiter.done = true;
            clearTimeout(timer);
            pending.delete(id);
            reject(error);
          },
        };
        timer = setTimeout(() => waiter.reject(unavailable()), timeoutMs);
        pending.set(id, waiter);
      });
      const message = { jsonrpc: '2.0', id, method };
      if (params !== undefined) message.params = params;
      try {
        sendLine(child, message);
      } catch {
        pending.get(id)?.reject(unavailable());
        return promise;
      }
      const queued = early.get(id);
      if (queued) {
        early.delete(id);
        remember(queued);
      }
      ensure();
      return promise;
    },
    notify(method, params) {
      const message = { jsonrpc: '2.0', method };
      if (params !== undefined) message.params = params;
      sendLine(child, message);
    },
  };
}

async function codexHandshake(rpc, request) {
  if (!request.cwd) throw unavailable();
  const init = await rpc.call('initialize', { clientInfo: { name: 'hivem1nd', title: 'HIVEM1ND', version: '3.0.0' } });
  if (init?.error) throw unavailable();
  rpc.notify('initialized');
  const account = await rpc.call('account/read', {});
  if (!accountReady(account)) throw unavailable();
  const params = { cwd: request.cwd };
  if (request.nativeMcp) {
    const { name, command, args } = request.nativeMcp;
    params.config = { mcp_servers: { [name]: { command, args, env_vars: ['HIVEM1ND_SERVICE_BRIDGE', 'HIVEM1ND_SERVICE_GRANT'] } } };
  }
  if (request.model) params.model = request.model;
  const thread = await rpc.call('thread/start', params);
  if (!thread.result?.thread?.id) throw unavailable();
  return thread.result.thread.id;
}

async function cursorHandshake(rpc, request) {
  if (!request.cwd) throw unavailable();
  const init = await rpc.call('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  });
  if (init?.error) throw unavailable();
  const method = (init.result?.authMethods ?? []).find((item) => /existing|login/i.test(`${item.id ?? ''} ${item.name ?? item}`));
  if (!method) throw unavailable();
  const auth = await rpc.call('authenticate', { methodId: method.id ?? method });
  if (auth?.error) throw unavailable();
  const session = await rpc.call('session/new', { cwd: request.cwd, mcpServers: request.nativeMcp ? [request.nativeMcp] : [] });
  if (!session.result?.sessionId) throw unavailable();
  return session.result.sessionId;
}

function sendLine(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function readLines(child, timeoutMs) {
  let buffer = '';
  let stderr = '';
  let ended = false;
  const queue = [];
  const pending = [];
  const listeners = new Set();
  const push = (line) => {
    if (ended) return;
    const waiter = pending[0];
    if (waiter) waiter.resolve(line);
    else queue.push(line);
  };
  const failPending = (error) => {
    for (const waiter of pending.splice(0)) waiter.reject(error);
  };
  const onStdout = (chunk) => {
    buffer += chunk.toString('utf8');
    if (buffer.length > 1000000) child.kill?.();
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      push(buffer.slice(0, newline).replace(/\r$/, ''));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  };
  const onStderr = (chunk) => {
    stderr += chunk.toString('utf8');
    if (stderr.length > 8000) stderr = stderr.slice(-8000);
  };
  const onExit = () => {
    if (!ended && buffer.trim()) push(buffer.trim());
    end(unavailable());
  };
  const end = (error) => {
    if (ended) return;
    ended = true;
    queue.length = 0;
    child.stdout?.off?.('data', onStdout);
    child.stderr?.off?.('data', onStderr);
    child.off?.('exit', onExit);
    failPending(error);
    for (const listener of listeners) listener();
  };
  child.stdout?.on?.('data', onStdout);
  child.stderr?.on?.('data', onStderr);
  child.once?.('exit', onExit);
  return {
    stderr: () => stderr,
    onEnd(listener) {
      listeners.add(listener);
      if (ended) listener();
    },
    line() {
      if (ended) return Promise.reject(unavailable());
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => {
        const waiter = {
          done: false,
          timer: null,
          resolve(line) {
            if (waiter.done) return;
            waiter.done = true;
            clearTimeout(waiter.timer);
            const index = pending.indexOf(waiter);
            if (index >= 0) pending.splice(index, 1);
            resolve(line);
          },
          reject(error) {
            if (waiter.done) return;
            waiter.done = true;
            clearTimeout(waiter.timer);
            const index = pending.indexOf(waiter);
            if (index >= 0) pending.splice(index, 1);
            reject(error);
          },
        };
        const error = unavailable();
        error.timeout = true;
        waiter.timer = setTimeout(() => waiter.reject(error), timeoutMs);
        pending.push(waiter);
      });
    },
    close() {
      end(unavailable());
    },
  };
}

function finishChild(child, requireExit = false) {
  if (!child) return Promise.resolve(null);
  return new Promise((resolve) => {
    if (child.exitCode != null) {
      resolve(child.exitCode);
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* The process is already gone. */ }
      resolve(requireExit ? null : 1);
    }, 2000);
    child.once?.('exit', (code) => {
      clearTimeout(timer);
      resolve(code ?? 0);
    });
    try { child.kill(); } catch {
      clearTimeout(timer);
      resolve(requireExit ? null : 1);
    }
  });
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
