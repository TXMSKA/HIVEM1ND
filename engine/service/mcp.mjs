import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { admitMessage } from '../sync/limits.mjs';
import { noteSync, openSync, stageTransaction } from '../sync/store.mjs';
import { CoreError, canonicalJson, isUuid } from './identity.mjs';
import { safeError } from './security.mjs';
import { readEditor, addNode, updateNode, removeNode, replaceRange, replyComment, requireAttachment } from './editors.mjs';
import { publishDomainEvents } from './events.mjs';
import { requestApproval } from './approvals.mjs';
import { completeSessionTask } from './adapters.mjs';
import { assertGitCapability, readScopedFile, requestScopedGit, runScopedGit, verifiedSessionScope, writeScopedFile } from './file-access.mjs';
import { carryHostConversation } from '../relay/carry-over.mjs';
import { recordActivity } from './watch.mjs';
import { atomicWrite, commitTransaction, readBytes, revisionOf, withLocalChanges, withReceipt } from './store.mjs';

const PROTOCOL = '2025-03-26';
const MUTATIONS = new Set(['blueprint_add_node', 'blueprint_update_node', 'blueprint_remove_node', 'blueprint_reply_comment', 'void_replace_range', 'void_reply_comment']);

function tool(name, description, properties, required) {
  return { name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } };
}

const resourceId = { type: 'string', format: 'uuid', maxLength: 36 };
const label = { type: 'string', maxLength: 180 };
const revision = { type: 'string', format: 'hash', maxLength: 64 };
const requestId = { type: 'string', format: 'uuid', maxLength: 36 };
const text = { type: 'string', maxLength: 10000 };

export function toolSchemas() {
  return [
    tool('native_permission', 'Resolve one exact native file or process permission for this owned actor.', { toolName: label, input: { type: 'object' }, cwd: { type: 'string', maxLength: 4096 }, requestId }, ['toolName', 'input', 'cwd', 'requestId']),
    tool('file_read', 'Read one bounded file through the owned session scope.', { path: { type: 'string', maxLength: 4096 }, approvalId: requestId }, ['path']),
    tool('file_write', 'Write one reviewed file through the owned session scope.', { path: { type: 'string', maxLength: 4096 }, text: { type: 'string', maxLength: 1000000 }, expectedRevision: revision, approvalId: requestId, requestId }, ['path', 'text', 'requestId']),
    tool('git_execute', 'Execute one separately approved scoped Git instruction.', { intentId: requestId, requestId }, ['intentId', 'requestId']),
    tool('git_request', 'Request a separate explicit instruction for one reviewed scoped commit or push.', { action: { type: 'string', enum: ['git.commit', 'git.push'] }, repository: { type: 'string', maxLength: 4096 }, branch: label,
      paths: { type: 'array', maxItems: 256, items: { type: 'string', maxLength: 4096 } }, message: { type: 'string', maxLength: 10000 }, remote: label, requestId }, ['action', 'repository', 'branch', 'paths', 'requestId']),
    tool('session_open', 'Ask the person to open one connected CLI for a registered unit on this machine.', { client: { type: 'string', enum: ['claude', 'codex', 'cursor'], maxLength: 32 }, machine: label, unitId: { type: 'string', maxLength: 256 }, runMode: { type: 'string', enum: ['task', 'chat'] }, taskId: { type: ['string', 'null'], maxLength: 256 }, requestId }, ['client', 'machine', 'unitId', 'runMode', 'taskId', 'requestId']),
    tool('session_complete', 'Acknowledge terminal delivery or failure of this assigned task; wait for native completion before the CLI closes.', { outcome: { type: 'string', enum: ['delivered', 'failed'] }, taskId: { type: ['string', 'null'], maxLength: 256 }, requestId }, ['outcome', 'requestId']),
    tool('blueprint_open', 'Read one Blueprint board.', { resourceId }, ['resourceId']),
    tool('blueprint_add_node', 'Add a node to a board.', { resourceId, screenId: label, parentId: label, index: { type: 'integer', minimum: 0 }, node: { type: 'object' }, expectedRevision: revision, requestId }, ['resourceId', 'screenId', 'parentId', 'node', 'expectedRevision', 'requestId']),
    tool('blueprint_update_node', 'Change a node.', { resourceId, nodeId: label, changes: { type: 'object' }, expectedRevision: revision, requestId }, ['resourceId', 'nodeId', 'changes', 'expectedRevision', 'requestId']),
    tool('blueprint_remove_node', 'Remove a node.', { resourceId, nodeId: label, expectedRevision: revision, requestId }, ['resourceId', 'nodeId', 'expectedRevision', 'requestId']),
    tool('blueprint_reply_comment', 'Reply on a board comment.', { resourceId, threadId: label, text, expectedCommentsRevision: revision, requestId }, ['resourceId', 'threadId', 'text', 'expectedCommentsRevision', 'requestId']),
    tool('void_open', 'Read one Void text.', { resourceId }, ['resourceId']),
    tool('void_replace_range', 'Apply or propose a text range.', { resourceId, k: { type: 'string', maxLength: 240 }, lang: { type: 'string', maxLength: 16 }, start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 0 }, expectedText: text, replacement: text, expectedRevision: revision, mode: { type: 'string', enum: ['apply', 'propose'] }, threadId: label, expectedCommentsRevision: revision, requestId }, ['resourceId', 'k', 'lang', 'start', 'end', 'expectedText', 'replacement', 'expectedRevision', 'requestId']),
    tool('void_reply_comment', 'Reply on a Void comment.', { resourceId, threadId: label, text, expectedCommentsRevision: revision, requestId }, ['resourceId', 'threadId', 'text', 'expectedCommentsRevision', 'requestId']),
  ];
}

