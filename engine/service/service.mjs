import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, canonicalJson } from './identity.mjs';
import { assertNoLinks } from './paths.mjs';
import { atomicWrite, readBytes, recoverTransactions } from './store.mjs';
import { writeDurable } from '../sync/origin.mjs';
import { closeBridge, openBridge } from './bridge.mjs';
import { createCredentialStore, protectBootstrapFiles, verifyBootstrapFiles } from './security.mjs';
import { createEventBus } from './events.mjs';
import { createHttpServer } from './http.mjs';

export function guardPortFor(userKey) {
  const digest = createHash('sha256').update(String(userKey)).digest();
  return 49152 + (digest.readUInt16BE(0) % 16384);
}

export async function startService(options) {
  assertReady(options);
  const port = options.guardPort ?? guardPortFor(options.userKey ?? 'user');
  const guard = createServer((socket) => socket.destroy());
  try {
    await listen(guard, port);
  } catch (error) {
    guard.close();
    if (error?.code === 'EADDRINUSE') return attachOrStart(options, port);
    throw error;
  }
  const nonce = randomUUID();
  const handle = {
    options,
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
    await recoverTransactions(options.store);
    await acquireServiceLock(handle);
    handle.listener = options.listener ? await options.listener() : null;
    handle.bridge = await openBridge();
    handle.http = await createHttpServer({
      ...options,
      bus: options.bus,
      credentials: handle.credentials,
      bootstrap: handle.bootstrapState,
    });
    handle.adopted = await adoptWake(options, { nonce });
    handle.beat = await writeBeat(options, 'running');
    handle.bootstrap = await publishBootstrap(options, handle.http.port, handle.bootstrapState);
    return handle;
  } catch (error) {
    await rollback(handle);
    throw error;
  }
}

