import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { CoreError, canonicalJson } from './identity.mjs';
import { assertNoLinks, localCosmic, mindKeyFor, servicePaths } from './paths.mjs';
import { atomicWrite, bindProjects, createStore, recoverTransactions } from './store.mjs';
import { applyPack } from '../sync/apply.mjs';
import { openLedger } from '../sync/limits.mjs';
import { closeOrigin, listMachineNames, openOrigin, readHead, readOriginPack, watchOrigin, writeDurable } from '../sync/origin.mjs';
import { createPulse } from '../sync/pulse.mjs';
import { openSync, stageBaselines } from '../sync/store.mjs';
import { createNativeAdapter } from './adapters.mjs';
import { closeBridge, openBridge } from './bridge.mjs';
import { bootstrapConfig } from './install.mjs';
import { aclRunnerFrom, createCredentialStore, protectBootstrapFiles } from './security.mjs';
import { createEventBus } from './events.mjs';
import { createHttpServer } from './http.mjs';
import { recoverApprovals } from './approvals.mjs';
import { deliverNotifications } from './chats.mjs';

export function guardPortFor(userKey) {
  const digest = createHash('sha256').update(String(userKey)).digest();
  return 49152 + (digest.readUInt16BE(0) % 16384);
}

export async function startService(options) {
  assertReady(options);
  const userKey = await resolveUserKey(options);
  const port = options.guardPort ?? guardPortFor(userKey);
  const guard = createServer((socket) => socket.destroy());
  try {
    await listen(guard, port);
  } catch (error) {
    guard.close();
    if (error?.code === 'EADDRINUSE') return attachOrStart({ ...options, userKey }, port);
    throw error;
  }
  const nonce = randomUUID();
  const handle = {
    options,
    userKey,
    port,
    guard,
    nonce,
    children: [],
    signaled: [],
    listener: null,
    bridge: null,
    beat: null,
    credentials: options.credentials ?? createCredentialStore({ now: options.now ?? (() => Date.now()) }),
    bootstrapState: { valid: false, secret: null, secretBytes: null, file: null, record: null },
  };
  try {
    await acquireServiceLock(handle);
    await recoverTransactions(options.store);
    const paths = servicePathsFor(options);
    await recoverApprovals({
      store: options.store,
      paths,
      now: options.now ?? (() => Date.now()),
      projects: options.projects ?? [],
    });
    await deliverNotifications({
      store: options.store,
      paths,
      now: options.now ?? (() => Date.now()),
    });
    handle.runtime = await openServiceSync({ ...options, paths }, paths);
    handle.listener = options.listener ? await options.listener() : null;
    handle.bridge = await openBridge({ credentials: handle.credentials, now: options.now });
    handle.http = await createHttpServer({
      ...options,
      paths,
      bus: options.bus,
      credentials: handle.credentials,
      bootstrap: handle.bootstrapState,
      ledger: handle.runtime.ledger,
      sync: handle.runtime.sync,
      pulse: handle.runtime.pulse,
    });
    bindRuntime(handle);
    handle.adopted = await adoptWake(options, { nonce });
    handle.adapters = openNativeAdapters();
    handle.bridge.adapters = handle.adapters.adapters;
    handle.bootstrap = await publishBootstrap(options, handle.http.port, handle.bootstrapState);
    handle.beat = await armServiceBeat(handle.runtime);
    return handle;
  } catch (error) {
    await rollback(handle);
    throw error;
  }
}

export async function runConfiguredService(options = {}) {
  const located = await readConfiguredMind(options);
  const platform = options.platform ?? process.platform;
  const paths = servicePaths({
    platform,
    env: options.env ?? process.env,
    home: options.home ?? options.homeDir ?? os.homedir(),
    mindPath: located.mindPath,
    machine: located.config.machine,
    originPath: located.config.origin.path,
  });
  if (path.resolve(paths.localDirectory) !== path.dirname(located.configFile)) {
    throw new CoreError(422, 'invalid_path', 'The configured machine directory does not match the mind.');
  }
  if (path.resolve(paths.staging) !== path.resolve(located.config.stagingPath)) {
    throw new CoreError(422, 'invalid_path', 'The configured staging path does not match the mind.');
  }
  const store = options.store ?? createRuntimeStore(paths, options);
  return startService({
    ...options,
    store,
    paths,
    port: located.config.port,
    userKey: options.userKey,
    guardPort: options.guardPort,
  });
}

