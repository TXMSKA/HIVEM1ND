import path from 'node:path';
import { CoreError, canonicalJson, isUuid } from './identity.mjs';
import { readEditor, addNode, updateNode, removeNode, replaceRange, replyComment } from './editors.mjs';
import { publishDomainEvents } from './events.mjs';
import { atomicWrite, withReceipt } from './store.mjs';

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

function schemaError(idValue, message) {
  return { jsonrpc: '2.0', id: idValue ?? null, error: { code: -32602, message } };
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
  if (rule.type === 'integer') return Number.isInteger(value) && value >= (rule.minimum ?? 0) && value <= Number.MAX_SAFE_INTEGER;
  if (rule.type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (rule.type !== 'string' || typeof value !== 'string') return false;
  if (rule.maxLength && value.length > rule.maxLength) return false;
  if (rule.enum && !rule.enum.includes(value)) return false;
  if (rule.format === 'uuid') return isUuid(value);
  if (rule.format === 'hash') return /^[0-9a-f]{64}$/.test(value);
  return true;
}

export async function callTool(context, name, args) {
  if (context.credential?.audience === 'agent' && context.credential.attached !== true) {
    throw new CoreError(403, 'not_attached', 'The agent is not attached to that resource.');
  }
  if (name === 'blueprint_open' || name === 'void_open') {
    const value = await readEditor(context, args.resourceId);
    noteActivity(context, args.resourceId, null);
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
    noteActivity(context, args.resourceId, args.nodeId ?? args.threadId ?? null);
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
  if (!valid.ok) return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: valid.code, message: valid.message } };
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
    if (problem) return { jsonrpc: '2.0', id: rpcId ?? null, error: { code: problem.code, message: problem.message } };
    try {
      const value = await callTool(context, params.name, params.arguments);
      return toolSuccess(rpcId, value);
    } catch (error) {
      return toolFailure(rpcId, params.arguments ?? {}, error);
    }
  }
  return { jsonrpc: '2.0', id: rpcId ?? null, error: { code: -32601, message: 'Method not found' } };
}

function toolSuccess(rpcId, value) {
  return { jsonrpc: '2.0', id: rpcId, result: { content: [{ type: 'text', text: JSON.stringify({ contract: 'hivem1nd-gui-v3', data: value }) }], isError: false } };
}

function toolFailure(rpcId, args, error) {
  const requestId = isUuid(args.requestId) ? args.requestId : (isUuid(rpcId) ? rpcId : null);
  const body = {
    error: {
      code: typeof error?.code === 'string' ? error.code : 'internal',
      message: 'The request failed.',
      requestId,
      details: error?.details && typeof error.details === 'object' ? error.details : {},
      retryAt: error?.retryAt ?? null,
    },
  };
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
  threads: 'threads', status: 'status', events: 'events', reminder: 'reminder', delivery_status: 'delivery',
};

async function legacyCall(context, name, args) {
  const method = LEGACY_METHODS[name];
  if (!method) return undefined;
  const { openRelayOperations } = await import('./client.mjs');
  const relay = await openRelayOperations({
    mindPath: context.paths?.mind,
    hostname: context.paths?.machine,
    sessionId: context.credential?.sessionId,
    client: 'cursor',
  });
  return relay[method](args);
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

function noteActivity(context, resourceId, focus) {
  publishDomainEvents(context, [{
    name: 'editor.activity',
    data: { resourceId, focus, unitId: context.credential?.unitId ?? context.principal?.unitId ?? null },
  }]);
}