export async function attachOrStart(options, port = options.guardPort) {
  const deadline = Date.now() + (options.attachTimeoutMs ?? 10000);
  let bootstrap = null;
  let active = null;
  let protectedRecord = false;
  while (Date.now() <= deadline) {
    bootstrap = await readOptionalJson(bootstrapPath(options));
    active = await readOptionalJson(activePath(options));
    if (bootstrap && active && (!validBootstrap(bootstrap) || !validActive(active))) {
      throw new CoreError(503, 'bootstrap_unavailable', 'The bootstrap file could not be protected.');
    }
    if (bootstrap && active) {
      try {
        await verifyBootstrapFiles(path.dirname(bootstrapPath(options)), bootstrapPath(options));
        protectedRecord = true;
        break;
      } catch {
        protectedRecord = false;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  if (!bootstrap || !active) throw new CoreError(503, options.attachTimeoutMs == null ? 'service_start_timeout' : 'service_unavailable', 'The guard is occupied by something else.');
  if (!protectedRecord) throw new CoreError(503, 'bootstrap_unavailable', 'The bootstrap file could not be protected.');
  if (active.mindPath !== options.paths.mind) throw new CoreError(409, 'service_mind_conflict', 'Another mind owns the service lock.');
  if (active.machine !== options.paths.machine || path.resolve(active.localDirectory) !== path.resolve(options.paths.localDirectory)) {
    throw new CoreError(503, 'service_unavailable', 'The running service does not match this user.');
  }
  return { attached: true, port, bootstrap, active, mutated: false };
}

export async function acquireServiceLock(handle) {
  const file = lockPath(handle.options);
  const current = await readBytes(handle.options.store, file);
  const descriptor = descriptorOf(handle);
  if (current) {
    const parsed = JSON.parse(current.toString('utf8'));
    if (parsed.nonce && parsed.pid !== process.pid && handle.options.allowStale !== true) {
      throw new CoreError(503, 'service_unavailable', 'The service lock is already held.');
    }
  }
  const body = { nonce: handle.nonce, pid: process.pid, digest: createHash('sha256').update(canonicalJson(descriptor)).digest('hex') };
  await atomicWrite(handle.options.store, file, Buffer.from(`${canonicalJson(body)}\n`));
  handle.lock = body;
  return body;
}

export async function adoptWake(options, { nonce } = {}) {
  const directory = path.join(options.paths.mind, 'user', 'relay', 'wake', 'policies');
  let names = [];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith('.json'));
  } catch (error) {
    if (error?.code === 'ENOENT') return { policies: [], workersSpawned: 0, signaled: [] };
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
  return { policies: [...merged.values()], workersSpawned: 0, signaled: [], nonce, controller: nonce ?? null };
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
  const bus = options.bus ?? createEventBus({ now: options.now, machine: options.paths.machine });
  const credentials = options.credentials ?? createCredentialStore({ now: options.now ?? (() => Date.now()) });
  const bootstrap = { valid: false, secret: null, secretBytes: null, file: null, record: null };
  const http = await createHttpServer({ ...options, bus, credentials, bootstrap, handlers: options.handlers ?? {} });
  try {
    await publishBootstrap(options, http.port, bootstrap);
  } catch (error) {
    await http.close();
    throw error;
  }
  return { bus, credentials, http, bootstrap };
}

export async function stopService(handle) {
  if (!handle || handle.attached) return { stopped: false };
  if (handle.http) await handle.http.close();
  await writeBeat(handle.options, 'stopped');
  if (handle.listener?.close) await handle.listener.close();
  await closeBridge(handle.bridge);
  const lock = await readBytes(handle.options.store, lockPath(handle.options));
  const parsed = lock ? JSON.parse(lock.toString('utf8')) : null;
  if (handle.bootstrapState) handle.bootstrapState.valid = false;
  if (parsed?.nonce === handle.nonce) {
    await unlink(lockPath(handle.options)).catch(() => {});
    await unlink(bootstrapPath(handle.options)).catch(() => {});
    await unlink(activePath(handle.options)).catch(() => {});
  }
  await new Promise((resolve) => handle.guard.close(() => resolve()));
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
    await protectBootstrapFiles(path.dirname(file), file, { handles: options.handles, sid: options.sid, fail: options.bootstrapFail === true });
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
  return {
    format: 'hivem1nd-service-descriptor-v1',
    mind: handle.options.paths.mind,
    machine: handle.options.paths.machine,
    userKey: handle.options.userKey ?? 'user',
    port: handle.port,
    pid: process.pid,
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
  const resolved = path.resolve(destination);
  const serviceRoot = path.resolve(path.dirname(path.dirname(store.localDirectory)));
  if (path.resolve(serviceRoot, 'active.json') !== resolved) throw new CoreError(422, 'unsafe_path', 'Refusing to write outside the service directory.');
  if (store.confineRoot && !contained(store.confineRoot, resolved)) throw new CoreError(422, 'unsafe_path', 'Refusing to write outside the test root.');
  await assertNoLinks(resolved, { root: store.confineRoot });
  await mkdir(path.dirname(resolved), { recursive: true });
  const temporary = path.join(path.dirname(resolved), `.${path.basename(resolved)}.${randomBytes(8).toString('hex')}.tmp`);
  await writeFile(temporary, bytes, { flag: 'wx' });
  try {
    await rename(temporary, resolved);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function rollback(handle) {
  if (handle.bootstrapState) handle.bootstrapState.valid = false;
  if (handle.bootstrapState?.file) await unlink(handle.bootstrapState.file).catch(() => {});
  if (handle.http?.close) await handle.http.close().catch(() => {});
  if (handle.listener?.close) await handle.listener.close().catch(() => {});
  await closeBridge(handle.bridge).catch(() => {});
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

function lockPath(options) {
  return path.join(options.paths.localDirectory, 'service.lock');
}

function bootstrapPath(options) {
  return path.join(options.paths.localDirectory, 'bootstrap.json');
}

function activePath(options) {
  return options.paths.activeFile ?? path.join(path.dirname(path.dirname(options.paths.localDirectory)), 'active.json');
}
