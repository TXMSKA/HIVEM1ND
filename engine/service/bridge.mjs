import { randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoreError, hashBytes, isUuid, parseUnitId, uuidV8 } from './identity.mjs';
import { commitChange, readBytes, revisionOf, withLocalChanges } from './store.mjs';
import { createCredentialStore } from './security.mjs';
import { bindManualAdditionContent } from '../relay/local-wake.mjs';
import { verifiedSessionScope } from './file-access.mjs';
import { callLocalTool, localToolNames } from './mcp.mjs';
import { readUnitState } from './state.mjs';
import { assertPlanActor, ingestPlanSignal, waitForPlanActor } from './runs.mjs';
import { createRelay } from '../relay/store.mjs';

const OPERATIONS = new Set(['register', 'send', 'read', 'history', 'reminder', 'activity', 'wake', 'policy', 'shutdown']);

// Local callbacks receive a captured service actor, never model-supplied authority.
export async function bindLocalTools(context, registration) {
  if (registration.client !== 'lyra' || registration.machine !== context.paths.machine) throw new CoreError(403, 'forbidden', 'The local actor belongs to another owner.');
  const actor = Object.freeze({ audience: 'agent', client: 'lyra', unitId: registration.unitId, sessionId: registration.sessionId });
  const bound = { ...context, principal: actor, credential: actor };
  const plan = context.localPlanBinding;
  bound.localPlanBinding = plan?.unitId === actor.unitId && plan?.sessionId === actor.sessionId ? plan : null;
  const verify = async () => {
    const scope = bound.localPlanBinding?.role ? await assertPlanActor(bound, plan.runId) : await verifiedSessionScope(bound);
    if (bound.localAppLive && !await bound.localAppLive()) throw new CoreError(403, 'lyra_revoked', 'The local application permission is unavailable.');
    return scope;
  };
  await verify();
  const state = actor.unitId ? await readUnitState(bound, parseUnitId(actor.unitId)) : null;
  const role = plan?.role ?? state?.bytes.toString('utf8').match(/^role:\s*(\S+)/m)?.[1];
  const names = localToolNames(bound);
  return { role, names, resources: [`unit:${actor.unitId}`, 'inbox', 'tasks', 'content', 'rules', 'role'], verify,
    call: (event, signal) => callLocalTool(bound, registration, event, signal) };
}

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
    launches: new Map(),
    adapters: options.adapters ?? {},
    paths: options.paths ?? null,
    additionContext: options.additionContext ?? null,
    now: options.now ?? (() => Date.now()),
    relay: options.relay ?? null,
    operations: options.operations ?? {},
    ownerShutdown: options.ownerShutdown ?? null,
    settled: new Map(),
    sockets: new Set(),
    server: null,
  };
  const server = createServer({ allowHalfOpen: true }, (socket) => accept(socket, bridge));
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
    const socket = createConnection(bridge.endpoint, () => socket.write(payload));
    let data = '';
    let answered = false;
    const timer = setTimeout(() => socket.destroy(new CoreError(503, 'service_unavailable', 'The owner bridge did not answer.')), 3000);
    socket.setEncoding('utf8');
    socket.once('close', () => { clearTimeout(timer); if (!answered) reject(new CoreError(503, 'service_unavailable', 'The owner bridge closed without a complete response.')); });
    socket.on('data', (chunk) => {
      data += chunk;
      if (Buffer.byteLength(data, 'utf8') > 100000) { socket.destroy(new CoreError(422, 'invalid_body', 'The bridge response is too large.')); return; }
      if (!data.includes('\n')) return;
      try { const message = JSON.parse(data.slice(0, data.indexOf('\n'))); answered = true; resolve(message); }
      catch { reject(new CoreError(422, 'invalid_body', 'The bridge response is not JSON.')); }
      finally { socket.destroy(); }
    });
    socket.on('error', reject);
    socket.on('end', () => {
      if (!answered) reject(new CoreError(503, 'service_unavailable', 'The owner bridge closed without a complete response.'));
      socket.destroy();
    });
  });
  if (response.id !== id) throw new CoreError(422, 'invalid_binding', 'The bridge response did not match the request.');
  if (response.error) throw new CoreError(401, response.error, 'The bridge rejected the message.');
  return response.result;
}