export async function attachOrStart(options, port = options.guardPort) {
  const deadline = Date.now() + (options.attachTimeoutMs ?? 10000);
  let bootstrap = null;
  let active = null;
  while (Date.now() <= deadline) {
    bootstrap = await readOptionalJson(bootstrapPath(options));
    active = await readOptionalJson(activePath(options));
    if (bootstrap && active && (!validBootstrap(bootstrap) || !validActive(active))) {
      throw new CoreError(503, 'bootstrap_unavailable', 'The bootstrap file could not be protected.');
    }
    if (bootstrap && active) break;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  if (!bootstrap || !active) throw new CoreError(503, options.attachTimeoutMs == null ? 'service_start_timeout' : 'service_unavailable', 'The guard is occupied by something else.');
  if (active.mindPath !== options.paths.mind) throw new CoreError(409, 'service_mind_conflict', 'Another mind owns the service lock.');
  if (active.machine !== options.paths.machine || path.resolve(active.localDirectory) !== path.resolve(options.paths.localDirectory)) {
    throw new CoreError(503, 'service_unavailable', 'The running service does not match this user.');
  }
  const lock = parseLock(await readFile(lockPath(options)).catch(() => null));
  const userKey = options.userKey ?? await resolveUserKey(options);
  const digest = createHash('sha256').update(canonicalJson(identityOf(options, userKey, port, active.pid))).digest('hex');
  if (!lock || lock.pid !== active.pid || lock.digest !== digest || !pidAlive(active.pid)) {
    throw new CoreError(503, 'service_unavailable', 'The running service could not be verified.');
  }
  return { attached: true, port, bootstrap, active, mutated: false };
}

export async function acquireServiceLock(handle) {
  const file = lockPath(handle.options);
  const body = lockBody(handle);
  const bytes = Buffer.from(`${canonicalJson(body)}\n`);
  try {
    await writeServiceRootFile(handle.options.store, file, bytes, { exclusive: true });
    handle.lock = body;
    return body;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  const first = await readFile(file);
  const parsed = parseLock(first);
  const sameProcess = parsed?.pid === process.pid;
  if (!parsed || (pidAlive(parsed.pid) && !sameProcess)) {
    throw new CoreError(503, 'service_unavailable', 'The service lock is already held.');
  }
  const second = await readFile(file);
  if (!first.equals(second)) throw new CoreError(503, 'service_unavailable', 'The service lock is already held.');
  await writeServiceRootFile(handle.options.store, file, bytes, { exclusive: false });
  handle.lock = body;
  return body;
}

export async function adoptWake(options, { nonce } = {}) {
  const directory = path.join(options.paths.mind, 'user', 'relay', 'wake', 'policies');
  let names = [];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith('.json'));
  } catch (error) {
    if (error?.code === 'ENOENT') return wakeResult([], nonce);
    throw error;
  }
  const policies = [];
  for (const name of names) {
    const parsed = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
    policies.push(parsed);
  }
  const merged = new Map();
  for (const policy of policies) {
    const id = policy.binding?.unitId || policy.binding?.unit;
    const prior = merged.get(id);
    merged.set(id, prior ? mergePolicy(prior, policy) : policy);
  }
  return wakeResult([...merged.values()], nonce);
}

export async function writeBeat(options, state) {
  const record = {
    format: 'hivem1nd-service-v1',
    machine: options.paths.machine,
    state,
    version: '3.0.0',
    heartbeatAt: new Date(options.now()).toISOString(),
    startedAt: new Date(options.startedAt ?? options.now()).toISOString(),
  };
  const directory = options.paths.origin ? path.join(options.paths.origin, 'machines', options.paths.machine) : options.paths.localDirectory;
  const file = path.join(directory, 'service.json');
  await writeDurable(options.store, file, Buffer.from(`${canonicalJson(record)}\n`), [options.paths.mind, options.paths.localDirectory, options.paths.origin, options.store.confineRoot]);
  return record;
}