export function validateRpc(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return { ok: false, code: -32600, message: 'Invalid Request' };
  }
  if (message.id !== undefined && message.id !== null && !['string', 'number'].includes(typeof message.id)) {
    return { ok: false, code: -32600, message: 'Invalid Request' };
  }
  return { ok: true };
}

function rpcFailure(idValue, code, message, errorCode) {
  const requestId = typeof idValue === 'string' && isUuid(idValue) ? idValue : null;
  return {
    jsonrpc: '2.0',
    id: idValue ?? null,
    error: { code, message, data: safeError(new CoreError(400, errorCode, message), requestId).error },
  };
}

function schemaError(idValue, message) {
  return rpcFailure(idValue, -32602, message, 'invalid_body');
}

function checkArgs(name, args) {
  const definition = toolSchemas().find((item) => item.name === name);
  if (!definition) return { code: -32601, message: 'Method not found' };
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { code: -32602, message: 'Tool arguments must be an object.' };
  for (const key of definition.inputSchema.required) {
    if (args[key] === undefined) return { code: -32602, message: `Missing ${key}.` };
  }
  for (const [key, value] of Object.entries(args)) {
    const rule = definition.inputSchema.properties[key];
    if (!rule) return { code: -32602, message: `Unknown argument ${key}.` };
    if (!valueMatches(rule, value)) return { code: -32602, message: `Invalid argument ${key}.` };
  }
  return null;
}