export function createNativeLaunch(bridge, request) {
  const unitId = request.planActor?.unitId === null ? null : parseUnitId(request.unitId).id;
  if (!['codex', 'cursor', 'claude'].includes(request.client) || !bridge.paths?.machine) {
    throw new CoreError(422, 'invalid_binding', 'The native launch binding is incomplete.');
  }
  const secret = randomBytes(32).toString('base64url');
  const launch = { unitId, client: request.client, machine: bridge.paths.machine, nativeSessionId: null, token: null,
    contentReader: request.contentReader ?? null, planActor: request.planActor ?? null };
  bridge.launches.set(secret, launch);
  return {
    env: { HIVEM1ND_SERVICE_BRIDGE: bridge.endpoint, HIVEM1ND_SERVICE_GRANT: secret },
    mcp: {
      name: 'hivem1nd-relay',
      command: process.execPath,
      args: [fileURLToPath(new URL('../../cli/index.mjs', import.meta.url)), 'relay', 'mcp', '--mind-path', bridge.paths.mind, '--client', request.client],
      env: [],
    },
    ready(nativeSessionId) {
      if (typeof nativeSessionId !== 'string' || !nativeSessionId || bridge.launches.get(secret) !== launch) {
        throw new CoreError(422, 'invalid_binding', 'The native launch was not acknowledged.');
      }
      launch.nativeSessionId = nativeSessionId;
    },
    close() {
      bridge.launches.delete(secret);
      if (launch.token) bridge.credentials.revoke(launch.token);
      launch.token = null;
    },
  };
}

export async function dispatchNative(endpoint, secret, operation, binding = {}) {
  if (typeof endpoint !== 'string' || typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) {
    throw new CoreError(503, 'native_login_unverified', 'The native service binding is unavailable.');
  }
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint);
    let data = '';
    let answered = false;
    const timer = setTimeout(() => socket.destroy(new CoreError(503, 'service_unavailable', 'The native bridge did not answer.')), 3000);
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(`${JSON.stringify({ id, operation, secret, binding })}\n`));
    socket.on('data', (chunk) => {
      data += chunk;
      if (Buffer.byteLength(data, 'utf8') > 100000) socket.destroy(new CoreError(422, 'invalid_body', 'The bridge response is too large.'));
      if (!data.includes('\n')) return;
      try {
        const message = JSON.parse(data.slice(0, data.indexOf('\n')));
        if (message.id !== id || message.error) throw new CoreError(403, message.error ?? 'invalid_binding', 'The native bridge rejected the binding.');
        answered = true;
        resolve(message.result);
      } catch (error) { reject(error); }
      finally { socket.destroy(); }
    });
    socket.once('error', reject);
    socket.once('close', () => { clearTimeout(timer); if (!answered) reject(new CoreError(503, 'service_unavailable', 'The native bridge closed without a complete response.')); });
    socket.once('end', () => {
      if (!answered) reject(new CoreError(503, 'service_unavailable', 'The native bridge closed without a complete response.'));
      socket.destroy();
    });
  });
}

export async function handleNativeHook({ controller, credentials, binding }) {
  const allowed = {
    claude: new Set(['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PreToolUse', 'Stop', 'SessionEnd']),
    codex: new Set(['SessionStart', 'UserPromptSubmit']),
    cursor: new Set(['sessionStart', 'postToolUse', 'stop']),
  };
  if (!controller || !allowed[binding.client]?.has(binding.event)) throw new CoreError(503, 'service_unavailable', 'The native hook is unavailable.');
  const enabled = await controller.findEnabledBinding({ nativeSessionId: binding.nativeSessionId, client: binding.client, machine: binding.machine });
  const unit = parseUnitId(binding.unitId).unit;
  if (enabled && (enabled.unit.toLowerCase() !== unit.toLowerCase() || enabled.unitId && enabled.unitId !== binding.unitId)) throw new CoreError(403, 'forbidden', 'The native wake binding is unavailable.');
  const exact = { unit, unitId: binding.unitId, nativeSessionId: binding.nativeSessionId, client: binding.client, machine: binding.machine };
  if (binding.event === 'SessionEnd') {
    await controller.endSession(exact);
    credentials?.revokeSession(binding.sessionId);
  } else {
    const touched = await controller.touch?.(exact);
    if (!enabled) return { verified: true, ...(touched?.notice ? { wakeNotice: touched.notice } : {}) };
    const activity = ['UserPromptSubmit', 'PreToolUse'].includes(binding.event) ? 'busy' : 'idle';
    await controller.observeActivity(exact, { activity });
    return { verified: true, ...(touched?.notice ? { wakeNotice: touched.notice } : {}) };
  }
  return { verified: true };
}

