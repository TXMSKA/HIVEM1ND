import { randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { CoreError, isUuid, parseUnitId, uuidV8 } from './identity.mjs';
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
    paths: options.paths ?? null,
    now: options.now ?? (() => Date.now()),
    relay: options.relay ?? null,
    operations: options.operations ?? {},
    settled: new Map(),
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
  const bound = await boundSession(bridge, proof, unit.id);
  const previous = bridge.agents.get(unit.id);
  if (previous) bridge.credentials.revoke(previous);
  const issued = bridge.credentials.issue({
    audience: 'agent',
    unitId: unit.id,
    sessionId: bound.sessionId,
    wakeId: bound.wakeId,
    generation: bound.generation,
    capabilities: ['own'],
    attached: true,
    expiresAt: bound.expiresAt,
  });
  bridge.agents.set(unit.id, issued.token);
  return { attached: true, unitId: unit.id, token: issued.token };
}

export async function closeBridge(bridge) {
  if (bridge?.close) await bridge.close();
}

async function boundSession(bridge, proof, unitId) {
  const mind = bridge.paths?.mind;
  if (!mind) throw new CoreError(409, 'stop_unavailable', 'Native attachment needs a verified handshake.');
  const sessionId = uuidV8(['session', proof.machine, proof.client, proof.nativeSessionId, unitId]);
  const registration = await newestRegistration(mind, sessionId, proof, unitId);
  if (!registration || await sessionStopped(mind, sessionId)) {
    throw new CoreError(409, 'stop_unavailable', 'Native attachment needs a verified handshake.');
  }
  const wake = await activeWake(bridge, proof, unitId);
  if (!wake) throw new CoreError(409, 'stop_unavailable', 'Native attachment needs a verified handshake.');
  return { sessionId, wakeId: wake.wakeId, generation: wake.generation, expiresAt: wake.expiresAt };
}

async function newestRegistration(mind, sessionId, proof, unitId) {
  const names = await jsonNames(path.join(mind, 'user', 'relay', 'sessions'));
  let match = null;
  for (const name of names) {
    const record = await readJson(path.join(mind, 'user', 'relay', 'sessions', name));
    if (!record || record.sessionId !== sessionId) continue;
    if (record.machine !== proof.machine || record.client !== proof.client || record.nativeSessionId !== proof.nativeSessionId || record.unitId !== unitId) continue;
    if (!match || String(record.registeredAt ?? '') >= String(match.registeredAt ?? '')) match = record;
  }
  return match;
}

async function sessionStopped(mind, sessionId) {
  if (!isUuid(sessionId)) return true;
  const names = await jsonNames(path.join(mind, 'user', 'relay', 'session-status', sessionId));
  for (const name of names) {
    const record = await readJson(path.join(mind, 'user', 'relay', 'session-status', sessionId, name));
    if (record?.state === 'stopped') return true;
  }
  return false;
}

async function activeWake(bridge, proof, unitId) {
  const now = bridge.now?.() ?? Date.now();
  const directory = path.join(bridge.paths.mind, 'user', 'relay', 'wake', 'policies');
  const names = await jsonNames(directory);
  let chosen = null;
  for (const name of names) {
    const policy = await readJson(path.join(directory, name));
    const binding = policy?.binding ?? {};
    if (binding.unitId !== unitId || binding.nativeSessionId !== proof.nativeSessionId || binding.client !== proof.client || binding.machine !== proof.machine) continue;
    if (policy.enabled !== true || policy.pausedReason) continue;
    const deadline = Date.parse(policy.deadlineAt);
    if (!Number.isFinite(deadline) || deadline <= now) continue;
    const wakeId = typeof policy.key === 'string' && policy.key.length > 0 ? policy.key : name.slice(0, -5);
    const generation = typeof policy.generation === 'string' ? policy.generation : null;
    if (!chosen || deadline < chosen.deadline) chosen = { wakeId, expiresAt: new Date(deadline).toISOString(), deadline, generation };
  }
  return chosen;
}

async function jsonNames(directory) {
  try {
    return (await readdir(directory)).filter((name) => /^[A-Za-z0-9._-]+\.json$/.test(name));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
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
    perform(bridge, message.operation, message.binding ?? {}).then((result) => {
      socket.end(`${JSON.stringify({ id: message.id, result })}\n`);
    }).catch((error) => {
      socket.end(`${JSON.stringify({ id: message.id, error: error?.code || 'delivery_failed' })}\n`);
    });
  });
}

async function perform(bridge, operation, binding) {
  const deliveryId = typeof binding?.deliveryId === 'string' ? binding.deliveryId : '';
  if (deliveryId && bridge.settled.has(deliveryId)) return bridge.settled.get(deliveryId);
  const handler = bridge.operations?.[operation] ?? bridge.relay?.[operation];
  if (typeof handler !== 'function') {
    throw new CoreError(503, 'service_unavailable', 'The bridge operation is not available.');
  }
  let result;
  try {
    result = await handler(binding);
  } catch (error) {
    if (error?.code === 'delivery_failed') return { delivered: false, state: 'failed', code: 'delivery_failed', deliveryId: deliveryId || null };
    throw error;
  }
  if (deliveryId && (result?.state === 'submitted' || result?.state === 'ambiguous')) bridge.settled.set(deliveryId, result);
  return result;
}