function valueMatches(rule, value) {
  if (Array.isArray(rule.type)) return value === null && rule.type.includes('null') || typeof value === 'string' && rule.type.includes('string') && value.length <= (rule.maxLength ?? Infinity);
  if (rule.type === 'integer') return Number.isInteger(value) && value >= (rule.minimum ?? 0) && value <= Number.MAX_SAFE_INTEGER;
  if (rule.type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (rule.type === 'array') return Array.isArray(value) && value.length <= rule.maxItems && value.every(item => valueMatches(rule.items, item));
  if (rule.type !== 'string' || typeof value !== 'string') return false;
  if (rule.maxLength && value.length > rule.maxLength) return false;
  if (rule.enum && !rule.enum.includes(value)) return false;
  if (rule.format === 'uuid') return isUuid(value);
  if (rule.format === 'hash') return /^[0-9a-f]{64}$/.test(value);
  return true;
}

export async function callTool(context, name, args) {
  const value = await runTool(context, name, args);
  if (!context.wake?.touch) return value;
  const registration = await canonicalRegistration(context);
  if (!await proveBinding(context, registration)) return value;
  const touched = await context.wake.touch({ unit: registration.unit, unitId: registration.unitId,
    nativeSessionId: registration.nativeSessionId, client: registration.client, machine: registration.machine });
  return touched?.notice ? { ...value, wakeNotice: touched.notice } : value;
}

async function runTool(context, name, args) {
  if (name === 'native_permission') {
    const registration = await canonicalRegistration(context);
    await verifiedSessionScope(context);
    return transactLegacy(context, name, args, registration, name, () => context.adapters[registration.client].permission(registration, args));
  }
  if (['file_read', 'file_write', 'git_request', 'git_execute'].includes(name)) {
    const registration = await canonicalRegistration(context);
    await verifiedSessionScope(context);
    if (name === 'file_read') return readScopedFile(context, args);
    if (name === 'git_request') {
      await assertGitCapability(context, args.action, args.repository);
      return transactLegacy(context, name, args, registration, name, () => requestScopedGit(context, args));
    }
    if (name === 'git_execute') return runScopedGit(context, args);
    return transactLegacy(context, name, args, registration, name, () => writeScopedFile(context, { ...args, expectedRevision: args.expectedRevision ?? null }));
  }
  if (name === 'session_open' || name === 'session_complete') {
    const registration = await canonicalRegistration(context);
    return transactLegacy(context, name, args, registration, name, () => name === 'session_open'
      ? requestApproval(context, { action: 'session.open', pattern: { client: args.client, machine: args.machine, unitId: args.unitId, runMode: args.runMode, taskId: args.taskId }, display: `Asks to open a session: ${args.client} CLI on ${args.machine}`, alwaysAllowed: false, operationId: args.requestId })
      : completeSessionTask(context, registration.sessionId, args));
  }
  if (typeof args?.resourceId === 'string' && (name.startsWith('blueprint_') || name.startsWith('void_'))) {
    await requireAttachment(context, args.resourceId);
  }
  if (name === 'blueprint_open' || name === 'void_open') {
    const value = await readEditor(context, args.resourceId);
    noteActivity(context, args.resourceId, null, name === 'void_open' ? 'void' : 'blueprint');
    return value;
  }
  if (MUTATIONS.has(name)) return mutateTool(context, name, args);
  const legacy = await legacyCall(context, name, args);
  if (legacy !== undefined) return legacy;
  throw new CoreError(404, 'not_found', 'The tool does not exist.');
}

async function mutateTool(context, name, args) {
  const saved = await withReceipt(context.store, {
    principal: context.credential?.token ?? context.principal?.stableId ?? 'mcp',
    key: args.requestId,
    method: 'POST',
    path: `/mcp/${name}`,
    body: args,
    requestId: args.requestId,
  }, async (receipt) => {
    const value = await runMutation(context, name, args);
    noteActivity(context, args.resourceId, focusFor(name, args), name.startsWith('void_') ? 'void' : 'blueprint');
    await atomicWrite(context.store, path.join(context.store.localDirectory, 'receipts', receipt.principalHash, `${receipt.key}.json`), Buffer.from(`${canonicalJson({
      ...receipt,
      status: 200,
      response: value,
    })}\n`));
    return value;
  });
  return saved?.replayed ? saved.body : saved;
}

export async function dispatch(context, message) {
  const valid = validateRpc(message);
  if (!valid.ok) return rpcFailure(message?.id ?? null, valid.code, valid.message, valid.code === -32700 ? 'invalid_json' : 'invalid_body');
  const { id: rpcId, method, params = {} } = message;
  if (method.startsWith('notifications/')) return { notification: true };
  if (method === 'initialize') {
    if (params.protocolVersion !== PROTOCOL) return schemaError(rpcId, 'Unsupported protocol version');
    return { jsonrpc: '2.0', id: rpcId, result: { protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'hivem1nd-relay', version: '3.0.0' } } };
  }
  if (method === 'ping') return { jsonrpc: '2.0', id: rpcId, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id: rpcId, result: { tools: await listedTools() } };
  if (method === 'tools/call') {
    const problem = checkArgs(params.name, params.arguments ?? {});
    if (problem?.code === -32601 && await legacyNamed(params.name)) {
      try {
        const value = await callTool(context, params.name, params.arguments ?? {});
        return toolSuccess(rpcId, value);
      } catch (error) {
        return toolFailure(rpcId, params.arguments ?? {}, error);
      }
    }
    if (problem) return rpcFailure(rpcId ?? null, problem.code, problem.message, problem.code === -32601 ? 'not_found' : 'invalid_body');
    try {
      const value = await callTool(context, params.name, params.arguments);
      return toolSuccess(rpcId, value);
    } catch (error) {
      return toolFailure(rpcId, params.arguments ?? {}, error);
    }
  }
  return rpcFailure(rpcId ?? null, -32601, 'Method not found', 'not_found');
}

