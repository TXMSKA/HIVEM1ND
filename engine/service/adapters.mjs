import { lstat, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CLIENTS, CoreError, canonicalJson, hashBytes, inboxDirectory, parseTaskId, parseUnitId, uuidV8 } from './identity.mjs';
import { loadTask } from './tasks.mjs';
import { answersFor, readDetail } from './projection.mjs';
import { publishDomainEvents } from './events.mjs';
import { readUnitState, stateRunsIn } from './state.mjs';
import { cursorAgentCommand } from '../relay/cursor-wake.mjs';
import { commitTransaction, readBytes, revisionOf } from './store.mjs';
import { withLocks } from './store.mjs';
import { readAgentPermissions } from './settings.mjs';
import { additionsForUnit, readScopedAdditions } from './additions.mjs';
import { launchChoice } from './runs-in.mjs';
import { bindLaunchScope, prepareLaunchScope, readScopedFile, requestNativeOperation, writeScopedFile } from './file-access.mjs';
import { assertNoLinks } from './paths.mjs';
import { protectLocalFile } from './security.mjs';
import { discoverLyra, openLyraAdapter } from './lyra.mjs';
import { contextBootstrap } from './chats.mjs';

const LIFETIME_MS = 120000;
const PROMPT_MAX = 100000;
const TERMINAL = new Set(['started', 'failed', 'expired', 'canceled']);
const STARTABLE = new Set(CLIENTS);

export function ownsSessionExecution(context, record) {
  return record?.client === 'lyra' ? typeof record.executionId === 'string' && (context.ownedExecutions ?? context.store?.ownedExecutions)?.has(record.executionId) === true
    : Number.isInteger(record?.pid) && context.ownedPids?.has(record.pid) === true;
}

