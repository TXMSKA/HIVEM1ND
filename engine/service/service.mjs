import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, canonicalJson } from './identity.mjs';
import { atomicWrite, readBytes, recoverTransactions } from './store.mjs';
import { writeDurable } from '../sync/origin.mjs';
import { closeBridge, openBridge } from './bridge.mjs';

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
  };
  try {
    await recoverTransactions(options.store);
    await acquireServiceLock(handle);
    handle.listener = options.listener ? await options.listener() : null;
    handle.bridge = await openBridge();
    await writeBootstrap(handle);
    handle.adopted = await adoptWake(options, { nonce });
    handle.beat = await writeBeat(options, 'running');
    return handle;
  } catch (error) {
    await rollback(handle);
    throw error;
  }
}

export async function attachOrStart(options, port = options.guardPort) {
  const deadline = Date.now() + (options.attachTimeoutMs ?? 10000);
  let bootstrap = null;
  while (Date.now() <= deadline) {
    bootstrap = await readBootstrap(options);
    if (bootstrap) break;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  if (!bootstrap) throw new CoreError(503, options.attachTimeoutMs == null ? 'service_start_timeout' : 'service_unavailable', 'The guard is occupied by something else.');
  if (bootstrap.mind !== options.paths.mind) throw new CoreError(409, 'service_mind_conflict', 'Another mind owns the service lock.');
  if (bootstrap.machine !== options.paths.machine || bootstrap.userKey !== (options.userKey ?? 'user')) {
    throw new CoreError(503, 'service_unavailable', 'The running service does not match this user.');
  }
  return { attached: true, port, bootstrap, mutated: false };
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

export async function stopService(handle) {
  if (!handle || handle.attached) return { stopped: false };
  await writeBeat(handle.options, 'stopped');
  if (handle.listener?.close) await handle.listener.close();
  await closeBridge(handle.bridge);
  const lock = await readBytes(handle.options.store, lockPath(handle.options));
  const parsed = lock ? JSON.parse(lock.toString('utf8')) : null;
  if (parsed?.nonce === handle.nonce) {
    const { unlink } = await import('node:fs/promises');
    await unlink(lockPath(handle.options)).catch(() => {});
    await unlink(bootstrapPath(handle.options)).catch(() => {});
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

async function writeBootstrap(handle) {
  const descriptor = descriptorOf(handle);
  const body = { ...descriptor, digest: createHash('sha256').update(canonicalJson(descriptor)).digest('hex') };
  await atomicWrite(handle.options.store, bootstrapPath(handle.options), Buffer.from(`${canonicalJson(body)}\n`));
  handle.bootstrap = body;
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

async function readBootstrap(options) {
  const bytes = await readBytes(options.store, bootstrapPath(options));
  return bytes ? JSON.parse(bytes.toString('utf8')) : null;
}

async function rollback(handle) {
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