export async function handleRelayPolicy({ controller, bridge, binding: input }) {
  if (!controller || !['attach', 'enable', 'disable', 'status'].includes(input.action)) throw new CoreError(422, 'invalid_body', 'The shared wake operation is invalid.');
  if (Object.keys(input).some(key => !['action', 'binding', 'consent'].includes(key))
      || input.consent && (typeof input.consent !== 'object' || Array.isArray(input.consent)
        || Object.keys(input.consent).some(key => !['windowHours', 'extended', 'unlimited', 'manualConsent', 'maxHandoffs', 'maxDailyHandoffs'].includes(key)))) {
    throw new CoreError(422, 'invalid_body', 'The shared wake consent is invalid.');
  }
  const binding = input.binding;
  if (!binding || binding.machine !== bridge.paths.machine) throw new CoreError(403, 'forbidden', 'The wake binding belongs to another machine.');
  if (input.action === 'status') return controller.status(binding);
  if (input.action === 'disable') return controller.disable(binding);
  let policy;
  if (input.action === 'enable') policy = await controller.enable({ ...binding, ...input.consent });
  else {
    policy = await controller.status(binding);
    if (!policy.enabled) throw new CoreError(409, 'wake_expired', 'An explicit wake enable is required for this binding.');
  }
  const worker = controller.start(policy.binding);
  const ready = await worker.ready;
  return { binding: policy.binding, policy, service: 'ready', worker: ready.state, ownsLease: ready.ownsLease, delivery: 'not claimed' };
}

export async function initializeNativeEntry({ controller, bridge, request, registration }) {
  if (!controller || request.unitId !== registration.unitId || request.client !== registration.client
      || registration.machine !== bridge.paths.machine) throw new CoreError(503, 'native_login_unverified', 'The native entry could not be verified.');
  const proof = { unitId: registration.unitId, nativeSessionId: registration.nativeSessionId, client: registration.client, machine: registration.machine };
  if (await bridge.adapters?.[registration.client]?.confirm?.(proof) !== true) throw new CoreError(503, 'native_login_unverified', 'The native entry could not be verified.');
  const directory = path.join(bridge.paths.mind, 'user', 'relay', 'wake', 'policies');
  const matches = [];
  for (const name of await jsonNames(directory)) {
    const policy = await readJson(path.join(directory, name));
    const binding = policy?.binding;
    if (binding?.nativeSessionId !== proof.nativeSessionId || binding.client !== proof.client || binding.machine !== proof.machine) continue;
    if (binding.unitId && binding.unitId !== proof.unitId || !binding.unitId && binding.unit !== registration.unit) continue;
    matches.push(policy);
  }
  const exact = { unit: registration.unit, ...proof };
  if (!matches.length) await controller.takeOver?.(exact);
  const continued = await controller.status(exact);
  if (matches.length) {
    const now = bridge.now();
    if (matches.some((policy) => policy.enabled !== true || policy.pausedReason
      || !policy.unlimited && (!Number.isFinite(Date.parse(policy.deadlineAt)) || Date.parse(policy.deadlineAt) <= now))) {
      throw new CoreError(409, 'wake_expired', 'The previous wake consent is no longer active.');
    }
  } else if (!continued.enabled && continued.startedAt) {
    throw new CoreError(409, 'wake_expired', 'The previous wake consent is no longer active.');
  } else if (!continued.enabled) {
    await controller.enable({ unit: registration.unit, nativeSessionId: proof.nativeSessionId, client: proof.client, machine: proof.machine });
  }
  const worker = controller.start(exact);
  await worker.ready;
  return { attached: true };
}

