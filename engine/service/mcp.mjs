import { CoreError } from './identity.mjs';
import { readEditor, addNode, updateNode, removeNode, replaceRange, replyComment } from './editors.mjs';

const PROTOCOL = '2025-03-26';

function tool(name, description, properties, required) {
  return { name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } };
}

const id = { type: 'string' };
const revision = { type: 'string' };
const requestId = { type: 'string' };

export function toolSchemas() {
  return [
    tool('blueprint_open', 'Read one Blueprint board.', { resourceId: id, requestId }, ['resourceId', 'requestId']),
    tool('blueprint_add_node', 'Add a node to a board.', { resourceId: id, screenId: id, parentId: id, index: { type: 'integer' }, node: { type: 'object' }, expectedRevision: revision, requestId }, ['resourceId', 'screenId', 'parentId', 'node', 'expectedRevision', 'requestId']),
    tool('blueprint_update_node', 'Change a node.', { resourceId: id, nodeId: id, changes: { type: 'object' }, expectedRevision: revision, requestId }, ['resourceId', 'nodeId', 'changes', 'expectedRevision', 'requestId']),
    tool('blueprint_remove_node', 'Remove a node.', { resourceId: id, nodeId: id, expectedRevision: revision, requestId }, ['resourceId', 'nodeId', 'expectedRevision', 'requestId']),
    tool('blueprint_reply_comment', 'Reply on a board comment.', { resourceId: id, threadId: id, text: { type: 'string' }, expectedCommentsRevision: revision, requestId }, ['resourceId', 'threadId', 'text', 'expectedCommentsRevision', 'requestId']),
    tool('void_open', 'Read one Void text.', { resourceId: id, requestId }, ['resourceId', 'requestId']),
    tool('void_replace_range', 'Apply or propose a text range.', { resourceId: id, k: { type: 'string' }, lang: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' }, expectedText: { type: 'string' }, replacement: { type: 'string' }, expectedRevision: revision, mode: { type: 'string' }, threadId: id, expectedCommentsRevision: revision, requestId }, ['resourceId', 'k', 'lang', 'start', 'end', 'expectedText', 'replacement', 'expectedRevision', 'requestId']),
    tool('void_reply_comment', 'Reply on a Void comment.', { resourceId: id, threadId: id, text: { type: 'string' }, expectedCommentsRevision: revision, requestId }, ['resourceId', 'threadId', 'text', 'expectedCommentsRevision', 'requestId']),
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
  if (!definition) return 'Unknown tool.';
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'Tool arguments must be an object.';
  for (const key of definition.inputSchema.required) {
    if (args[key] === undefined) return `Missing ${key}.`;
  }
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(definition.inputSchema.properties, key)) return `Unknown argument ${key}.`;
  }
  return null;
}

export async function callTool(context, name, args) {
  if (context.credential?.audience === 'agent' && context.credential.attached !== true) {
    throw new CoreError(403, 'forbidden', 'The agent is not attached to that resource.');
  }
  if (name === 'blueprint_open' || name === 'void_open') return readEditor(context, args.resourceId);
  if (name === 'blueprint_add_node') return addNode(context, args.resourceId, args);
  if (name === 'blueprint_update_node') return updateNode(context, args.resourceId, args.nodeId, { changes: args.changes, expectedRevision: args.expectedRevision });
  if (name === 'blueprint_remove_node') return removeNode(context, args.resourceId, args.nodeId, { expectedRevision: args.expectedRevision });
  if (name === 'blueprint_reply_comment' || name === 'void_reply_comment') {
    return replyComment(context, args.resourceId, args.threadId, { text: args.text, expectedCommentsRevision: args.expectedCommentsRevision });
  }
  if (name === 'void_replace_range') return replaceRange(context, args.resourceId, args);
  throw new CoreError(404, 'not_found', 'The tool does not exist.');
}

export async function dispatch(context, message) {
  const valid = validateRpc(message);
  if (!valid.ok) return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: valid.code, message: valid.message } };
  const { id: rpcId, method, params = {} } = message;
  if (method.startsWith('notifications/')) return { notification: true };
  if (method === 'initialize') {
    if (params.protocolVersion !== PROTOCOL) return schemaError(rpcId, 'Unsupported protocol version');
    return { jsonrpc: '2.0', id: rpcId, result: { protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'hivem1nd', version: '3.0.0' } } };
  }
  if (method === 'tools/list') return { jsonrpc: '2.0', id: rpcId, result: { tools: toolSchemas() } };
  if (method === 'tools/call') {
    const problem = checkArgs(params.name, params.arguments ?? {});
    if (problem) return schemaError(rpcId, problem);
    try {
      const value = await callTool(context, params.name, params.arguments);
      return { jsonrpc: '2.0', id: rpcId, result: { content: [{ type: 'text', text: JSON.stringify({ contract: 'hivem1nd-gui-v3', data: value }) }] } };
    } catch (error) {
      const body = { code: error.code ?? 'internal', message: 'The request failed.' };
      return { jsonrpc: '2.0', id: rpcId, result: { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }] } };
    }
  }
  return { jsonrpc: '2.0', id: rpcId ?? null, error: { code: -32601, message: 'Method not found' } };
}