function toolSuccess(rpcId, value) {
  return { jsonrpc: '2.0', id: rpcId, result: { content: [{ type: 'text', text: JSON.stringify({ contract: 'hivem1nd-gui-v3', data: value }) }], isError: false } };
}

function toolFailure(rpcId, args, error) {
  const requestId = isUuid(args.requestId) ? args.requestId : (isUuid(rpcId) ? rpcId : null);
  const body = safeError(error instanceof CoreError ? error : new CoreError(500, 'internal_error', 'The request failed.'), requestId);
  return { jsonrpc: '2.0', id: rpcId, result: { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }] } };
}

async function listedTools() {
  const { RELAY_TOOLS } = await import('../relay/mcp.mjs');
  return [...RELAY_TOOLS, ...toolSchemas()];
}

async function legacyNamed(name) {
  const { RELAY_TOOLS } = await import('../relay/mcp.mjs');
  return RELAY_TOOLS.some((item) => item.name === name);
}

const LEGACY_METHODS = {
  register: 'register', send_message: 'send', list_inbox: 'inbox', read_inbox: 'read', history: 'history',
  threads: 'threads', status: 'overview', events: 'events', reminder: 'reminder', delivery_status: 'delivery',
};
const LEGACY_MUTATIONS = new Set(['register', 'send', 'read']);

async function legacyCall(context, name, args) {
  const method = LEGACY_METHODS[name];
  if (!method) return undefined;
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const registration = await canonicalRegistration(context);
  assertCallerBinding(input, registration);
  const forwarded = forwardedArgs(method, input, registration);
  const { openRelayOperations } = await import('./client.mjs');
  const relay = await openRelayOperations({
    mindPath: context.paths.mind,
    hostname: registration.machine,
    sessionId: registration.sessionId,
    client: registration.client,
    scopeLock: true,
    pinnedRegistration: registration,
    proveBinding: () => proveBinding(context, registration),
    sessionLive: async candidate => await sessionStopped(context, candidate.sessionId) ? false
      : await context.adapters?.[candidate.client]?.confirm?.(candidate) === true ? true : null,
    commitFile: (destination, bytes) => commitMindFile(context, destination, bytes),
  });
  const run = async () => {
    try {
      const value = await relay[method](forwarded);
      if (await proveBinding(context, registration)) {
        await relay.hold();
        const binding = { unit: registration.unit, unitId: registration.unitId, nativeSessionId: registration.nativeSessionId,
          client: registration.client, machine: registration.machine };
        if (method === 'register') await context.wake?.takeOver?.(binding);
      }
      return value;
    } catch (error) {
      if (error?.code === 'FORBIDDEN_SCOPE' || error?.code === 'UNPROVED_SESSION') {
        throw new CoreError(403, 'forbidden', 'The tool cannot use another unit or session.');
      }
      throw error;
    }
  };
  if (!LEGACY_MUTATIONS.has(method)) return run();
  return transactLegacy(context, name, input, registration, method, run);
}