export async function renewPlanWakeLease(context, run, binding) {
  const controller = context.runWake ?? context.store.runWake;
  if (!controller) return null;
  if (!['open', 'stopping'].includes(run.state)) { await controller.releaseRunLease(run.id); return null; }
  if (!binding || binding.role !== 'coordinator' || binding.machine !== context.paths.machine || !binding.unitId) return { pausedReason: 'wake_unavailable' };
  // Native identity, role and canonical unit are captured by the owner, never inferred from a shared service PID.
  if (await context.adapters?.[binding.client]?.confirm?.(binding) !== true) return { pausedReason: 'wake_unavailable' };
  const exact = { unit: parseUnitId(binding.unitId).unit, unitId: binding.unitId, client: binding.client, machine: binding.machine, nativeSessionId: binding.nativeSessionId };
  try {
    const relay = await createRelay({ mindPath: context.paths.mind, hostname: binding.machine, sessionId: binding.sessionId, client: binding.client });
    if (!await relay.wakePersistence.resolveBinding(exact)) await relay.register({ unit: exact.unit, unitId: exact.unitId, client: exact.client,
      nativeSessionId: exact.nativeSessionId, hostSessionId: binding.sessionId });
    const status = await controller.renewRunLease(exact, { runId: run.id, role: binding.role, hostSessionId: binding.sessionId });
    if (!status.enabled) return { ...status, pausedReason: status.pausedReason ?? 'revoked' };
    return status;
  } catch { return { pausedReason: 'wake_unavailable' }; }
}

export async function maintainPlanActorWake(context, run, binding) {
  const controller = context.runWake ?? context.store.runWake;
  if (!controller?.maintainActor || !binding) return null;
  const verify = async () => {
    const { readRunRecord } = await import('./runs.mjs');
    const latest = (await readRunRecord(context, run.id)).record;
    return ['open', 'stopping'].includes(latest.state) && latest.attempts.some(a => a.id === binding.attemptId && !a.resolved && a.sessionId === binding.sessionId)
      && await context.adapters?.[binding.client]?.confirm?.(binding) === true;
  };
  const directory = path.join(context.paths.localDirectory, 'runs', run.id, 'inbox', hashBytes(Buffer.from(`${binding.actorId}:${binding.role}`)));
  const native = { unit: binding.unitId ? parseUnitId(binding.unitId).unit : null, unitId: binding.unitId, nativeSessionId: binding.nativeSessionId, client: binding.client, machine: binding.machine };
  try {
    return await controller.maintainActor(native, { ...binding, hostSessionId: binding.sessionId }, { verify,
      inbox: async () => {
        const rows = [];
        for (const name of await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
          if (!isUuid(path.basename(name, '.json'))) continue;
          const bytes = await readBytes(context.store, path.join(directory, name));
          if (bytes) {
            const row = JSON.parse(bytes);
            if (['submitted', 'ambiguous'].includes(row.state)) continue;
            if (row.messageId) {
              const message = await readBytes(context.store, path.join(context.paths.localDirectory, 'runs', run.id, 'messages', `${row.messageId}.json`));
              if (!message || JSON.parse(message).recipients.find(r => r.actorId === binding.actorId && r.role === binding.role)?.readAt) continue;
            }
            const { readRunRecord } = await import('./runs.mjs');
            const latest = (await readRunRecord(context, run.id)).record;
            if (['no_start', 'stalled', 'unread'].includes(row.kind) && !latest.alerts.some(a => !a.resolved && row.actionId?.startsWith(`${a.id}:`))) continue;
            if (row.kind === 'summary' && Number(row.actionId?.split(':').at(-1)) < Math.floor((context.now() - Date.parse(latest.startedAt)) / 1800000)) continue;
            rows.push(row);
          }
        }
        return rows;
      },
      acknowledge: (pointer, state) => withLocalChanges(context.store, async () => {
        const file = path.join(directory, `${pointer.deliveryId}.json`), before = await readBytes(context.store, file);
        if (!before) return;
        await commitChange({ ...context, receipt: null }, { id: randomUUID(), entries: [{ resource: file, recordPath: file, beforeRevision: revisionOf(before),
          afterBytes: Buffer.from(JSON.stringify({ ...JSON.parse(before), state, deliveredAt: state === 'submitted' ? new Date(context.now()).toISOString() : null })), private: true }], events: [], response: { status: 200, body: null } });
      }) });
  } catch { return { pausedReason: 'wake_unavailable' }; }
}