export async function composeCore(options) {
  if (options.store && options.projects) bindProjects(options.store, options.projects);
  const paths = servicePathsFor(options);
  const bus = options.bus ?? createEventBus({ now: options.now, machine: paths.machine });
  const credentials = options.credentials ?? createCredentialStore({ now: options.now ?? (() => Date.now()) });
  const bootstrap = { valid: false, secret: null, secretBytes: null, file: null, record: null };
  const runtime = await openServiceSync({ ...options, paths }, paths);
  const http = await createHttpServer({
    ...options,
    paths,
    bus,
    credentials,
    bootstrap,
    handlers: options.handlers ?? {},
    ledger: runtime.ledger,
    sync: runtime.sync,
    pulse: runtime.pulse,
  });
  bindRuntime({ http, runtime });
  try {
    await publishBootstrap({ ...options, paths }, http.port, bootstrap);
    await armServiceBeat(runtime);
  } catch (error) {
    await http.close();
    throw error;
  }
  return { bus, credentials, http, bootstrap, runtime };
}

export async function stopService(handle) {
  if (!handle || handle.attached) return { stopped: false };
  await closeOwned(handle, { beat: true });
  const raw = await readFile(lockPath(handle.options)).catch(() => null);
  const parsed = parseLock(raw);
  if (handle.bootstrapState) handle.bootstrapState.valid = false;
  if (parsed?.nonce === handle.nonce) {
    await unlink(lockPath(handle.options)).catch(() => {});
    await unlink(bootstrapPath(handle.options)).catch(() => {});
    await unlink(activePath(handle.options)).catch(() => {});
  }
  if (handle.guard) await new Promise((resolve) => handle.guard.close(() => resolve()));
  return { stopped: true, signaled: handle.signaled };
}

function mergePolicy(left, right) {
  const deadline = earlier(left.deadlineAt, right.deadlineAt);
  const maxHandoffs = Math.min(left.maxHandoffs ?? Infinity, right.maxHandoffs ?? Infinity);
  const deliveries = { ...(left.deliveries ?? {}), ...(right.deliveries ?? {}) };
  for (const id of new Set([...Object.keys(left.deliveries ?? {}), ...Object.keys(right.deliveries ?? {})])) {
    deliveries[id] = dominate(left.deliveries?.[id], right.deliveries?.[id]);
  }
  return { ...left, deadlineAt: deadline, maxHandoffs, deliveries, unlimited: false, extended: left.extended === true && right.extended === true };
}

function dominate(left, right) {
  const rank = { ambiguous: 3, submitted: 2, attempting: 1, not_submitted: 0, failed: 0 };
  if (!left) return right;
  if (!right) return left;
  return (rank[left.state] ?? 0) >= (rank[right.state] ?? 0) ? left : right;
}

function earlier(left, right) {
  const a = Date.parse(left ?? '');
  const b = Date.parse(right ?? '');
  if (!Number.isFinite(a)) return right;
  if (!Number.isFinite(b)) return left;
  return a <= b ? left : right;
}

function servicePathsFor(options) {
  const paths = { ...options.paths };
  if (!paths.origin) paths.origin = path.join(paths.localDirectory, 'origin');
  return paths;
}

function quietTimer(fn, ms) {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return timer;
}

function bindRuntime(handle) {
  const closeHttp = handle.http.close.bind(handle.http);
  handle.http.close = async () => {
    await closeServiceSync(handle.runtime);
    await closeHttp();
  };
}

