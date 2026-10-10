import { randomBytes, randomUUID } from 'node:crypto';
import { createConnection, createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { CoreError, isUuid, parseUnitId } from './identity.mjs';
import { createCredentialStore } from './security.mjs';

const OPERATIONS = new Set(['register', 'send', 'read', 'history', 'reminder', 'activity', 'wake']);

export async function openBridge(options = {}) {
  const secret = options.secret ?? randomBytes(32).toString('base64url');
  const credentials = options.credentials ?? createCredentialStore({ now: options.now ?? (() => Date.now()) });
  const agents = new Map();
  const endpoint = process.platform === 'win32'
    ? `\\\\.\\pipe\\hivem1nd-${randomBytes(8).toString('hex')}`
    : path.join(os.tmpdir(), `hivem1nd-${randomBytes(8).toString('hex')}.sock`);
  const bridge = {
    endpoint,
    secret,
    credentials,
    agents,
    adapters: options.adapters ?? {},
    server: null,
  };
  const server = createServer((socket) => accept(socket, bridge));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, () => resolve());
  });
  bridge.server = server;
  bridge.close = () => new Promise((resolve) => server.close(() => resolve()));
  return bridge;
}

export async function dispatchLocal(bridge, operation, binding) {
  if (!bridge?.endpoint || !bridge.secret) throw new CoreError(503, 'service_unavailable', 'The local bridge is not open.');
  if (!OPERATIONS.has(operation)) throw new CoreError(422, 'invalid_body', 'The bridge operation is not allowed.');
  const id = randomUUID();
  const payload = `${JSON.stringify({ id, operation, secret: bridge.secret, binding })}\n`;
  const response = await new Promise((resolve, reject) => {
    const socket = createConnection(bridge.endpoint, () => socket.end(payload));
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => { data += chunk; });
    socket.on('error', reject);
    socket.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { reject(new CoreError(422, 'invalid_body', 'The bridge response is not JSON.')); }
    });
  });
  if (response.error) throw new CoreError(401, response.error, 'The bridge rejected the message.');
  return response.result;
}

export async function attachNative(bridge, proof) {
  if (!proof || Object.hasOwn(proof, 'handshake')) {
    throw new CoreError(409, 'stop_unavailable', 'Native attachment needs a verified handshake.');
  }
  let unit;
  try {
    unit = parseUnitId(proof.unitId);
  } catch {
    throw new CoreError(409, 'stop_unavailable', 'Native attachment needs a verified handshake.');
  }
  if (!proof.nativeSessionId || !proof.machine || !proof.client) {
    throw new CoreError(409, 'stop_unavailable', 'Native attachment needs a verified handshake.');
  }
  const adapter = bridge.adapters?.[proof.client];
  const confirmed = adapter?.confirm ? await adapter.confirm({ ...proof, unitId: unit.id }) : false;
  if (confirmed !== true) throw new CoreError(409, 'stop_unavailable', 'Native attachment needs a verified handshake.');
  const previous = bridge.agents.get(unit.id);
  if (previous) bridge.credentials.revoke(previous);
  const issued = bridge.credentials.issue({
    audience: 'agent',
    unitId: unit.id,
    sessionId: proof.nativeSessionId,
    capabilities: ['own'],
    attached: true,
  });
  bridge.agents.set(unit.id, issued.token);
  return { attached: true, unitId: unit.id, token: issued.token };
}

export async function closeBridge(bridge) {
  if (bridge?.close) await bridge.close();
}

function accept(socket, bridge) {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > 100000) {
      socket.end(`${JSON.stringify({ error: 'invalid_body' })}\n`);
      return;
    }
    const end = buffer.indexOf('\n');
    if (end < 0) return;
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      socket.end(`${JSON.stringify({ error: 'invalid_body' })}\n`);
      return;
    }
    if (!isUuid(message.id) || message.secret !== bridge.secret || !OPERATIONS.has(message.operation)) {
      socket.end(`${JSON.stringify({ id: message.id ?? null, error: 'unauthorized' })}\n`);
      return;
    }
    socket.end(`${JSON.stringify({ id: message.id, result: { accepted: true, operation: message.operation } })}\n`);
  });
}