async function nativeOperation(bridge, secret, operation, input) {
  const launch = bridge.launches.get(secret);
  if (!launch?.nativeSessionId || !['attach', 'hook', 'policy', 'content'].includes(operation)) {
    throw new CoreError(403, 'native_login_unverified', 'The native launch has not been verified.');
  }
  if (input.nativeSessionId != null && input.nativeSessionId !== launch.nativeSessionId
      || input.client != null && input.client !== launch.client
      || input.unitId != null && input.unitId !== launch.unitId) {
    throw new CoreError(403, 'forbidden', 'The native binding cannot be changed.');
  }
  const proof = { unitId: launch.unitId, nativeSessionId: launch.nativeSessionId, client: launch.client, machine: launch.machine };
  const adapter = bridge.adapters?.[proof.client];
  if (await adapter?.confirm?.(proof) !== true) throw new CoreError(403, 'native_login_unverified', 'The native process is no longer attached.');
  if (launch.planActor) {
    if (operation !== 'attach' && operation !== 'hook') throw new CoreError(403, 'forbidden', 'The plan actor has no ordinary session authority.');
    const actor = launch.planActor;
    const context = { ...bridge.additionContext, paths: bridge.paths, adapters: bridge.adapters,
      principal: { audience: 'agent', unitId: actor.unitId, sessionId: actor.sessionId } };
    await waitForPlanActor(context, actor.sessionId);
    const bound = await assertPlanActor(context, actor.runId, actor.attemptId);
    if (operation === 'hook') {
      if (['SessionStart', 'sessionStart'].includes(input.event)) await ingestPlanSignal(context, { ...bound, id: 'hook-init', kind: 'start', source: 'hook' });
      if (['PostToolUse', 'postToolUse'].includes(input.event) && input.evidence
        && Object.keys(input.evidence).sort().join(',') === 'id,kind,step' && input.evidence.kind === 'step_end') {
        await ingestPlanSignal(context, { ...bound, ...input.evidence, source: 'hook' });
      }
      return { verified: true };
    }
    if (!launch.token) launch.token = bridge.credentials.issue({ audience: 'agent', unitId: actor.unitId, sessionId: actor.sessionId, capabilities: ['own'], attached: true }).token;
    return { origin: bridge.origin, token: launch.token, ...proof, sessionId: actor.sessionId, runId: actor.runId, attemptId: actor.attemptId };
  }
  if (input.hostSessionId !== undefined && !launch.planActor) {
    if (operation !== 'attach' && operation !== 'hook' || proof.client !== 'claude'
      || launch.hostSessionId && launch.hostSessionId !== input.hostSessionId) throw new CoreError(403, 'forbidden', 'The host conversation cannot be changed.');
    if (typeof bridge.carryConversation !== 'function') throw new CoreError(503, 'service_unavailable', 'Host continuity is unavailable.');
    const carried = await bridge.carryConversation({ ...proof, unit: parseUnitId(proof.unitId).unit,
      sessionId: uuidV8(['session', proof.machine, proof.client, proof.nativeSessionId, proof.unitId]) }, input.hostSessionId);
    if (!carried) throw new CoreError(403, 'forbidden', 'The host conversation could not be verified.');
    launch.hostSessionId = input.hostSessionId;
  }
  if (operation === 'hook') {
    const sessionId = uuidV8(['session', proof.machine, proof.client, proof.nativeSessionId, proof.unitId]);
    if (!await newestRegistration(bridge.paths.mind, sessionId, proof, proof.unitId) || await sessionStopped(bridge.paths.mind, sessionId)) {
      throw new CoreError(403, 'native_login_unverified', 'The native session is no longer attached.');
    }
    if (typeof bridge.onNativeHook !== 'function') throw new CoreError(503, 'service_unavailable', 'The native hook is unavailable.');
    return bridge.onNativeHook({ ...proof, sessionId, event: input.event });
  }
  const bound = await boundSession(bridge, proof, launch.unitId);
  if (operation === 'content') {
    if (typeof launch.contentReader !== 'function') throw new CoreError(503, 'scope_unavailable', 'The native content channel is unavailable.');
    if (Object.keys(input).some(key => !['additionId', 'path', 'offset'].includes(key))) throw new CoreError(403, 'forbidden', 'The scoped content binding cannot be changed.');
    const packages = await launch.contentReader({ ...proof, sessionId: bound.sessionId });
    if (!Object.keys(input).length) return packages.map(item => ({ addition: item.addition, files: item.files.map(file => ({ path: file.path, bytes: Buffer.from(file.bytesBase64, 'base64').length })) }));
    const file = packages.find(item => item.addition.id === input.additionId)?.files.find(item => item.path === input.path);
    if (!file) throw new CoreError(403, 'forbidden', 'This content is unavailable to the bound unit.');
    const bytes = Buffer.from(file.bytesBase64, 'base64'), offset = input.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > bytes.length) throw new CoreError(422, 'invalid_body', 'The content offset is invalid.');
    return { bytesBase64: bytes.subarray(offset, offset + 65536).toString('base64'), offset, total: bytes.length };
  }
  if (operation === 'policy') {
    const selected = input.binding ?? {};
    if (selected.unit !== parseUnitId(proof.unitId).unit || selected.unitId && selected.unitId !== proof.unitId
        || selected.nativeSessionId !== proof.nativeSessionId || selected.client !== proof.client || selected.machine !== proof.machine) {
      throw new CoreError(403, 'forbidden', 'The wake binding cannot be changed.');
    }
    return perform(bridge, 'policy', { ...input, binding: { ...selected, unitId: proof.unitId } });
  }
  if (!bridge.origin) throw new CoreError(503, 'service_unavailable', 'The service is not ready.');
  if (launch.token) {
    try { bridge.credentials.verify(launch.token); } catch { launch.token = null; }
  }
  if (!launch.token) {
    const attached = await attachNative(bridge, proof);
    launch.token = attached.token;
  }
  return { origin: bridge.origin, token: launch.token, ...proof, sessionId: bound.sessionId };
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
  if (bridge.additionContext) await bindManualAdditionContent({ ...bridge.additionContext, adapters: bridge.adapters }, { ...proof, unitId: unit.id, sessionId: bound.sessionId });
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
  if (bridge?.launches) {
    for (const launch of bridge.launches.values()) if (launch.token) bridge.credentials.revoke(launch.token);
    bridge.launches.clear();
  }
  for (const socket of bridge?.sockets ?? []) socket.destroy();
  bridge?.sockets?.clear();
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
  await bridge.adoptWake?.({ unit: parseUnitId(unitId).unit, unitId, nativeSessionId: proof.nativeSessionId, client: proof.client, machine: proof.machine });
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
    const deadline = policy.unlimited === true ? Infinity : Date.parse(policy.deadlineAt);
    if (Number.isNaN(deadline) || deadline <= now) continue;
    const wakeId = typeof policy.key === 'string' && policy.key.length > 0 ? policy.key : name.slice(0, -5);
    const generation = typeof policy.generation === 'string' ? policy.generation : null;
    if (!chosen || deadline < chosen.deadline) chosen = { wakeId, expiresAt: deadline === Infinity ? null : new Date(deadline).toISOString(), deadline, generation };
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
  bridge.sockets.add(socket);
  socket.once('close', () => bridge.sockets.delete(socket));
  socket.on('error', () => socket.destroy());
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
    const native = bridge.launches.has(message.secret);
    if (!isUuid(message.id) || !native && (message.secret !== bridge.secret || !OPERATIONS.has(message.operation))) {
      socket.end(`${JSON.stringify({ id: message.id ?? null, error: 'unauthorized' })}\n`);
      return;
    }
    (native ? nativeOperation(bridge, message.secret, message.operation, message.binding ?? {}) : perform(bridge, message.operation, message.binding ?? {})).then((result) => {
      socket.end(`${JSON.stringify({ id: message.id, result })}\n`, () => {
        if (!native && message.operation === 'shutdown' && result?.accepted === true) {
          Promise.resolve(bridge.ownerShutdown?.(message.binding ?? {}, { afterReply: true })).catch(() => {});
        }
      });
    }).catch((error) => {
      socket.end(`${JSON.stringify({ id: message.id, error: error?.code || 'delivery_failed' })}\n`);
    });
  });
}

async function perform(bridge, operation, binding) {
  if (operation === 'shutdown') {
    if (typeof bridge.ownerShutdown !== 'function') throw new CoreError(503, 'service_unavailable', 'The owner shutdown operation is unavailable.');
    return bridge.ownerShutdown(binding, { afterReply: false });
  }
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