async function openServiceSync(options, paths) {
  await mkdir(path.join(paths.origin, 'machines'), { recursive: true });
  const now = options.now ?? (() => Date.now());
  const sync = openSync({ store: options.store, paths, now, projects: options.projects ?? [] });
  const origin = openOrigin({ store: options.store, paths, now, machine: paths.machine });
  const ledger = openLedger({ store: options.store, paths, now, machine: paths.machine });
  const pulse = createPulse({ sync, origin, ledger, now, setTimeout: quietTimer, clearTimeout });
  const runtime = {
    sync,
    origin,
    ledger,
    pulse,
    paths,
    now,
    beat: null,
    beatTimer: null,
    closed: false,
    lastError: null,
    startedAt: new Date(options.startedAt ?? now()).toISOString(),
  };
  try {
    await stageBaselines(sync);
    await pulse.resume();
    runtime.unwatch = watchOrigin(origin, () => {
      reconcileOrigin(runtime).catch((error) => {
        runtime.lastError = error;
      });
    });
    runtime.unwatchProject = watchProjects(paths.mind);
    return runtime;
  } catch (error) {
    await closeServiceSync(runtime, { beat: false });
    throw error;
  }
}

async function publishServiceBeat(runtime, state) {
  const record = {
    format: 'hivem1nd-service-v1',
    machine: runtime.paths.machine,
    state,
    version: '3.0.0',
    heartbeatAt: new Date(runtime.now()).toISOString(),
    startedAt: runtime.startedAt,
  };
  const result = await runtime.pulse.beat(record);
  if (result.published) runtime.beat = result.record ?? record;
  return runtime.beat;
}

async function closeServiceSync(runtime, { beat = true } = {}) {
  if (!runtime || runtime.closed) return;
  runtime.closed = true;
  if (runtime.beatTimer) clearInterval(runtime.beatTimer);
  runtime.beatTimer = null;
  if (runtime.unwatchProject) await runtime.unwatchProject();
  runtime.unwatchProject = null;
  if (beat) {
    try {
      await publishServiceBeat(runtime, 'stopped');
    } catch {
      // A failed final beat must not leave the watcher or the pulse open.
    }
  }
  runtime.pulse.close();
  if (runtime.unwatch) await runtime.unwatch();
  await closeOrigin(runtime.origin);
}

async function reconcileOrigin(runtime) {
  const names = await listMachineNames(runtime.origin);
  const bindings = await ownerBindings(runtime.sync);
  const provider = {
    async readHead(machine) { return readHead(runtime.origin, machine); },
    async readPack(machine, sequence) { return readOriginPack(runtime.origin, machine, sequence); },
  };
  for (const machine of names) {
    await mirrorBeat(runtime, machine);
    if (machine === runtime.origin.machine) continue;
    const head = await readHead(runtime.origin, machine);
    const sequence = head?.sequence ?? 0;
    for (let index = 1; index <= sequence; index += 1) {
      const packed = await readOriginPack(runtime.origin, machine, index);
      if (!packed) continue;
      await applyPack(runtime.sync, packed, {
        provider,
        bindings,
        ledger: runtime.ledger,
        projects: runtime.sync.projects,
      });
    }
  }
  await retryPending(runtime, provider, bindings);
}

async function retryPending(runtime, provider, bindings) {
  const root = path.join(runtime.paths.localDirectory, 'received', 'pending');
  let machines = [];
  try {
    machines = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const machine of machines) {
    if (!machine.isDirectory() || machine.isSymbolicLink()) continue;
    const names = await readdir(path.join(root, machine.name));
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const sequence = Number(name.slice(0, -'.json'.length));
      if (!Number.isInteger(sequence)) continue;
      const packed = await readOriginPack(runtime.origin, machine.name, sequence);
      if (!packed) continue;
      await applyPack(runtime.sync, packed, {
        provider,
        bindings,
        ledger: runtime.ledger,
        projects: runtime.sync.projects,
      });
    }
  }
}

async function mirrorBeat(runtime, machine) {
  const source = path.join(runtime.paths.origin, 'machines', machine, 'service.json');
  let bytes;
  try {
    bytes = await readFile(source);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    return;
  }
  if (parsed?.format !== 'hivem1nd-service-v1') return;
  const destination = path.join(runtime.paths.mind, 'machines', machine, 'service.json');
  await atomicWrite(runtime.sync.store, destination, Buffer.from(`${canonicalJson(parsed)}\n`));
}