async function canonicalRegistration(context) {
  const credential = context.credential;
  if (credential?.audience !== 'agent' || !credential.unitId || !credential.sessionId || !context.paths?.mind || !context.paths?.machine) {
    throw new CoreError(403, 'forbidden', 'The tool needs a bound agent session.');
  }
  const directory = path.join(context.paths.mind, 'user', 'relay', 'sessions');
  let names = [];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  let match = null;
  for (const name of names) {
    if (!/^[A-Za-z0-9._-]+\.json$/.test(name)) continue;
    let record;
    try {
      record = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
    } catch {
      continue;
    }
    if (record?.kind !== 'registration' || record.sessionId !== credential.sessionId) continue;
    if (record.unitId !== credential.unitId || record.machine !== context.paths.machine) continue;
    if (!record.client || !record.nativeSessionId || !record.unit) continue;
    if (!match || String(record.registeredAt ?? '') >= String(match.registeredAt ?? '')) match = record;
  }
  if (!match) throw new CoreError(403, 'forbidden', 'The session has no canonical registration.');
  if (await sessionStopped(context, credential.sessionId)) throw new CoreError(403, 'forbidden', 'The session is stopped.');
  return match;
}

function assertCallerBinding(args, registration) {
  if (args.unit !== undefined && !unitMatches(args.unit, registration)) {
    throw new CoreError(403, 'forbidden', 'The tool cannot use another unit.');
  }
  if (args.client !== undefined && args.client !== registration.client) {
    throw new CoreError(403, 'forbidden', 'The tool cannot use another client.');
  }
  if (args.nativeSessionId !== undefined && args.nativeSessionId !== registration.nativeSessionId) {
    throw new CoreError(403, 'forbidden', 'The tool cannot use another native session.');
  }
}

function unitMatches(unit, registration) {
  return typeof unit === 'string' && (unit.toLowerCase() === registration.unit.toLowerCase() || unit === registration.unitId);
}

function forwardedArgs(method, args, registration) {
  if (method === 'register') {
    return {
      unit: registration.unit,
      nativeSessionId: registration.nativeSessionId,
      client: registration.client,
      ...(args.activity !== undefined ? { activity: args.activity } : {}),
      ...(args.quota !== undefined ? { quota: args.quota } : {}),
    };
  }
  const copy = { ...args };
  delete copy.requestId;
  delete copy.unit;
  delete copy.client;
  delete copy.nativeSessionId;
  if (method !== 'overview') delete copy.machine;
  return copy;
}

export function carryNativeConversation(context, binding, hostSessionId) {
  return carryHostConversation({ mindPath: context.paths.mind, hostname: context.paths.machine,
    binding, hostSessionId, controller: context.wake,
    proveBinding: async proof => !await sessionStopped(context, proof.sessionId)
      && await context.adapters?.[proof.client]?.confirm?.(proof) === true,
    commitFile: (destination, bytes) => commitMindFile(context, destination, bytes) });
}

async function proveBinding(context, registration) {
  const adapter = context.adapters?.[registration.client];
  if (typeof adapter?.confirm !== 'function') return false;
  const confirmed = await adapter.confirm({
    unitId: registration.unitId,
    nativeSessionId: registration.nativeSessionId,
    client: registration.client,
    machine: registration.machine,
  });
  if (confirmed !== true) return false;
  const directory = path.join(context.paths.localDirectory, 'session-starts');
  let names = [];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    let journal;
    try {
      journal = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
    } catch {
      continue;
    }
    if (journal?.sessionId !== registration.sessionId || !Number.isInteger(journal.pid) || journal.pid <= 0) continue;
    if (context.ownedPids?.has(journal.pid)) return true;
  }
  return false;
}