// Only a single, literal invocation is classified. Shells, aliases and expansion
// need the client's native prompt because their effective operation is unknown.
export function classifyApprovalAction(action, pattern) {
  if (action === 'git.commit' || action === 'git.push') return { gitAction: action, desktopOnly: action === 'git.push' };
  if (action !== 'process.run') return { gitAction: null, desktopOnly: false };
  const command = pattern?.command;
  const unsupported = () => { throw new CoreError(422, 'unsupported_capability', 'The command cannot be classified as one literal operation.'); };
  if (typeof command !== 'string' || !command.trim() || command.length > 100000 || /[\u0000-\u0008\u000a-\u001f\u007f\u2028\u2029]/.test(command)) unsupported();
  const tokens = command.match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s"']+/g) ?? [];
  if (tokens.join(' ').replace(/\s+/g, ' ') !== command.trim().replace(/\s+/g, ' ')) unsupported();
  const argv = tokens.map(token => {
    const quoted = token[0] === '"' || token[0] === "'";
    if (/[;&|<>`$^()%{}]/.test(token) || (!quoted && token.includes('#'))) unsupported();
    const value = quoted ? token.slice(1, -1) : token;
    if (value.includes('\\') && !/^[A-Za-z]:\\/.test(value)) unsupported();
    return value;
  });
  const executable = argv.shift()?.replaceAll('\\', '/').split('/').at(-1).toLowerCase();
  if (/^(?:sh|bash|zsh|fish|cmd|powershell|pwsh|env|call|start|command|exec|sudo|nohup|nice|time|xargs|eval)(?:\.exe)?$/.test(executable) || executable?.includes('=')) unsupported();
  if (/^git\.(?:cmd|bat)$/.test(executable)) unsupported();
  if (!['git', 'git.exe'].includes(executable)) return { gitAction: null, desktopOnly: false };
  while (argv[0]?.startsWith('-')) {
    if (['-C', '--git-dir', '--work-tree'].includes(argv[0]) && argv[1] && !argv[1].startsWith('-')) argv.splice(0, 2);
    else if (/^--(?:git-dir|work-tree)=.+$/.test(argv[0]) || ['--no-pager', '--no-optional-locks'].includes(argv[0])) argv.shift();
    else unsupported();
  }
  const operation = argv.shift();
  if (!['push', 'commit', 'status', 'diff', 'log', 'show', 'fetch', 'pull', 'checkout', 'switch', 'branch', 'add', 'restore', 'reset', 'merge', 'rebase', 'rev-parse', 'ls-files', 'ls-remote', 'clone', 'init', 'tag'].includes(operation)) unsupported();
  const gitAction = ['push', 'commit'].includes(operation) ? `git.${operation}` : null;
  return { gitAction, desktopOnly: gitAction === 'git.push' };
}

export async function sessionGitPermissions(context, sessionId, { unitId, client, repository } = {}) {
  const registration = await registrationFor(context, sessionId);
  const journal = (await listJournals(context)).find(item => item.sessionId === sessionId && item.phase === 'registered');
  if (!registration || registration.machine !== context.paths.machine || registration.launchKind !== 'cli'
    || !ownsSessionExecution(context, journal) || journal.unitId !== registration.unitId || journal.client !== registration.client
    || unitId !== registration.unitId || client !== registration.client || repository !== journal.repository) return [];
  const permissions = await readAgentPermissions(context);
  return permissions.filter(item => journal.permissionIds?.includes(item.id) && item.client === client)
    .map(item => ({ ...item, sessionId, unitId, repository }));
}

export async function probeClients(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const reports = {};
  for (const client of CLIENTS) {
    if (client === 'lyra') {
      const isolated = options.store?.confineRoot ? { env: { ...env, LYRA_HOME: path.join(options.store.confineRoot, 'lyra') } } : {};
      const found = await discoverLyra({ ...options, ...isolated });
      reports.lyra = { client, installed: Boolean(found), command: null, version: found?.serviceVersion ?? null,
        nativeSupport: false, reason: found ? 'lyra_permission_unverified' : 'lyra_offline',
        capabilities: { create: false, resume: false, stop: true, exactApproval: true, modelSelection: true } };
      continue;
    }
    const located = client === 'lyra' ? null : await locateClient(client, env, platform);
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
    return { id, enabled: installed, installed, supported: CLIENTS.includes(id), reason: reports?.[id]?.reason ?? null };
  });
}

export function createNativeAdapter(client, options = {}) {
  if (client === 'lyra') return openLyraAdapter(options);
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
      scopedContent: typeof options.scopedContent?.bind === 'function',
    },
    models,
    async describe(context = {}) {
      if (typeof options.describe === 'function') return options.describe();
      if (fixture) return { id: client, title: client, connected: true, scopeEnforced: true,
        models: models.map(id => ({ id, title: id, efforts: options.efforts ?? ['high'], modes: [] })),
        quota: { remainingPercent: null, period: null, known: false }, context: { known: false, compact: false } };
      if (client === 'codex' && live) return probeCodexChoices(options);
      if (live && ['claude', 'cursor'].includes(client)) return probeNativeChoices(client, options, context);
      return { id: client, title: client, connected: false, models: [], scopeEnforced: false,
        quota: { remainingPercent: null, period: null, known: false }, context: { known: false, compact: false } };
    },
    async probe() {
      return { client, nativeSupport: this.nativeSupport, installed: this.capabilities.create };
    },
    async create(request) {
      if (!this.capabilities.create) throw new CoreError(503, 'client_unavailable', 'The native client is not available.');
      if (!request.runsIn && request.model && !models.includes(request.model)) throw new CoreError(422, 'unsupported_model', 'The requested model is not installed.');
      assertNoBypass(request.argv ?? []);
      if (request.runsIn && (request.runsIn.client !== client || request.model !== request.runsIn.model || request.effort !== request.runsIn.effort)) {
        throw new CoreError(422, 'unsupported_launch_choice', 'The immutable launch choice does not match the native request.');
      }
      if (request.runsIn) {
        const capability = await this.describe({ localDirectory: request.probeDirectory });
        launchChoice({ runsIn: request.runsIn }, [capability]);
        if (capability.scopeEnforced !== true) throw new CoreError(409, 'scope_unavailable', 'This client has no verified filesystem and process boundary.');
      }
      if (request.runsIn && !fixture && client !== 'codex' && typeof options.enforceScope !== 'function') throw new CoreError(409, 'scope_unavailable', 'This client has no verified filesystem and process boundary.');
      if (fixture) {
        const created = acceptFixture(client, options.transcript ?? [], request);
        for (const line of options.transcript ?? []) await request.planTranscript?.(JSON.parse(line));
        const exit = new EventEmitter(), identity = randomUUID(); let ended = false;
        const processHandle = options.planProcessHandle ?? { identity, verify: async () => true,
          onExit: listener => { exit.on('exit', listener); return () => exit.off('exit', listener); },
          cleanup: async () => ({ closed: ended, identity }), stop: async () => { ended = true; exit.emit('exit'); return { acknowledged: true }; } };
        sessions.set(created.nativeSessionId, { ...created, unitId: request.unitId, closedTurns: [], planProcessHandle: processHandle, observer: request.planObserver, permissionRequest: request });
        request.planObserver?.({ id: 'native-init', kind: 'start' });
        return { ...created, processHandle };
      }
      if (request.planObserver && typeof options.enforceScope !== 'function') throw new CoreError(409, 'cleanup_unavailable', 'Plan execution requires a verified job or process-group handle.');
      const nativeLaunch = options.createNativeLaunch?.({ ...request, client }) ?? null;
      request = { ...request, nativeMcp: nativeLaunch?.mcp ?? null };
      if (client === 'claude' && !request.nativeSessionId) request.nativeSessionId = randomUUID();
      let child;
      const permissionAbort = new AbortController();
      try {
        const resolved = options.command
          ? { command: options.command, args: options.args ?? launchArgs(client, request) }
          : await resolveLaunch(client, options.env ?? process.env, options.platform ?? process.platform, request);
        if (!resolved?.command) throw new CoreError(503, 'client_unavailable', 'The native client is not available.');
        assertNoBypass(resolved.args);
        const spawnOptions = {
          shell: false,
          windowsHide: true,
          cwd: request.cwd || undefined,
          env: nativeLaunch ? { ...(options.env ?? process.env), ...nativeLaunch.env } : options.env ?? process.env,
          stdio: ['pipe', 'pipe', 'pipe'],
        };
        if (request.runsIn && typeof options.enforceScope === 'function') {
          const enforced = await options.enforceScope({ command: resolved.command, args: resolved.args, options: spawnOptions, scope: request.launchScope,
            policy: { gitBrokerOnly: true, indirectWrites: 'confined', outsideWrites: 'exact-once', ...(request.planAuthority ? { plan: request.planAuthority } : {}) } });
          if (enforced?.verified !== true || typeof enforced.spawn !== 'function') throw new CoreError(409, 'scope_unavailable', 'The OS sandbox could not be verified.');
          request.nativeBoundary = { ...enforced, signal: permissionAbort.signal };
          if (request.planObserver && !enforced.processHandle) throw new CoreError(409, 'cleanup_unavailable', 'The native job ownership is unavailable.');
          child = enforced.spawn();
        } else child = (options.spawn ?? spawn)(resolved.command, resolved.args, spawnOptions);
      } catch (error) {
        nativeLaunch?.close();
        throw error;
      }
      child.once?.('exit', () => { permissionAbort.abort(); nativeLaunch?.close(); });
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
        record.launchChoice = request.runsIn ?? null;
        record.permissionRequest = request;
        record.planProcessHandle = request.nativeBoundary?.processHandle;
        record.contextBootstrap = request.bootstrap ?? '';
        record.contextMessages = request.retainedContext?.messages ?? [];
        if (!Array.isArray(record.closedTurns)) record.closedTurns = [];
        sessions.set(opened.nativeSessionId, record);
        if (client === 'claude') pumpClaude(record);
        nativeLaunch?.ready(opened.nativeSessionId);
        request.planObserver?.({ id: 'native-init', kind: 'start' });
        return { nativeSessionId: opened.nativeSessionId, pid: child.pid, owned: true, processHandle: request.nativeBoundary?.processHandle };
      } catch (error) {
        clearTimeout(deadline);
        nativeLaunch?.close();
        opened?.incoming?.close();
        let exited;
        if (request.planObserver) {
          const handle = request.nativeBoundary?.processHandle;
          if (await handle?.verify?.() === true && (await handle.stop())?.acknowledged === true) {
            const cleanup = await handle.cleanup();
            if (cleanup?.closed === true && cleanup.identity === handle.identity) exited = 0;
          }
        } else exited = await finishChild(child, true);
        if (exited == null) {
          const ambiguous = new CoreError(409, 'launch_ambiguous', 'The launch could not be proved or stopped.');
          ambiguous.ownedPid = child.pid;
          throw ambiguous;
        }
        if (child?.pid) children.delete(child.pid);
        if (error instanceof CoreError) throw error;
        throw new CoreError(503, 'client_unavailable', 'The native client is not available.');
      }
    },
    async confirm(proof) {
      if (!proof || proof.client !== client || typeof proof.nativeSessionId !== 'string') return false;
      const session = sessions.get(proof.nativeSessionId);
      if (session && proof.pid !== undefined && session.pid !== proof.pid) return false;
      if (fixture && session) return !proof.unitId || proof.unitId === session.unitId;
      if (!session?.child || session.child.exitCode != null || session.child.killed === true) return false;
      if (proof.unitId && session.unitId && proof.unitId !== session.unitId) return false;
      return true;
    },
    async bindContent(proof, read) {
      if (!this.capabilities.scopedContent || await this.confirm(proof) !== true) throw new CoreError(503, 'scope_unavailable', 'The client cannot enforce scoped content for this session.');
      const result = await options.scopedContent.bind({ ...proof }, read);
      if (result?.bound !== true || result.unitId !== proof.unitId || result.nativeSessionId !== proof.nativeSessionId) throw new CoreError(503, 'scope_unavailable', 'The client did not confirm its scoped content binding.');
      return { bound: true };
    },
    async runtimeAvailable(requirement) {
      return options.scopedContent?.runtimeAvailable ? options.scopedContent.runtimeAvailable(requirement) : false;
    },
    async registered(request, registration, context) {
      const session = sessions.get(registration.nativeSessionId);
      if (session && context) {
        session.contextOwner = context;
        session.registration = registration;
        await persistNativeContext(session);
        session.gitPermissions = request.gitPermissions;
        session.onCompleted = async () => {
          if (request.planObserver) {
            if (session.taskTerminal) await session.planProcessHandle?.stop?.();
            return;
          }
          if (!session.taskTerminal || request.runMode !== 'task') return;
          await stopSession(context, registration.sessionId, { confirmed: true });
        };
        if (!request.planObserver) session.child?.once?.('exit', () => stopSession(context, registration.sessionId, { confirmed: true }).catch(() => {}));
      }
      return request.planActor ? { bound: true } : options.onNativeRegistered?.({ request, registration });
    },
    async gitPermissions({ nativeSessionId, unitId }) {
      const session = sessions.get(nativeSessionId);
      return session?.unitId === unitId && typeof session.gitPermissions === 'function' ? session.gitPermissions() : [];
    },
    async completeTask(input) {
      const session = sessions.get(input.nativeSessionId);
      if (!session || session.unitId !== input.unitId) throw new CoreError(409, 'stop_unavailable', 'The native task binding is unavailable.');
      session.taskTerminal = true;
      session.terminalTurnId = session.turnId;
      return { acknowledged: true };
    },
    async completePlanTask(input) {
      const session = sessions.get(input.nativeSessionId);
      if (!session || !session.permissionRequest?.planObserver && !session.observer) throw new CoreError(403, 'forbidden', 'The plan task is not bound.');
      session.taskTerminal = true; session.terminalTurnId = session.turnId;
      if (fixture) await session.planProcessHandle.stop();
      else if (!session.turnId && client !== 'claude') await session.permissionRequest.nativeBoundary.processHandle.stop();
      return { acknowledged: true };
    },
    async taskEnded(input) {
      if (!fixture) throw new CoreError(409, 'stop_unavailable', 'Only the native transport observes completion.');
      await sessions.get(input.nativeSessionId)?.onCompleted?.();
    },
    async send(input = {}) {
      const session = sessions.get(input?.nativeSessionId);
      if (session?.contextUpdating) return { submitted: false, deferred: true };
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
    async readContext(proof) {
      const session = sessions.get(proof.nativeSessionId);
      return session?.contextMeter ?? null;
    },
    async contextBusy(proof) {
      const session = sessions.get(proof.nativeSessionId);
      return Boolean(session?.turnId || session?.submission || session?.busy);
    },
    async reserveContext(proof) {
      const session = sessions.get(proof.nativeSessionId);
      if (!session || session.contextUpdating || session.turnId || session.submission || session.busy) return false;
      session.contextUpdating = true;
      return true;
    },
    async releaseContext(proof) { const session = sessions.get(proof.nativeSessionId); if (session) session.contextUpdating = false; },
    async checkpointContext(proof) {
      const session = sessions.get(proof.nativeSessionId);
      if (!session) throw new CoreError(409, 'context_unavailable', 'The native context is unavailable.');
      const threadId = session.contextThreadId ?? session.nativeSessionId;
      let history = null;
      if (client === 'codex' && session.rpc && proof.cached !== true) {
        const result = await session.rpc.call('thread/read', { threadId, includeTurns: true });
        if (result.result?.thread?.id !== threadId || Buffer.byteLength(canonicalJson(result.result.thread)) > 1048576) throw unavailable();
        history = result.result.thread;
      }
      return { client, threadId, history, messages: session.contextMessages ?? [] };
    },
    async resumePlanReview(input) {
      const session = sessions.get(input.nativeSessionId), checkpoint = input.conversation?.checkpoint;
      if (input.role !== 'reviewer' || session?.permissionRequest?.planActor?.role !== 'reviewer' || checkpoint?.client !== client
        || canonicalJson(checkpoint) !== canonicalJson(session.permissionRequest.retainedContext)
        || !Array.isArray(checkpoint.messages) || Buffer.byteLength(canonicalJson(checkpoint)) > PROMPT_MAX) return false;
      // The verified checkpoint was applied to the new native request, with new actor credentials and review-only authority.
      session.contextMessages = structuredClone(checkpoint.messages); return true;
    },
    async summarizeContext(input) {
      const session = sessions.get(input.nativeSessionId);
      if (!session || fixture || !['codex', 'cursor'].includes(client)) throw new CoreError(409, 'context_unavailable', 'This transport has no verified summary operation.');
      const messages = input.checkpoint?.history ?? input.checkpoint?.messages ?? [];
      const text = `Summarize this conversation in at most 8000 characters. Retain decisions, pending work and constraints. Return only the summary. Do not call tools.\n${canonicalJson(messages)}`;
      if (Buffer.byteLength(text) > PROMPT_MAX) throw new CoreError(409, 'context_unavailable', 'The native summary input exceeds its bound.');
      const threadId = await newContextThread(client, session, '');
      session.permissionRequest.contextOnlyThreads ??= new Set();
      session.permissionRequest.contextOnlyThreads.add(threadId);
      return nativeSummary(client, session, threadId, text);
    },
    async prepareContext(input) {
      const session = sessions.get(input.nativeSessionId);
      if (!session || fixture || !['codex', 'cursor'].includes(client) || session.turnId || session.submission || session.busy) throw new CoreError(409, 'context_unavailable', 'This transport cannot safely replace its current context.');
      session.contextReplacements ??= new Map();
      if (session.contextReplacements.has(input.requestId)) return session.contextReplacements.get(input.requestId);
      const bootstrap = input.summary === null ? input.bootstrap : `${input.bootstrap}\nConversation summary:\n${input.summary}`;
      const threadId = await newContextThread(client, session, bootstrap);
      const replacement = { acknowledged: true, generationId: randomUUID(), summary: input.summary, threadId, bootstrap,
        messages: input.summary ? [{ role: 'assistant', content: input.summary }] : [] };
      session.contextReplacements.set(input.requestId, replacement);
      return replacement;
    },
    async reconcileContext(input) {
      const replacement = sessions.get(input.nativeSessionId)?.contextReplacements?.get(input.requestId);
      return replacement ? { acknowledged: true, requestId: input.requestId, generationId: replacement.generationId,
        replacement, summary: replacement.summary, bootstrap: replacement.bootstrap } : null;
    },
    async commitContext(input) {
      const session = sessions.get(input.nativeSessionId), replacement = input.replacement;
      if (!session || session.contextReplacements?.get(input.requestId)?.threadId !== replacement?.threadId) return false;
      if (session.appliedContext === input.requestId) return true;
      session.contextThreadId = replacement.threadId;
      session.permissionRequest.contextNativeSessionId = replacement.threadId;
      session.contextBootstrap = replacement.bootstrap;
      session.contextMessages = replacement.messages;
      session.contextMeter = null;
      await persistNativeContext(session);
      session.appliedContext = input.requestId;
      return true;
    },
    async requestPermission(nativeRequest) {
      const choice = (nativeRequest?.options ?? []).find((option) => option === 'allow-once' || option === 'reject-once');
      if (!choice || nativeRequest?.always === true) throw new CoreError(422, 'always_unavailable', 'The native request has no exact once decision.');
      return { decision: choice, requestId: nativeRequest.id };
    },
    async permission(proof, input) {
      if (await this.confirm(proof) !== true) throw new CoreError(409, 'scope_unavailable', 'The native permission actor is no longer owned.');
      const session = sessions.get(proof.nativeSessionId);
      const response = await nativePermissionReply({ type: 'control_request', request_id: input.requestId, session_id: proof.nativeSessionId,
        request: { subtype: 'can_use_tool', tool_name: input.toolName, input: input.input } },
      { ...session.permissionRequest, nativeSessionId: proof.nativeSessionId, cwd: input.cwd });
      return { decision: response.response.response.behavior === 'allow' ? 'allow' : 'deny' };
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
  await import('./runs.mjs').then(module => module.assertPlanLaunchAuthority(context, input.unitId));
  const unit = parseUnitId(input.unitId);
  const state = (await readUnitState(context, unit))?.bytes;
  if (!state || /^removed:\s*true\s*$/m.test(state.toString('utf8').split(/\r?\n\r?\n/, 1)[0])) throw new CoreError(404, 'unit_not_found', 'The unit does not exist.');
  const stored = stateRunsIn(state);
  let choice = null;
  if (stored) {
    const reports = await import('./settings.mjs').then(module => module.connectedClients(context));
    choice = launchChoice({ runsIn: stored }, reports);
    if (reports.find(report => report.id === choice.client)?.scopeEnforced !== true) throw new CoreError(409, 'scope_unavailable', 'The selected client cannot enforce file and process scope.');
  } else throw new CoreError(409, 'scope_unresolved', 'Choose Runs in before launching this agent.');
  if (input.client !== undefined && input.client !== choice.client || input.model !== undefined && input.model !== choice.model
    || input.effort !== undefined && input.effort !== choice.effort) throw new CoreError(422, 'unsupported_launch_choice', 'Use the stored Runs in choice.');
  const client = choice?.client ?? input.client;
  if (!STARTABLE.has(client)) throw new CoreError(503, 'client_unavailable', 'That client cannot start a session.');
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
  if (!adapter.capabilities.create) throw new CoreError(503, 'client_unavailable', 'The native client is not available.');
  const request = {
    format: 'hivem1nd-session-request-v1',
    id,
    unitId: unit.id,
    targetMachine,
    requestedBy: context.principal?.unitId ?? 'root:master',
    sourceMachine: context.paths.machine,
    client,
    model: choice.model,
    runsIn: choice,
    effort: choice.effort,
    fresh: role !== 'overseer' || !/^fresh:\s*false\s*$/m.test(state.toString('utf8').split(/\r?\n\r?\n/, 1)[0]),
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
    try {
      return await withLocks(context.store, [`launch:${request.unitId}`, `request:${requestId}`], () => launch(context, request));
    } catch (error) {
      if (error instanceof CoreError && error.code !== 'injected_crash') {
        await writeResult(context, request, 'failed', null, { code: error.code, message: error.message });
        const journal = (await listJournals(context)).find(item => item.requestId === requestId);
        if (journal && journal.createAttempted !== true) await writeJournal(context, { ...journal, phase: 'failed' });
      }
      throw error;
    }
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
    if (journal.phase === 'registered' && (journal.client !== 'lyra' || ownsSessionExecution(context, journal))) {
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
  const plan = await import('./runs.mjs').then(module => module.planBindingForSession(context, sessionId));
  if (plan) return import('./runs.mjs').then(module => module.stopPlanSession(context, plan, input));
  return withLocks(context.store, [`stop:${sessionId}`], () => stopOwnedSession(context, sessionId, input));
}

// Applying a reviewed configuration never grants ownership of an app process.
// Active CLI work needs an adapter-supported reload or an explicit close first.
export async function reloadReviewedClient(context, { client, target, previewId, checkOnly = false }) {
  const journals = (await listJournals(context)).filter(item => item.client === client && !['failed', 'stopped'].includes(item.phase)
    && ownsSessionExecution(context, item));
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
  if (!ownsSessionExecution(context, journal)) {
    throw new CoreError(409, 'stop_unavailable', 'The session is not an owned native process.');
  }
  const adapter = adapterFor(context, journal.client);
  const native = await adapter.checkpointContext?.({ ...registration, cached: true });
  if (native) {
    const file = path.join(context.paths.localDirectory, 'contexts', sessionId, 'native.json');
    const before = await readBytes(context.store, file);
    await commitTransaction(context.store, { id: randomUUID(), entries: [{ resource: file, recordPath: file, private: true,
      beforeRevision: revisionOf(before), afterBytes: jsonBytes(native) }], events: [] });
  }
  if (adapter.capabilities?.stop !== true || typeof adapter.stop !== 'function') throw new CoreError(409, 'stop_unavailable', 'The native client cannot stop this session.');
  const stopped = await adapter.stop({ owned: true, pid: journal.pid, executionId: journal.executionId, sessionId });
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
  if (journal.executionId) (context.ownedExecutions ?? context.store.ownedExecutions)?.delete(journal.executionId);
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
  const plan = await import('./runs.mjs').then(module => module.planBindingForSession(context, sessionId));
  if (plan) throw new CoreError(422, 'invalid_binding', 'Report this plan task explicitly through plan_report.');
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
  if (!ownsSessionExecution(context, journal)) throw new CoreError(409, 'stop_unavailable', 'The native task is not owned by this service.');
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
  if ((journal?.pid || journal?.executionId) && journal.phase !== 'stopped') {
    if (journal.sessionId) await stopSession(context, journal.sessionId, { confirmed: true });
    else {
      if (!ownsSessionExecution(context, journal)) throw new CoreError(409, 'stop_unavailable', 'The uncertain launch cannot be stopped safely.');
      const stopped = await adapterFor(context, journal.client).stop({ owned: true, pid: journal.pid, executionId: journal.executionId });
      if (stopped?.acknowledged !== true) throw new CoreError(409, 'stop_unavailable', 'The uncertain launch cannot be stopped safely.');
      context.ownedPids.delete(journal.pid);
      if (journal.executionId) (context.ownedExecutions ?? context.store.ownedExecutions)?.delete(journal.executionId);
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

export async function contextSession(context, sessionId) {
  const registration = await registrationFor(context, sessionId);
  if (!registration) throw new CoreError(404, 'session_not_found', 'The session does not exist.');
  if (registration.machine !== context.paths.machine) throw new CoreError(409, 'machine_unavailable', 'Renew context on its immutable owner.');
  const journal = (await listJournals(context)).find(item => item.sessionId === sessionId && item.phase === 'registered');
  const adapter = adapterFor(context, registration.client);
  if (!ownsSessionExecution(context, journal) || await adapter.confirm(registration) !== true) throw new CoreError(409, 'context_unavailable', 'The native context is not owned and live.');
  return { registration, adapter };
}

async function previousContext(context, request) {
  if (request.fresh !== false) return null;
  const journals = (await listJournals(context)).filter(item => item.unitId === request.unitId && item.client === request.client
    && item.sessionId && item.requestId !== request.id).sort((a, b) => (b.contextSequence ?? 0) - (a.contextSequence ?? 0)
      || String(b.at).localeCompare(String(a.at)));
  for (const journal of journals) {
    const bytes = await readBytes(context.store, path.join(context.paths.localDirectory, 'contexts', journal.sessionId, 'native.json'));
    if (bytes) return JSON.parse(bytes);
  }
  return null;
}

async function launch(context, request) {
  await import('./runs.mjs').then(module => module.assertPlanLaunchAuthority(context, request.unitId));
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
  if (!request.runsIn) throw new CoreError(409, 'scope_unresolved', 'Choose Runs in before launching this agent.');
  const scope = await prepareLaunchScope(context, request);
  const cwd = scope.cwd;
  if (journals.some((item) => item.unitId === request.unitId && item.requestId !== request.id && !['failed', 'stopped'].includes(item.phase) && item.createAttempted === true)) {
    throw new CoreError(409, 'unit_in_use', 'The unit already has a launch in progress.');
  }
  const adapter = adapterFor(context, request.client);
  if (request.runsIn) {
    const report = await adapter.describe?.({ localDirectory: scope.directory, store: context.store });
    request = { ...request, runsIn: launchChoice({ runsIn: request.runsIn }, report ? [report] : []) };
    if (report.scopeEnforced !== true) throw new CoreError(409, 'scope_unavailable', 'The native boundary changed before launch.');
  }
  try {
    const additions = await additionsForUnit(context, request.unitId);
    if (additions.length && (adapter.capabilities?.scopedContent !== true || typeof adapter.bindContent !== 'function')) throw new CoreError(503, 'scope_unavailable', 'The client cannot enforce scoped content for this session.');
    for (const addition of additions) for (const requirement of addition.record.requirements) {
      if (await adapter.runtimeAvailable?.(requirement) !== true) throw new CoreError(503, 'runtime_unavailable', `Required runtime unavailable: ${requirement}.`, { requirement });
    }
  } catch (error) {
    await writeJournal(context, { requestId: request.id, unitId: request.unitId, client: request.client, phase: 'failed', pid: null, sessionId: null, createAttempted: false, at: stamp(context) });
    await writeResult(context, request, 'failed', null, { code: error instanceof CoreError ? error.code : 'scope_unavailable', message: error instanceof CoreError ? error.message : 'The scoped content check could not be verified.' });
    throw error;
  }
  const contentReader = proof => readScopedAdditions(context, { unitId: request.unitId, client: request.client,
    nativeSessionId: proof.nativeSessionId, sessionId: uuidV8(['session', context.paths.machine, request.client, proof.nativeSessionId, request.unitId]) });
  const repository = scope.scope.writeRoots.find(root => root.gitCommonDir)?.realPath ?? null;
  const permissions = (await readAgentPermissions(context)).filter(item => item.client === request.client && repository !== null);
  const permissionBinding = { repository, permissionIds: permissions.map(item => item.id) };
  await writeJournal(context, { requestId: request.id, unitId: request.unitId, client: request.client, phase: 'prepared', pid: null, sessionId: null, createAttempted: false, at: stamp(context) });
  if (context.launchFault === 'prepared') throw new CoreError(500, 'injected_crash', 'Injected crash before native creation.');
  await writeJournal(context, { requestId: request.id, unitId: request.unitId, client: request.client, phase: 'prepared', pid: null, sessionId: null, createAttempted: true, at: stamp(context) });
  if (context.launchFault === 'gap') throw new CoreError(500, 'injected_crash', 'Injected crash during native creation.');
  let created;
  try {
    const actorContext = () => {
      if (!created) throw new CoreError(409, 'scope_unavailable', 'The native session is not registered yet.');
      return { ...context, principal: { audience: 'agent', unitId: request.unitId,
        sessionId: uuidV8(['session', context.paths.machine, request.client, created.nativeSessionId, request.unitId]) } };
    };
    created = await adapter.create({ ...request, bootstrap: await contextBootstrap(context, request.unitId), retainedContext: await previousContext(context, request), cwd, probeDirectory: scope.directory, launchScope: scope.scope, contentReader: adapter.capabilities?.scopedContent ? contentReader : null,
      nativePermission: (operation, boundary) => requestNativeOperation(actorContext(), operation, boundary),
      scopedRead: input => readScopedFile(actorContext(), input),
      scopedWrite: input => writeScopedFile(actorContext(), input),
      store: context.store,
      agentPermissions: permissions.map(item => ({ ...item, unitId: request.unitId, requestId: request.id, repository })) });
  } catch (error) {
    if (error?.ownedPid) {
      context.ownedPids ??= new Set();
      context.ownedPids.add(error.ownedPid);
      await writeJournal(context, { requestId: request.id, unitId: request.unitId, client: request.client, phase: 'ambiguous', pid: error.ownedPid, sessionId: null, createAttempted: true, at: stamp(context) });
      return finish(context, request, 'failed', null, { code: 'launch_ambiguous', message: 'The native launch has not been confirmed.' });
    }
    if (error instanceof CoreError) {
      await writeJournal(context, { requestId: request.id, unitId: request.unitId, client: request.client, phase: 'failed', pid: null, sessionId: null, createAttempted: true, at: stamp(context) });
      await writeResult(context, request, 'failed', null, { code: error.code, message: error.message });
    }
    throw error;
  }
  const pid = created.pid;
  context.ownedPids ??= new Set();
  if (created.executionId) { context.ownedExecutions ??= context.store.ownedExecutions ??= new Set(); context.ownedExecutions.add(created.executionId); }
  else context.ownedPids.add(pid);
  const ownership = created.executionId ? { executionId: created.executionId } : {};
  await writeJournal(context, { requestId: request.id, unitId: request.unitId, client: request.client, phase: 'spawned', pid, ...ownership, sessionId: null, createAttempted: true, nativeSessionId: created.nativeSessionId, at: stamp(context) });
  if (context.launchFault === 'spawned') throw new CoreError(500, 'injected_crash', 'Injected crash after spawn.');
  const registration = await registerNative(context, { client: request.client, nativeSessionId: created.nativeSessionId, unitId: request.unitId, runMode: request.runMode, taskId: request.taskId, launchKind: 'cli' });
  if (scope) await bindLaunchScope(context, scope.scope, registration, pid, created.executionId);
  await writeJournal(context, { requestId: request.id, unitId: request.unitId, client: request.client, phase: 'registered', pid, ...ownership, nativeSessionId: created.nativeSessionId, sessionId: registration.sessionId,
    contextSequence: Math.max(0, ...journals.map(item => item.contextSequence ?? 0)) + 1, createAttempted: true, ...permissionBinding, at: stamp(context) });
  const { createContext } = await import('./context.mjs');
  await createContext(context, registration, adapter);
  try {
    if (adapter.capabilities?.scopedContent) {
      const proof = { unitId: request.unitId, client: request.client, nativeSessionId: created.nativeSessionId, machine: context.paths.machine, sessionId: registration.sessionId };
      const bound = await adapter.bindContent(proof, () => contentReader(proof));
      if (bound?.bound !== true) throw new CoreError(503, 'scope_unavailable', 'The client did not confirm its scoped content binding.');
    }
    await adapter.registered?.({ ...request,
      onLocalStarted: () => localResult(context, request, 'started', registration.sessionId, null),
      onLocalFailed: error => localResult(context, request, 'failed', registration.sessionId, { code: error.code ?? 'lyra_turn_failed', message: 'The local turn could not be confirmed.' }),
      onLocalAborted: () => stopSession(context, registration.sessionId, { confirmed: true }),
      gitPermissions: () => sessionGitPermissions(context, registration.sessionId, { unitId: request.unitId, client: request.client, repository }) }, registration,
    { ...context, localTaskEnded: binding => stopSession(context, binding.sessionId, { confirmed: true }) });
  } catch (error) {
    await stopSession(context, registration.sessionId, { confirmed: true });
    await writeJournal(context, { requestId: request.id, unitId: request.unitId, client: request.client, phase: 'failed', pid, sessionId: registration.sessionId, createAttempted: true, at: stamp(context) });
    return finish(context, request, 'failed', null, { code: error.code ?? 'native_login_unverified', message: 'The native session could not enter Relay.' });
  }
  if (await readJson(context, `user/relay/request-cancellations/${request.id}.json`)) return { status: 200, request, result: await cancelOwnedStart(context, request) };
  await preload(context, request);
  if (request.client === 'lyra') return { status: 202, request, state: 'starting', result: await latestResult(context, request.id), replayed: false };
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
  const bytes = Buffer.from(`id: ${messageId}\nfrom: master\nfrom-id: root:master\nto-id: ${request.unitId}\nkind: message\nrequest-id: ${request.id}\nrun-mode: ${request.runMode}\ntask-id: ${request.taskId ?? ''}\ntimestamp: ${stamp(context)}\n\n${assignment}\n`);
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
  if (argv.some((arg) => /dangerously-skip-permissions|dangerously-bypass|bypassPermissions|danger-full-access|dangerFullAccess|--yolo|--force|--trust|--allow-all|--auto-approve/i.test(String(arg)))) {
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
  if (request.runsIn) args.push('--model', request.runsIn.model, '--effort', request.runsIn.effort);
  if (request.runsIn) args.push('--permission-mode', 'default', '--permission-prompt-tool', 'stdio', '--strict-mcp-config');
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
    const rpc = openRpc(child, incoming, session, timeoutMs, request);
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
  rememberContextInput(session, text);
  const input = [{ type: 'text', text }];
  // turn/steer echoes turnId. turn/start is the call that returns turn.id.
  const expected = typeof session.turnId === 'string' && session.turnId ? session.turnId : null;
  const started = expected
    ? await session.rpc.call('turn/steer', { threadId: session.contextThreadId ?? session.nativeSessionId, expectedTurnId: expected, input })
    : await session.rpc.call('turn/start', { threadId: session.contextThreadId ?? session.nativeSessionId, input,
      ...(session.launchChoice ? { model: session.launchChoice.model, effort: session.launchChoice.effort } : {}) });
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
  rememberContextInput(session, text);
  const prompted = await session.rpc.call('session/prompt', {
    sessionId: session.contextThreadId ?? session.nativeSessionId,
    prompt: [{ type: 'text', text: session.contextBootstrap ? `${session.contextBootstrap}\n${text}` : text }],
  });
  if (!prompted?.result || typeof prompted.result !== 'object') return { submitted: false, ambiguous: true };
  if (typeof prompted.result.stopReason === 'string') await session.onCompleted?.();
  return { submitted: true };
}

async function localResult(context, request, state, sessionId, error) {
  const result = await writeResult(context, request, state, sessionId, error);
  if (context.bus) publishDomainEvents(context, [{ name: 'session.request.changed', unitId: request.unitId,
    data: projectSessionRequest({ request, result }) }]);
  return result;
}

async function submitClaude(session, text) {
  rememberContextInput(session, text);
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
  const permissions = new Map();
  while (session.child.exitCode == null && !session.child.killed) {
    let message;
    try { message = parseClaudeLine(await session.incoming.line()); }
    catch (error) {
      if (error?.timeout === true) continue;
      session.submission?.({ submitted: false, ambiguous: true });
      break;
    }
    if (message.session_id && message.session_id !== session.nativeSessionId) continue;
    await session.permissionRequest?.planTranscript?.(message);
    observePlanProtocol(session.permissionRequest, message);
    if (message.type === 'control_cancel_request') { permissions.get(message.request_id)?.abort.abort(); continue; }
    if (message.type === 'control_request' && typeof message.request_id === 'string') {
      const fingerprint = canonicalJson(message), previous = permissions.get(message.request_id);
      const denied = () => nativePermissionReply(message);
      let response;
      if (previous && previous.fingerprint !== fingerprint || !previous && permissions.size >= 256) response = denied();
      else if (previous) response = previous.response;
      else {
        const abort = new AbortController(), boundary = session.permissionRequest.nativeBoundary;
        response = nativePermissionReply(message, { ...session.permissionRequest, nativeSessionId: session.nativeSessionId,
          nativeBoundary: boundary ? { ...boundary, signal: AbortSignal.any([abort.signal, boundary.signal]) } : null });
        permissions.set(message.request_id, { fingerprint, response, abort });
      }
      response.then(result => { if (session.child.exitCode == null && !session.child.killed) sendLine(session.child, result); }).catch(() => {});
      continue;
    }
    if (message.type === 'assistant' || message.type === 'result') {
      session.submission?.({ submitted: !message.is_error, ...(message.is_error ? { ambiguous: true } : {}) });
      session.submission = null;
    }
    if (message.type === 'result' && message.session_id === session.nativeSessionId) await session.onCompleted?.().catch(() => {});
  }
}

// Only structured protocol identities become milestones; model prose and command text never do.
function observePlanProtocol(request, message) {
  if (!request?.planObserver) return;
  let item, state, id, step;
  if (['item/started', 'item/completed'].includes(message.method) && message.params?.threadId === (request.contextNativeSessionId ?? request.nativeSessionId)) {
    item = message.params.item; state = message.method === 'item/started' ? 'start' : 'end'; id = item?.id;
    step = item?.type === 'fileChange' ? 'edit' : item?.type === 'commandExecution' ? 'work' : null;
  } else if (message.method === 'session/update' && message.params?.sessionId === request.nativeSessionId) {
    item = message.params.update; id = item?.toolCallId;
    state = item?.sessionUpdate === 'tool_call' ? 'start' : item?.sessionUpdate === 'tool_call_update' && ['completed', 'failed'].includes(item.status) ? 'end' : null;
    step = item?.kind === 'edit' ? 'edit' : item?.kind === 'execute' ? 'work' : null;
  } else if (message.type === 'assistant' && message.session_id === request.nativeSessionId) {
    for (const block of message.message?.content ?? []) if (block.type === 'tool_use' && typeof block.id === 'string') {
      const step = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(block.name) ? 'edit' : block.name === 'Bash' ? 'work' : null;
      if (step) Promise.resolve(request.planObserver({ id: `${block.id}:start`, kind: 'step_start', step, wireHash: hashBytes(Buffer.from(canonicalJson(block))) })).catch(() => {});
    }
    return;
  }
  if (step && state && typeof id === 'string' && id.length <= 100) Promise.resolve(request.planObserver({ id: `${id}:${state}`, kind: `step_${state}`, step, wireHash: hashBytes(Buffer.from(canonicalJson(message))) })).catch(() => {});
}

export async function launchPlanSession(context, host) {
  const { resolveClusterLink, readCluster } = await import('./clusters.mjs');
  const { directoryIdentity, readRepositoryIdentity } = await import('./cluster-git.mjs');
  const desktop = { ...context, principal: { audience: 'desktop', unitId: 'root:master' } };
  const cluster = await readCluster(desktop, host.approval.plan.clusterId, { machine: host.machine });
  if (cluster.revision !== host.approval.clusterRevision) throw new CoreError(409, 'plan_changed', 'The approved cluster changed before launch.');
  const mapping = cluster.link.kind === 'none' ? null : await resolveClusterLink(desktop, cluster.link, host.machine);
  const directory = path.join(context.paths.localDirectory, 'runs', host.runId, 'sessions', host.sessionId);
  await mkdir(directory, { recursive: true }); await protectLocalFile(directory, { store: context.store });
  const repository = cluster.link.kind === 'repository' ? await readRepositoryIdentity(mapping.localPath, context.settingsOwner ?? context) : null;
  const scope = { id: randomUUID(), revision: host.approval.plan.revision, sessionId: host.sessionId, attemptId: host.attemptId, unitId: host.unitId,
    clusterId: cluster.id, clusterRevision: cluster.revision, machine: host.machine, readScope: host.unitId ? [host.unitId] : [],
    contentScope: { additionIds: [], scopeRevision: null }, writeRoots: mapping ? [{ realPath: mapping.localPath,
      identity: await directoryIdentity(mapping.localPath), gitCommonDir: repository?.commonDir ?? null }] : [], git: { commit: false, push: false, intentId: null } };
  const choice = host.assignment.runsIn, adapter = context.adapters?.[choice.client];
  if (!adapter) throw new CoreError(503, 'client_unavailable', 'The selected plan client is unavailable.');
  const task = host.taskId ? await loadTask(context, host.taskId) : null;
  const prompt = `Plan ${host.runId}, attempt ${host.attemptId}, role ${host.role}, task ${host.taskId ?? 'coordination'}. Only the coordinator dispatches roles through plan_dispatch. Confirm start, report bounded steps and explicitly report the task through plan_report. Git is performed by the owner from the approved task paths. Review authority grants no build, Git or session dispatch.${task ? `\nApproved task:\n${task.body}` : ''}`;
  if (Buffer.byteLength(prompt) > PROMPT_MAX || choice.client === 'lyra' && prompt.length > 8000) throw new CoreError(413, 'message_too_large', 'The approved task exceeds the native input bound.');
  const actor = { ...context, principal: { audience: 'agent', unitId: host.unitId, sessionId: host.sessionId } };
  const fileTool = async (name, input) => (await import('./runs.mjs')).planFileTool(actor, name, input);
  const request = { id: host.attemptId, planActor: { runId: host.runId, attemptId: host.attemptId, sessionId: host.sessionId, unitId: host.unitId, role: host.role, taskId: host.taskId },
    unitId: host.unitId, client: choice.client, machine: host.machine, model: choice.model, effort: choice.effort, runsIn: choice,
    runMode: host.role === 'coordinator' ? 'chat' : 'task', taskId: host.taskId, cwd: mapping?.localPath ?? directory, probeDirectory: directory,
    launchScope: scope, store: context.store, prompt, bootstrap: canonicalJson({ role: host.role, actorId: host.actorId, assignment: host.assignment,
      plan: host.approval.plan, unit: host.unitId ? JSON.parse(await contextBootstrap(context, host.unitId)) : null, resources: ['plan'] }),
    retainedContext: host.reviewConversation?.checkpoint ?? null, planObserver: host.observer, planTranscript: host.transcript,
    planAuthority: { role: host.role, writablePaths: host.role === 'builder' ? host.approval.taskWitnesses.find(task => task.id === host.taskId)?.paths ?? [] : [] },
    nativePermission: (operation, boundary) => import('./runs.mjs').then(module => module.requestPlanNativeOperation(actor, operation, boundary)),
    scopedRead: input => fileTool('file_read', input), scopedWrite: input => fileTool('file_write', input) };
  if (Buffer.byteLength(request.bootstrap) > PROMPT_MAX || choice.client === 'lyra' && request.bootstrap.length > 12000) throw new CoreError(409, 'context_unavailable', 'The approved plan exceeds this client input budget.');
  const created = await adapter.create(request);
  if (!created.processHandle) throw new CoreError(409, 'cleanup_unavailable', 'The selected client did not provide verified execution ownership.');
  if (host.reviewConversation && await adapter.resumePlanReview?.({ ...created, conversation: host.reviewConversation, role: 'reviewer' }) !== true) {
    await created.processHandle.stop(); throw new CoreError(409, 'context_unavailable', 'The planner conversation cannot be reopened with review authority.');
  }
  const registration = { ...request.planActor, nativeSessionId: created.nativeSessionId, client: choice.client, machine: host.machine, runMode: request.runMode, launchKind: 'plan' };
  const scopeFile = path.join(context.paths.localDirectory, 'runs', host.runId, 'scopes', `${host.attemptId}.json`);
  await commitTransaction(context.store, { id: randomUUID(), entries: [{ resource: scopeFile, recordPath: scopeFile, beforeRevision: null,
    afterBytes: Buffer.from(canonicalJson({ scope, role: host.role, taskId: host.taskId, actorId: host.actorId })), private: true }], events: [] });
  return { ...created, registered: async binding => {
    const { callPlanTool } = await import('./runs.mjs');
    const tools = Object.fromEntries(['plan_confirm_start', 'plan_step', 'plan_report', 'plan_dispatch', 'plan_send', 'plan_read', 'plan_extend', 'plan_agree'].map(name => [name,
      input => callPlanTool({ ...context, principal: { audience: 'agent', unitId: host.unitId, sessionId: host.sessionId } }, name, input)]));
    await adapter.registered?.(request, registration, { ...context, localPlanBinding: { ...binding, lead: host.role === 'coordinator', tools } });
    if (choice.client !== 'lyra') Promise.resolve(adapter.send({ ...registration, text: prompt })).catch(() => {});
  } };
}

function startupInstruction(request) {
  const lines = [`Unit: ${request.unitId ?? ''}`];
  if (request.bootstrap) lines.push(request.bootstrap);
  if (request.retainedContext?.messages?.length) lines.push(`Kept native context: ${canonicalJson(request.retainedContext.messages)}`);
  if (typeof request.job === 'string' && request.job) lines.push(`Job: ${request.job}`);
  if (typeof request.leadId === 'string' && request.leadId) lines.push(`Lead: ${request.leadId}`);
  lines.push('Read the unit role, job and lead from the registered files and stay ready.');
  if (request.planActor) lines.push(`Plan role: ${request.planActor.role}. ${request.prompt} Use only the bound plan tools for dispatch and task reports; native turn completion is not task completion.`);
  else if (request.runMode === 'task') lines.push(`Assigned task: ${request.taskId ?? 'the task prompt in the mailbox'}. After terminal delivery or failure, call session_complete with outcome delivered or failed. The CLI closes after native completion is acknowledged.`);
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
    if (message?.type === 'system' && message.subtype === 'init' && message.session_id === request.nativeSessionId) {
      if (request.runsIn && message.model !== request.runsIn.model) throw new CoreError(422, 'unsupported_launch_choice', 'The native client did not confirm the selected model.');
      return request.nativeSessionId;
    }
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
  if (params.threadId !== (session.contextThreadId ?? session.nativeSessionId)) return;
  if (!Array.isArray(session.closedTurns)) session.closedTurns = [];
  if (session.closedTurns.length >= 16) session.closedTurns.shift();
  session.closedTurns.push(turnId);
  if (session.turnId === turnId) session.turnId = null;
  if (session.terminalTurnId === turnId) session.onCompleted?.().catch(() => {});
}

function openRpc(child, incoming, session, timeoutMs, request = {}) {
  let nextId = 1;
  let stopped = false;
  let started = false;
  const pending = new Map();
  const early = new Map();
  const nativeRequests = new Map();
  request.nativeItems = new Map();
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
      await request.planTranscript?.(message);
      if (message?.error != null && loginFailed(JSON.stringify(message.error))) {
        remember(message);
        failAll(unavailable());
        break;
      }
      if (message?.method && message.id == null) {
        observePlanProtocol(request, message);
        noteContext(session, message);
        if (message.method === 'serverRequest/resolved') nativeRequests.get(message.params?.requestId)?.abort.abort();
        if (message.method === 'item/started' && message.params?.item?.id) {
          if (request.nativeItems.size >= 256) request.nativeItems.delete(request.nativeItems.keys().next().value);
          request.nativeItems.set(message.params.item.id, message.params.item);
        }
        noteTurn(session, message);
        continue;
      }
      if (typeof message?.method === 'string' && (typeof message.id === 'string' || typeof message.id === 'number')) {
        const fingerprint = canonicalJson(message), previous = nativeRequests.get(message.id);
        if (previous && previous.fingerprint !== fingerprint || !previous && nativeRequests.size >= 256) {
          sendLine(child, { jsonrpc: '2.0', id: message.id, error: { code: -32001, message: 'The native operation identity changed.' } });
          continue;
        }
        if (!previous) {
          const abort = new AbortController(), boundary = request.nativeBoundary;
          const response = nativePermissionReply(message, { ...request,
            nativeBoundary: boundary ? { ...boundary, signal: AbortSignal.any([abort.signal, boundary.signal]) } : null });
          nativeRequests.set(message.id, { fingerprint, response, abort });
          response.then(result => { if (!stopped) sendLine(child, result); }).catch(() => failAll(unavailable()));
        } else previous.response.then(result => { if (!stopped) sendLine(child, result); }).catch(() => {});
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
  const params = codexThreadParams(request);
  const thread = await rpc.call(request.retainedContext?.threadId ? 'thread/fork' : 'thread/start',
    { ...params, ...(request.retainedContext?.threadId ? { threadId: request.retainedContext.threadId } : {}) });
  if (!thread.result?.thread?.id) throw unavailable();
  if (request.runsIn && (thread.result.model !== request.runsIn.model || thread.result.reasoningEffort !== request.runsIn.effort
    || thread.result.sandbox?.type !== 'readOnly')) throw new CoreError(409, 'scope_unavailable', 'The client did not confirm its effective native policy and launch choice.');
  request.nativeSessionId = thread.result.thread.id;
  return thread.result.thread.id;
}

function codexThreadParams(request) {
  const params = { cwd: request.cwd };
  if (request.nativeMcp) {
    const { name, command, args } = request.nativeMcp;
    params.config = { mcp_servers: { [name]: { command, args, env_vars: ['HIVEM1ND_SERVICE_BRIDGE', 'HIVEM1ND_SERVICE_GRANT'] } } };
  }
  if (request.model) params.model = request.model;
  if (request.runsIn) {
    params.approvalPolicy = 'untrusted';
    params.sandbox = 'read-only';
    params.config = { ...params.config, model_reasoning_effort: request.runsIn.effort };
  }
  if (request.bootstrap) params.config = { ...params.config, developer_instructions: startupInstruction(request) };
  return params;
}

async function cursorHandshake(rpc, request) {
  if (!request.cwd) throw unavailable();
  const init = await rpc.call('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: typeof request.scopedRead === 'function', writeTextFile: typeof request.scopedWrite === 'function' }, terminal: false },
  });
  if (init?.error) throw unavailable();
  const method = (init.result?.authMethods ?? []).find((item) => /existing|login/i.test(`${item.id ?? ''} ${item.name ?? item}`));
  if (!method) throw unavailable();
  const auth = await rpc.call('authenticate', { methodId: method.id ?? method });
  if (auth?.error) throw unavailable();
  const session = await rpc.call('session/new', { cwd: request.cwd, mcpServers: request.nativeMcp ? [request.nativeMcp] : [] });
  if (!session.result?.sessionId) throw unavailable();
  if (request.runsIn) {
    let configOptions = session.result.configOptions ?? [];
    for (const [category, value] of [['model', request.runsIn.model], ['thought_level', request.runsIn.effort]]) {
      const option = configOptions.find(option => option.category === category && option.type === 'select' && option.options?.flatMap(item => item.options ?? [item]).some(item => item.value === value));
      if (!option) throw new CoreError(422, 'unsupported_launch_choice', 'The ACP choice is unavailable.');
      const changed = await rpc.call('session/set_config_option', { sessionId: session.result.sessionId, configId: option.id, value });
      configOptions = changed.result?.configOptions ?? [];
      if (configOptions.find(item => item.id === option.id)?.currentValue !== value) throw new CoreError(422, 'unsupported_launch_choice', 'The ACP choice was not applied.');
    }
  }
  request.nativeSessionId = session.result.sessionId;
  return session.result.sessionId;
}

export async function nativePermissionReply(message, request = {}) {
  const reply = result => ({ jsonrpc: '2.0', id: message.id, result });
  const params = message.params ?? {};
  const permission = async operation => {
    if (typeof request.nativePermission !== 'function' || request.nativeBoundary?.verified !== true) return false;
    const nativeId = params.threadId ?? params.sessionId ?? message.session_id ?? request.nativeSessionId;
    if (!request.nativeSessionId || nativeId !== (request.contextNativeSessionId ?? request.nativeSessionId)
      || request.contextOnlyThreads?.has(nativeId)) return false;
    try { return await request.nativePermission({ ...operation, id: message.id ?? message.request_id, protocol: request.runsIn?.client,
      nativeSessionId: request.nativeSessionId, payload: operation.payload ?? params }, request.nativeBoundary) === true; } catch { return false; }
  };
  if (message.type === 'control_request') {
    const call = message.request ?? {};
    const input = call.input ?? {};
    const paths = typeof input.file_path === 'string' ? [input.file_path] : typeof input.notebook_path === 'string' ? [input.notebook_path] : [];
    const allow = call.subtype === 'can_use_tool' && await permission({ kind: call.tool_name === 'Bash' ? 'process' : 'write',
      command: input.command, cwd: request.cwd, paths, payload: call });
    return { type: 'control_response', response: { subtype: 'success', request_id: message.request_id,
      response: allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'This exact operation was not authorized.' } } };
  }
  // An approval cannot widen the native sandbox. Scoped service tools execute exact file/Git changes.
  if (message.method === 'item/permissions/requestApproval') return reply({ permissions: {}, scope: 'turn' });
  if (message.method === 'session/request_permission') {
    const call = params.toolCall ?? {}, input = call.rawInput ?? {};
    const allow = await permission({ kind: call.kind === 'execute' ? 'process' : 'write', command: input.command,
      cwd: request.cwd, paths: (call.locations ?? []).map(location => location.path) });
    const selected = params.options?.find(option => option.kind === (allow ? 'allow_once' : 'reject_once') && typeof option.optionId === 'string' && option.optionId.length > 0);
    return reply({ outcome: selected ? { outcome: 'selected', optionId: selected.optionId } : { outcome: 'cancelled' } });
  }
  if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(message.method)) {
    const allow = await permission({ kind: message.method.includes('commandExecution') ? 'process' : 'write',
      command: params.command, cwd: params.cwd ?? request.cwd, paths: request.nativeItems?.get(params.itemId)?.changes?.map(change => change.path) ?? [] });
    return reply({ decision: allow ? 'accept' : 'decline' });
  }
  if (['execCommandApproval', 'applyPatchApproval'].includes(message.method)) return reply({ decision: 'denied' });
  if (['fs/read_text_file', 'fs/write_text_file'].includes(message.method)) {
    try {
      if (!request.nativeSessionId || params.sessionId !== (request.contextNativeSessionId ?? request.nativeSessionId)
        || request.contextOnlyThreads?.has(params.sessionId)) throw unavailable();
      if (message.method === 'fs/read_text_file') {
        const result = await request.scopedRead?.({ path: params.path });
        if (!result) throw unavailable();
        const lines = result.text.split(/\r?\n/), start = params.line ?? 1;
        if (!Number.isInteger(start) || start < 1 || params.limit !== undefined && (!Number.isInteger(params.limit) || params.limit < 1)) throw unavailable();
        return reply({ content: lines.slice(start - 1, params.limit === undefined ? undefined : start - 1 + params.limit).join('\n') });
      }
      const before = await request.scopedRead?.({ path: params.path }).catch(() => null);
      const result = await request.scopedWrite?.({ path: params.path, text: params.content, expectedRevision: before?.revision ?? null });
      if (!result) throw unavailable();
      return reply({});
    } catch { return { jsonrpc: '2.0', id: message.id, error: { code: -32001, message: 'The scoped file operation is unavailable.' } }; }
  }
  if (['terminal/create', 'terminal/wait_for_exit', 'terminal/output', 'terminal/kill', 'terminal/release'].includes(message.method)) {
    return { jsonrpc: '2.0', id: message.id, error: { code: -32001, message: 'Use the actor-bound scoped service operation.' } };
  }
  return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'The native method is not supported.' } };
}

async function probeCodexChoices(options) {
  let child, incoming, deadline;
  const unavailableReport = { id: 'codex', title: 'Codex', connected: false, models: [], scopeEnforced: false,
    quota: { remainingPercent: null, period: null, known: false }, context: { known: false, compact: false } };
  try {
    const launch = options.command ? { command: options.command, args: options.args ?? launchArgs('codex') }
      : await resolveLaunch('codex', options.env ?? process.env, options.platform ?? process.platform);
    if (!launch) return unavailableReport;
    assertNoBypass(launch.args);
    child = (options.spawn ?? spawn)(launch.command, launch.args, { shell: false, windowsHide: true, env: options.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    incoming = readLines(child, options.timeoutMs ?? 3000);
    deadline = setTimeout(() => { incoming.close(); child.kill(); }, Math.min(options.timeoutMs ?? 5000, 10000));
    const rpc = openRpc(child, incoming, {}, options.timeoutMs ?? 3000);
    await rpc.call('initialize', { clientInfo: { name: 'hivem1nd', title: 'HIVEM1ND', version: '3.0.0' } });
    rpc.notify('initialized');
    if (!accountReady(await rpc.call('account/read', {}))) return unavailableReport;
    const models = [], cursors = new Set(); let cursor = null;
    for (let page = 0; page < 16; page++) {
      const listed = await rpc.call('model/list', { cursor, limit: 100 });
      if (!Array.isArray(listed.result?.data)) return unavailableReport;
      for (const model of listed.result.data) {
        const efforts = model.supportedReasoningEfforts?.map(item => item.reasoningEffort);
        if (typeof model.model !== 'string' || !Array.isArray(efforts) || !efforts.length || efforts.some(item => typeof item !== 'string')) continue;
        if (!model.hidden) models.push({ id: model.model, title: model.displayName ?? model.model, efforts, modes: [] });
      }
      cursor = listed.result.nextCursor;
      if (!cursor) {
        const observed = await rpc.call('account/rateLimits/read', {}).catch(() => null);
        const windows = [observed?.result?.rateLimits?.primary, observed?.result?.rateLimits?.secondary]
          .filter(window => Number.isFinite(window?.usedPercent) && window.usedPercent >= 0 && window.usedPercent <= 100);
        windows.sort((left, right) => right.usedPercent - left.usedPercent);
        const limiting = windows[0];
        return { ...unavailableReport, connected: models.length > 0, scopeEnforced: true, models,
          quota: limiting ? { remainingPercent: 100 - limiting.usedPercent, period: Number.isFinite(limiting.windowDurationMins) ? `${limiting.windowDurationMins}m` : null, known: true } : unavailableReport.quota };
      }
      if (cursors.has(cursor)) return unavailableReport;
      cursors.add(cursor);
    }
    return unavailableReport;
  } catch { return unavailableReport; }
  finally { clearTimeout(deadline); incoming?.close(); if (child) await finishChild(child); }
}

async function probeNativeChoices(client, options, context) {
  const unavailableReport = { id: client, title: client === 'claude' ? 'Claude Code' : 'Cursor', connected: false, models: [], scopeEnforced: false,
    quota: { remainingPercent: null, period: null, known: false }, context: { known: false, compact: false } };
  const root = context.localDirectory;
  if (typeof root !== 'string' || !path.isAbsolute(root)) return unavailableReport;
  const directory = path.join(root, `probe-${client}-${randomUUID()}`);
  let child, incoming, deadline;
  try {
    await assertNoLinks(root); await mkdir(directory, { recursive: true });
    await protectLocalFile(directory, { store: context.store, aclRunner: options.aclRunner });
    const launch = options.command ? { command: options.command, args: options.args ?? launchArgs(client) }
      : await resolveLaunch(client, options.env ?? process.env, options.platform ?? process.platform);
    if (!launch) return unavailableReport;
    const args = client === 'claude' ? [...launch.args, '--permission-prompt-tool', 'stdio', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', ''] : launch.args;
    assertNoBypass(args);
    child = (options.spawn ?? spawn)(launch.command, args, { shell: false, windowsHide: true, cwd: directory, env: options.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    incoming = readLines(child, options.timeoutMs ?? 3000);
    deadline = setTimeout(() => { incoming.close(); child.kill(); }, Math.min(options.timeoutMs ?? 5000, 10000));
    const models = [];
    let quota = unavailableReport.quota;
    if (client === 'claude') {
      const control = async request => {
        const id = randomUUID(); sendLine(child, { type: 'control_request', request_id: id, request });
        for (let count = 0; count < 64; count++) {
          const message = JSON.parse(await incoming.line());
          if (message.type === 'control_request') { sendLine(child, await nativePermissionReply(message)); continue; }
          if (message.type === 'control_response' && message.response?.request_id === id) {
            if (message.response.subtype !== 'success') throw unavailable();
            return message.response.response;
          }
        }
        throw unavailable();
      };
      const initialized = await control({ subtype: 'initialize', hooks: null });
      const account = initialized?.account;
      if (!account || ![account.email, account.tokenSource, account.apiKeySource].some(value => typeof value === 'string' && value && value !== 'none')) return unavailableReport;
      for (const model of (initialized.models ?? []).slice(0, 256)) {
        if (model.supportsEffort !== true || !Array.isArray(model.supportedEffortLevels) || !model.supportedEffortLevels.length
          || model.supportedEffortLevels.some(effort => !['low', 'medium', 'high', 'xhigh', 'max'].includes(effort))) continue;
        const id = model.resolvedModel ?? model.value;
        if (typeof id === 'string' && id) models.push({ id, title: model.displayName ?? id, efforts: [...model.supportedEffortLevels], modes: [] });
      }
      const usage = await control({ subtype: 'get_usage', skip_behaviors: true }).catch(() => null);
      if (usage?.rate_limits_available === true) {
        const limits = Object.entries(usage.rate_limits ?? {}).filter(([, value]) => Number.isFinite(value?.utilization) && value.utilization >= 0 && value.utilization <= 100);
        limits.sort((left, right) => right[1].utilization - left[1].utilization);
        if (limits.length) quota = { remainingPercent: 100 - limits[0][1].utilization, period: limits[0][0], known: true };
      }
    } else {
      const rpc = openRpc(child, incoming, {}, options.timeoutMs ?? 3000);
      const initialized = await rpc.call('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
      const method = initialized.result?.authMethods?.find(item => /existing|login/i.test(`${item.id} ${item.name ?? ''}`));
      if (!method) return unavailableReport;
      await rpc.call('authenticate', { methodId: method.id });
      const session = await rpc.call('session/new', { cwd: directory, mcpServers: [] });
      if (typeof session.result?.sessionId !== 'string') return unavailableReport;
      let config = session.result.configOptions ?? [];
      const option = config.find(item => item.category === 'model' && item.type === 'select');
      for (const model of (option?.options ?? []).flatMap(item => item.options ?? [item]).slice(0, 64)) {
        if (typeof model.value !== 'string' || !model.value) continue;
        const changed = await rpc.call('session/set_config_option', { sessionId: session.result.sessionId, configId: option.id, value: model.value });
        config = changed.result?.configOptions ?? [];
        if (config.find(item => item.id === option.id)?.currentValue !== model.value) continue;
        const effort = config.find(item => item.category === 'thought_level' && item.type === 'select');
        const efforts = (effort?.options ?? []).flatMap(item => item.options ?? [item]).map(item => item.value);
        if (efforts.length && efforts.every(value => typeof value === 'string' && value)) models.push({ id: model.value, title: model.name ?? model.value, efforts, modes: [] });
      }
    }
    return { ...unavailableReport, connected: models.length > 0, models, quota, scopeEnforced: typeof options.enforceScope === 'function' };
  } catch { return unavailableReport; }
  finally {
    clearTimeout(deadline); incoming?.close(); if (child) await finishChild(child);
    if (path.dirname(directory) === path.resolve(root)) {
      await assertNoLinks(directory); await rm(directory, { recursive: true, force: true });
    }
  }
}

async function persistNativeContext(session) {
  if (!session.contextOwner || !session.registration) return;
  const context = session.contextOwner, file = path.join(context.paths.localDirectory, 'contexts', session.registration.sessionId, 'native.json');
  const before = await readBytes(context.store, file);
  const after = jsonBytes({ client: session.registration.client, threadId: session.contextThreadId ?? session.nativeSessionId,
    messages: session.contextMessages ?? [] });
  if (before?.equals(after)) return;
  await commitTransaction(context.store, { id: randomUUID(), entries: [{ resource: file, recordPath: file, private: true,
    beforeRevision: revisionOf(before), afterBytes: after }], events: [] });
}

function rememberContextInput(session, text) {
  session.contextMessages ??= [];
  session.contextMessages.push({ role: 'user', content: text });
  if (Buffer.byteLength(canonicalJson(session.contextMessages)) > PROMPT_MAX) session.contextIncomplete = true;
}

function noteContext(session, message) {
  const params = message.params ?? {}, active = session.contextThreadId ?? session.nativeSessionId;
  session.summaryObserver?.(message);
  if ((params.threadId ?? params.sessionId) !== active) return;
  if (message.method === 'thread/tokenUsage/updated') {
    const used = params.tokenUsage?.last?.totalTokens, capacity = params.tokenUsage?.modelContextWindow;
    session.contextMeter = Number.isSafeInteger(used) && used >= 0 && Number.isSafeInteger(capacity) && capacity > 0
      ? { used, capacity, unit: 'tokens', estimated: false } : null;
    const owner = session.contextOwner;
    if (owner) import('./context.mjs').then(({ readContext }) => readContext({ ...owner, principal: { audience: 'desktop', unitId: 'root:master' } }, session.registration.sessionId)).catch(() => {});
  }
  if (message.method === 'item/completed' && params.item?.type === 'agentMessage' && typeof params.item.text === 'string') {
    session.contextMessages ??= [];
    session.contextMessages.push({ role: 'assistant', content: params.item.text });
  }
  if (message.method === 'session/update' && params.update?.sessionUpdate === 'agent_message_chunk' && typeof params.update.content?.text === 'string') {
    session.contextMessages ??= [];
    const last = session.contextMessages.at(-1);
    if (last?.role === 'assistant') last.content += params.update.content.text;
    else session.contextMessages.push({ role: 'assistant', content: params.update.content.text });
  }
}

async function newContextThread(client, session, bootstrap) {
  const request = session.permissionRequest;
  if (client === 'codex') {
    const response = await session.rpc.call('thread/start', codexThreadParams({ ...request, bootstrap }));
    if (!response.result?.thread?.id || response.result.model !== request.runsIn.model
      || response.result.reasoningEffort !== request.runsIn.effort || response.result.sandbox?.type !== 'readOnly') throw unavailable();
    return response.result.thread.id;
  }
  return cursorHandshake(session.rpc, { ...request });
}

async function nativeSummary(client, session, threadId, text) {
  let output = '', complete, fail, timer;
  const done = new Promise((resolve, reject) => { complete = resolve; fail = reject;
    timer = setTimeout(() => reject(new CoreError(409, 'context_unavailable', 'The native summary was not confirmed.')), session.timeoutMs); });
  session.summaryObserver = message => {
    const params = message.params ?? {};
    if ((params.threadId ?? params.sessionId) !== threadId) return;
    if (message.method === 'item/completed' && params.item?.type === 'agentMessage') output += params.item.text ?? '';
    if (message.method === 'session/update' && params.update?.sessionUpdate === 'agent_message_chunk') output += params.update.content?.text ?? '';
    if (output.length > 8000) fail(new CoreError(409, 'context_unavailable', 'The native summary exceeds its bound.'));
    if (message.method === 'turn/completed') params.turn?.status === 'completed' ? complete(output) : fail(unavailable());
  };
  done.catch(() => {});
  try {
    if (client === 'codex') {
      const response = await session.rpc.call('turn/start', { threadId, input: [{ type: 'text', text }], model: session.launchChoice.model, effort: session.launchChoice.effort });
      if (!response.result?.turn?.id) throw unavailable();
      return await done;
    }
    const response = await session.rpc.call('session/prompt', { sessionId: threadId, prompt: [{ type: 'text', text }] });
    if (response.result?.stopReason !== 'end_turn') throw unavailable();
    return output;
  } finally { clearTimeout(timer); session.summaryObserver = null; }
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