async function ownerBindings(sync) {
  const bindings = { requests: {}, approvals: {}, revocations: {} };
  await readJsonTree(path.join(sync.paths.mind, 'user', 'relay', 'requests'), (record) => {
    if (record?.format === 'hivem1nd-session-request-v1' && record.id) bindings.requests[record.id] = { targetMachine: record.targetMachine };
  });
  await readJsonTree(path.join(sync.paths.mind, 'user', 'relay', 'approvals'), (record) => {
    if (record?.format === 'hivem1nd-approval-v1' && record.id) bindings.approvals[record.id] = { machine: record.machine };
    if (record?.format === 'hivem1nd-approval-binding-v1' && record.approvalId) {
      bindings.approvals[record.approvalId] = { machine: record.machine ?? bindings.approvals[record.approvalId]?.machine };
    }
    if (record?.format === 'hivem1nd-grant-revocation-result-v1' && record.requestId) bindings.revocations[record.requestId] = { machine: record.machine };
  });
  return bindings;
}

async function readJsonTree(directory, visit) {
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await readJsonTree(full, visit);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      await visit(JSON.parse(await readFile(full, 'utf8')));
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
}

function assertReady(options) {
  if (!options?.paths?.mind || !options?.store) throw new CoreError(503, 'service_unavailable', 'The service needs a configured mind.');
}

async function publishBootstrap(options, httpPort, state) {
  const now = options.now ?? (() => Date.now());
  const startedAt = new Date(options.startedAt ?? now()).toISOString();
  const origin = `http://127.0.0.1:${httpPort}`;
  const secretBytes = randomBytes(32);
  const secret = secretBytes.toString('base64url');
  const record = { format: 'hivem1nd-bootstrap-v1', origin, secret, startedAt };
  const active = {
    pid: process.pid,
    mindPath: options.paths.mind,
    machine: options.paths.machine,
    localDirectory: options.paths.localDirectory,
    startedAt,
  };
  const local = { format: 'hivem1nd-service-local-v1', pid: process.pid, origin, startedAt };
  const file = bootstrapPath(options);
  try {
    await writeDescriptor(options.store, activePath(options), Buffer.from(`${canonicalJson(active)}\n`));
    await atomicWrite(options.store, path.join(options.paths.localDirectory, 'service.json'), Buffer.from(`${canonicalJson(local)}\n`));
    await atomicWrite(options.store, file, Buffer.from(`${canonicalJson(record)}\n`));
    state.file = file;
    state.secretBytes = secretBytes;
    state.secret = secret;
    state.record = record;
    state.valid = false;
    await protectBootstrapFiles(path.dirname(file), file, {
      aclRunner: options.aclRunner,
      store: options.store,
      fail: options.bootstrapFail === true,
    });
    state.valid = true;
    return record;
  } catch (error) {
    state.valid = false;
    state.secret = null;
    state.secretBytes = null;
    state.record = null;
    if (state.file) await unlink(state.file).catch(() => {});
    throw error;
  }
}

function descriptorOf(handle) {
  return identityOf(handle.options, handle.userKey, handle.port, process.pid);
}

function identityOf(options, userKey, port, pid) {
  return {
    format: 'hivem1nd-service-descriptor-v1',
    mind: path.resolve(options.paths.mind),
    machine: options.paths.machine,
    userKey,
    port,
    pid,
  };
}

async function readOptionalJson(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new CoreError(503, 'bootstrap_unavailable', 'The bootstrap file could not be protected.');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new CoreError(503, 'bootstrap_unavailable', 'The bootstrap file could not be protected.');
  }
}

function validBootstrap(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  if (Object.keys(record).sort().join(',') !== 'format,origin,secret,startedAt') return false;
  if (record.format !== 'hivem1nd-bootstrap-v1' || typeof record.origin !== 'string' || typeof record.startedAt !== 'string') return false;
  return /^[A-Za-z0-9_-]{43}$/.test(record.secret) && Buffer.from(record.secret, 'base64url').length === 32;
}