async function sessionStopped(context, sessionId) {
  const directory = path.join(context.paths.mind, 'user', 'relay', 'session-status', sessionId);
  let names = [];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const record = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
      if (record?.state === 'stopped') return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function transactLegacy(context, name, args, registration, method, run) {
  const requestId = isUuid(args.requestId) ? args.requestId : randomUUID();
  if (method === 'send') {
    if (!context.ledger) throw new CoreError(503, 'service_unavailable', 'Message admission is not composed.');
    await admitMessage(context.ledger, { id: requestId, record: Buffer.from(String(args.body ?? ''), 'utf8') });
  }
  const saved = await withReceipt(context.store, {
    principal: context.credential?.token ?? registration.sessionId,
    key: requestId,
    method: 'POST',
    path: `/mcp/${name}`,
    body: args,
    requestId,
  }, async (receipt) => {
    const value = await run();
    await atomicWrite(context.store, path.join(context.store.localDirectory, 'receipts', receipt.principalHash, `${receipt.key}.json`), Buffer.from(`${canonicalJson({
      ...receipt,
      status: 200,
      response: value,
    })}\n`));
    context.security?.record({
      type: 'auth.success',
      actor: registration.unitId,
      session: registration.sessionId,
      outcome: 'success',
    });
    return value;
  });
  return saved?.replayed ? saved.body : saved;
}

async function commitMindFile(context, destination, bytes) {
  return withLocalChanges(context.store, () => commitMindFileLocked(context, destination, bytes));
}

async function commitMindFileLocked(context, destination, bytes) {
  const relative = path.relative(context.paths.mind, destination);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new CoreError(403, 'forbidden', 'The tool cannot write outside the mind.');
  }
  const normalized = relative.split(path.sep).join('/');
  const current = await readBytes(context.store, destination);
  const id = randomUUID();
  await commitTransaction(context.store, {
    id,
    entries: [{
      resource: normalized,
      recordPath: destination,
      beforeRevision: current ? revisionOf(current) : null,
      afterBytes: bytes,
    }],
    events: [],
  });
  const sync = context.sync ?? openSync({ store: context.store, paths: context.paths, now: () => context.now?.() ?? Date.now() });
  const changes = await stageTransaction(sync, [{ target: { kind: 'mind', path: normalized }, bytes }], { transactionId: id });
  noteSync(context, changes.length ? 'pending' : 'local');
  if (typeof context.pulse?.changed === 'function') {
    const result = await context.pulse.changed(changes.map((change) => change.id));
    if (result?.published === true) noteSync(context, 'published');
  }
}

async function runMutation(context, name, args) {
  if (name === 'blueprint_add_node') return addNode(context, args.resourceId, args);
  if (name === 'blueprint_update_node') return updateNode(context, args.resourceId, args.nodeId, { changes: args.changes, expectedRevision: args.expectedRevision });
  if (name === 'blueprint_remove_node') return removeNode(context, args.resourceId, args.nodeId, { expectedRevision: args.expectedRevision });
  if (name === 'blueprint_reply_comment' || name === 'void_reply_comment') {
    return replyComment(context, args.resourceId, args.threadId, { text: args.text, expectedCommentsRevision: args.expectedCommentsRevision });
  }
  if (name === 'void_replace_range') return replaceRange(context, args.resourceId, args);
  throw new CoreError(404, 'not_found', 'The tool does not exist.');
}

function focusFor(name, args) {
  if (name.startsWith('void_') && args.k) return { k: args.k, lang: args.lang ?? null, start: args.start ?? null, end: args.end ?? null };
  if (args.nodeId) return { screenId: args.screenId ?? null, nodeId: args.nodeId };
  return null;
}

function noteActivity(context, resourceId, focus, kind) {
  const unitId = context.credential?.unitId ?? context.principal?.unitId ?? null;
  const at = new Date(context.now?.() ?? Date.now()).toISOString();
  const data = { resourceId, kind, unitId, at, focus };
  publishDomainEvents(context, [{ name: 'editor.activity', resourceId, unitId, data }]);
  if (context.watch && unitId) recordActivity(context.watch, { unitId, resourceId, at, focus });
}