function validActive(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  if (Object.keys(record).sort().join(',') !== 'localDirectory,machine,mindPath,pid,startedAt') return false;
  return typeof record.mindPath === 'string'
    && typeof record.machine === 'string'
    && typeof record.localDirectory === 'string'
    && Number.isInteger(record.pid)
    && typeof record.startedAt === 'string';
}

function contained(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function writeDescriptor(store, destination, bytes) {
  await writeServiceRootFile(store, destination, bytes, { exclusive: false, name: 'active.json' });
}

async function rollback(handle) {
  if (handle.bootstrapState) handle.bootstrapState.valid = false;
  if (handle.bootstrapState?.file) await unlink(handle.bootstrapState.file).catch(() => {});
  await closeOwned(handle, { beat: false });
  const raw = await readFile(lockPath(handle.options)).catch(() => null);
  if (parseLock(raw)?.nonce === handle.nonce) await unlink(lockPath(handle.options)).catch(() => {});
  if (handle.guard) await new Promise((resolve) => handle.guard.close(() => resolve()));
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

async function resolveUserKey(options) {
  if (options.userKey) return String(options.userKey);
  if (process.platform === 'win32') return aclRunnerFrom(options).userSid();
  if (typeof process.getuid === 'function') return String(process.getuid());
  throw new CoreError(503, 'bootstrap_unavailable', 'The current user could not be identified.');
}

async function readConfiguredMind(options) {
  if (!options.mindPath) throw new CoreError(503, 'mind_not_configured', 'The mind has no service configuration.');
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? options.homeDir ?? os.homedir();
  const cosmic = options.cosmicPath ? path.resolve(options.cosmicPath) : localCosmic({ platform, env, home });
  const mindPath = path.resolve(options.mindPath);
  const root = path.join(cosmic, 'hivem1nd-service', mindKeyFor(mindPath, platform));
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') throw new CoreError(503, 'mind_not_configured', 'The mind has no service configuration.');
    throw error;
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const file = path.join(root, entry.name, 'config.json');
    let parsed;
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw new CoreError(422, 'invalid_body', 'The service configuration is not valid.');
    }
    found.push({ machine: entry.name, file, parsed });
  }
  if (found.length === 0) throw new CoreError(503, 'mind_not_configured', 'The mind has no service configuration.');
  const wanted = options.hostname ?? options.machine ?? null;
  const chosen = wanted ? found.find((item) => item.machine === wanted || item.parsed?.machine === wanted) : found.length === 1 ? found[0] : null;
  if (!chosen) throw new CoreError(409, 'service_mind_conflict', 'The configured machine does not match.');
  if (chosen.parsed?.format !== 'hivem1nd-service-config-v1') throw new CoreError(422, 'invalid_body', 'The service configuration is not valid.');
  const config = bootstrapConfig(chosen.parsed);
  if (path.resolve(config.mindPath) !== mindPath || config.machine !== chosen.machine) {
    throw new CoreError(422, 'invalid_body', 'The configured mind does not match.');
  }
  return { cosmic, mindPath, config, configFile: chosen.file };
}

function createRuntimeStore(paths, options) {
  const store = createStore({
    root: paths.cosmic,
    mindPath: paths.mind,
    localDirectory: paths.localDirectory,
    now: options.now ?? (() => Date.now()),
    confineRoot: options.confineRoot ?? null,
  });
  if (options.aclRunner) store.aclRunner = options.aclRunner;
  bindProjects(store, options.projects ?? []);
  return store;
}

function wakeResult(policies, nonce) {
  return { policies, workersSpawned: 0, signaled: [], nonce, controller: startWakeController(nonce) };
}

function startWakeController(nonce) {
  let timer = setInterval(() => {}, 1000);
  timer.unref?.();
  let closed = false;
  return {
    started: true,
    nonce: nonce ?? null,
    close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      timer = null;
    },
  };
}

function openNativeAdapters() {
  const adapters = {
    claude: createNativeAdapter('claude', { live: true }),
    codex: createNativeAdapter('codex', { live: true }),
    cursor: createNativeAdapter('cursor', { live: true }),
  };
  return {
    adapters,
    async close() {
      await Promise.all(Object.values(adapters).map((adapter) => adapter.close()));
    },
  };
}

async function armServiceBeat(runtime) {
  if (!runtime || runtime.closed || runtime.beatTimer) return runtime?.beat ?? null;
  runtime.beat = await publishServiceBeat(runtime, 'running');
  runtime.beatTimer = setInterval(() => {
    publishServiceBeat(runtime, 'running').catch((error) => {
      runtime.lastError = error;
    });
  }, 60000);
  runtime.beatTimer.unref?.();
  return runtime.beat;
}

function watchProjects(directory) {
  let watcher = null;
  try {
    watcher = watch(directory, { persistent: false, recursive: process.platform === 'win32' || process.platform === 'darwin' }, () => {});
    watcher.unref?.();
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return async () => {
    watcher?.close();
    watcher = null;
  };
}

async function closeOwned(handle, { beat = true } = {}) {
  handle.adopted?.controller?.close?.();
  if (handle.adapters?.close) await handle.adapters.close().catch(() => {});
  if (handle.http?.close) await handle.http.close().catch(() => {});
  else if (handle.runtime && !handle.runtime.closed) await closeServiceSync(handle.runtime, { beat }).catch(() => {});
  if (handle.listener?.close) await handle.listener.close().catch(() => {});
  await closeBridge(handle.bridge).catch(() => {});
}

function lockBody(handle) {
  return {
    nonce: handle.nonce,
    pid: process.pid,
    digest: createHash('sha256').update(canonicalJson(descriptorOf(handle))).digest('hex'),
  };
}

function parseLock(bytes) {
  if (!bytes) return null;
  try {
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (!parsed || typeof parsed.nonce !== 'string' || !Number.isInteger(parsed.pid) || !/^[0-9a-f]{64}$/.test(parsed.digest ?? '')) return null;
    return parsed;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function serviceRootOf(options) {
  return options.paths.serviceRoot ?? path.dirname(path.dirname(options.paths.localDirectory));
}

async function writeServiceRootFile(store, destination, bytes, { exclusive = false, name = null } = {}) {
  const resolved = path.resolve(destination);
  const expected = name ?? path.basename(resolved);
  if (expected !== 'active.json' && expected !== 'service.lock') {
    throw new CoreError(422, 'unsafe_path', 'Refusing to write outside the service directory.');
  }
  const serviceRoot = path.resolve(path.dirname(path.dirname(store.localDirectory)));
  if (path.resolve(serviceRoot, expected) !== resolved) throw new CoreError(422, 'unsafe_path', 'Refusing to write outside the service directory.');
  if (store.confineRoot && !contained(store.confineRoot, resolved)) throw new CoreError(422, 'unsafe_path', 'Refusing to write outside the test root.');
  await assertNoLinks(resolved, { root: store.confineRoot });
  await mkdir(path.dirname(resolved), { recursive: true });
  if (exclusive) {
    const handle = await open(resolved, 'wx');
    try {
      await handle.writeFile(bytes);
    } catch (error) {
      await handle.close();
      await unlink(resolved).catch(() => {});
      throw error;
    }
    await handle.close();
    return resolved;
  }
  const temporary = path.join(path.dirname(resolved), `.${path.basename(resolved)}.${randomBytes(8).toString('hex')}.tmp`);
  await writeFile(temporary, bytes, { flag: 'wx' });
  try {
    await rename(temporary, resolved);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return resolved;
}

function lockPath(options) {
  return options.paths.lockFile ?? path.join(serviceRootOf(options), 'service.lock');
}

function bootstrapPath(options) {
  return path.join(options.paths.localDirectory, 'bootstrap.json');
}

function activePath(options) {
  return options.paths.activeFile ?? path.join(path.dirname(path.dirname(options.paths.localDirectory)), 'active.json');
}
