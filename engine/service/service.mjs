import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { repositoryCheckoutPath } from './addition-parts.mjs';
import { appendFile, lstat, mkdir, open, readdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoreError, canonicalJson, hashBytes, isUuid, uuidV8, validateName } from './identity.mjs';
import { assertNoLinks, localCosmic, mindKeyFor, servicePaths } from './paths.mjs';
import { atomicWrite, bindProjects, createProjectionCache, createStore, noteProjectionChange, recoverTransactions } from './store.mjs';
import { applyPack, recoverIncomingGroups } from '../sync/apply.mjs';
import { openLedger } from '../sync/limits.mjs';
import { closeOrigin, listMachineNames, openOrigin, readHead, readOriginPack, watchOrigin, writeDurable } from '../sync/origin.mjs';
import { createPulse } from '../sync/pulse.mjs';
import { clearInboundFailure, openSync, readInboundFailure, recordInboundFailure } from '../sync/store.mjs';
import { clientRecords, createNativeAdapter, ownsSessionExecution, probeClients } from './adapters.mjs';
import { ownChildProcess } from './process-handle.mjs';
import { recoverContexts } from './context.mjs';
import { createRelay, parseRoutes } from '../relay/store.mjs';
import { machineRecordPath, parseMachineRecord } from '../records.mjs';
import { createRelayWakeController } from '../relay/wake.mjs';
import { carryNativeConversation } from './mcp.mjs';
import { closeBridge, createNativeLaunch, dispatchLocal, handleNativeHook, handleRelayPolicy, initializeNativeEntry, openBridge } from './bridge.mjs';
import { bootstrapConfig } from './install.mjs';
import { aclRunnerFrom, createCredentialStore, protectBootstrapFiles, verifyBootstrapFiles, wakeBindingLive } from './security.mjs';
import { createEventBus, publishDomainEvents } from './events.mjs';
import { projectChat, readDetail, readSync, viewBatch } from './projection.mjs';
import { createHttpServer } from './http.mjs';
import { consumeAnswers, consumeRevocations, recoverApprovals } from './approvals.mjs';
import { deliverNotifications } from './chats.mjs';
import { resolveActivity } from './watch.mjs';
import { bytesAt, importedSidecarEvents } from './import-events.mjs';
import { watchLocalChanges } from './local-watch.mjs';
import { migrateClusters } from './clusters.mjs';
import { createSettingsOwner, processSettingsRequests, publishMachineSettings, refreshClusterProjects } from './settings.mjs';
import { drainRunLaunches, recoverRuns } from './runs.mjs';
import { closeRunProcesses } from './run-processes.mjs';
import { openRunSupervisor, closeRunSupervisor } from './run-supervision.mjs';

export function guardPortFor(userKey) {
  const digest = createHash('sha256').update(String(userKey)).digest();
  return 49152 + (digest.readUInt16BE(0) % 16384);
}

export async function startService(options, retained = null) {
  assertReady(options);
  const userKey = await resolveUserKey(options);
  const port = options.guardPort ?? guardPortFor(userKey);
  const guard = retained?.guard ?? createServer((socket) => socket.destroy());
  try {
    if (!retained) await listen(guard, port);
  } catch (error) {
    guard.close();
    if (error?.code === 'EADDRINUSE') return attachOrStart({ ...options, userKey }, port);
    throw error;
  }
  const nonce = randomUUID();
  const handle = Object.assign(retained ?? {}, {
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
    stopping: false,
    credentials: options.credentials ?? createCredentialStore({ now: options.now ?? (() => Date.now()) }),
    bootstrapState: { valid: false, secret: null, secretBytes: null, file: null, record: null },
    receiptPrincipals: options.receiptPrincipals ?? new Map(),
    recoveryHosts: options.recoveryHosts ?? new Map(),
    injectedAdapters: retained?.injectedAdapters ?? options.adapters ?? null,
  });
  const credentials = handle.credentials;
  handle.credentials = {
    ...credentials,
    issue(input) {
      if (handle.stopping) throw new CoreError(503, 'service_unavailable', 'The service is stopping.');
      return credentials.issue(input);
    },
  };
  try {
    await acquireServiceLock(handle);
    const paths = servicePathsFor(options);
    const bus = options.bus ?? createEventBus({ now: options.now ?? (() => Date.now()), machine: paths.machine, mind: paths.mind });
    options.projects ??= await configuredProjects(paths);
    bindProjects(options.store, options.projects);
    const migrationOwner = createSettingsOwner({ ...options, paths, bus });
    await recoverTransactions(options.store, { beforeRecover: () => refreshClusterProjects(migrationOwner) });
    await refreshAdditionProjects(migrationOwner);
    await migrateClusters(migrationOwner);
    handle.credentials.bindWake((record) => wakeBindingLive(paths.mind, record, options.now?.() ?? Date.now()));
    await recoverApprovals({
      store: options.store,
      paths,
      now: options.now ?? (() => Date.now()),
      projects: options.projects ?? [],
    });
    await applyQueuedDecisions({ store: options.store, paths, now: options.now ?? (() => Date.now()), projects: options.projects ?? [], bus });
    await deliverNotifications({
      store: options.store,
      paths,
      now: options.now ?? (() => Date.now()),
    });
    handle.runtime = await openServiceSync({ ...options, paths, bus }, paths, { migrate: false });
    handle.runtime.settingsOwner.settingsHandlers = {
      ...handle.runtime.settingsOwner.settingsHandlers,
      restart: async () => {
        if (handle.runtime.processingRemoteSettings) handle.runtime.restartAfterSettings = () => restartService(handle);
        return { state: 'restarting', machine: paths.machine };
      },
    };
    handle.listener = options.listener ? await options.listener() : null;
    handle.relay = await createRelay({ mindPath: paths.mind, hostname: paths.machine });
    handle.credentials.revokeAudience('agent');
    const bridgeRuntime = { adapters: options.adapters ?? null, ownedPids: options.ownedPids ?? new Set(), ownedExecutions: options.ownedExecutions ?? new Set() };
    handle.bridge = await openBridge({
      credentials: handle.credentials,
      now: options.now,
      relay: handle.relay,
      paths,
      additionContext: handle.runtime.settingsOwner,
      operations: bridgeOperations(handle.relay, options, bridgeRuntime),
      ownerShutdown: async (binding, { afterReply = false } = {}) => {
        const expected = handle.shutdown;
        if (!expected || binding.mindPath !== expected.mindPath || binding.machine !== expected.machine
            || binding.startedAt !== expected.startedAt || binding.nonce !== handle.nonce) {
          throw new CoreError(403, 'forbidden', 'The shutdown binding does not match this service.');
        }
        const lock = parseLock(await readFile(lockPath(options)).catch(() => null));
        if (lock?.nonce !== handle.nonce || lock.digest !== handle.lock.digest) {
          throw new CoreError(409, 'service_unavailable', 'The service ownership changed.');
        }
        if (serviceInUse(handle)) throw new CoreError(409, 'service_in_use', 'An active host or native session still needs the service.');
        if (afterReply) return stopService(handle);
        return { accepted: true };
      },
    });
    handle.adapters = openNativeAdapters(options.env ?? process.env, {
      lyra: options.lyra, store: options.store,
      createNativeLaunch: request => {
        if (handle.stopping) throw new CoreError(503, 'service_unavailable', 'The service is stopping.');
        return createNativeLaunch(handle.bridge, request);
      },
      onNativeRegistered: ({ request, registration }) => initializeNativeEntry({
        controller: handle.adopted?.controller?.wake, bridge: handle.bridge, request, registration,
      }),
    });
    if (options.adapters) Object.assign(handle.adapters.adapters, options.adapters);
    bridgeRuntime.adapters = handle.adapters.adapters;
    bridgeRuntime.ownedPids = options.ownedPids ?? bridgeRuntime.ownedPids;
    options.adapters = bridgeRuntime.adapters;
    options.ownedPids = bridgeRuntime.ownedPids;
    options.ownedExecutions = bridgeRuntime.ownedExecutions;
    options.store.ownedExecutions = bridgeRuntime.ownedExecutions;
    handle.runtime.settingsOwner.adapters = { ...handle.runtime.settingsOwner.adapters, lyra: bridgeRuntime.adapters.lyra };
    handle.bridge.adapters = handle.adapters.adapters;
    await recoverContexts({ ...options, paths, bus, now: options.now ?? (() => Date.now()) });
    handle.http = await createHttpServer({
      ...options,
      assetDir: options.assetDir ?? fileURLToPath(new URL('../../gui/app/', import.meta.url)),
      paths,
      bus,
      credentials: handle.credentials,
      bootstrap: handle.bootstrapState,
      ledger: handle.runtime.ledger,
      sync: handle.runtime.sync,
      pulse: handle.runtime.pulse,
      adapters: handle.adapters.adapters,
      wake: { ...options.wake,
        touch: binding => handle.adopted?.controller?.wake.touch(binding),
        takeOver: binding => handle.adopted?.controller?.wake.takeOver(binding) },
      settingsOwner: handle.runtime.settingsOwner,
      additionOwner: handle.runtime.settingsOwner,
      receiptPrincipals: handle.receiptPrincipals,
      recoveryHosts: handle.recoveryHosts,
      restartService: () => restartService(handle),
      afterFirstView: () => handle.runtime?.startSync?.(),
    });
    handle.bridge.origin = `http://127.0.0.1:${handle.http.port}`;
    await recoverRuns({ ...options, paths, bus, now: options.now ?? (() => Date.now()), adapters: handle.adapters.adapters,
      settingsOwner: handle.runtime.settingsOwner, sync: handle.runtime.sync, pulse: handle.runtime.pulse });
    handle.bridge.onNativeHook = binding => handleNativeHook({
      controller: handle.adopted?.controller?.wake,
      credentials: handle.credentials,
      binding,
    });
    handle.bridge.adoptWake = binding => handle.adopted?.controller?.wake.adopt(binding);
    handle.bridge.carryConversation = (binding, hostSessionId) => carryNativeConversation({
      store: options.store, paths, now: options.now, adapters: handle.adapters.adapters,
      ownedPids: options.ownedPids, sync: handle.runtime.sync, pulse: handle.runtime.pulse,
      wake: handle.adopted?.controller?.wake,
    }, binding, hostSessionId);
    handle.bridge.operations.policy = binding => handleRelayPolicy({
      controller: handle.adopted?.controller?.wake,
      bridge: handle.bridge,
      binding,
    });
    bindRuntime(handle);
    handle.adopted = await adoptWake(options, { nonce, bus });
    options.store.runWake = handle.adopted?.controller?.wake;
    handle.runSupervisor = await openRunSupervisor({ ...options, paths, bus, now: options.now ?? (() => Date.now()), adapters: handle.adapters.adapters,
      settingsOwner: handle.runtime.settingsOwner, sync: handle.runtime.sync, pulse: handle.runtime.pulse });
    handle.bootstrap = await publishBootstrap(options, handle.http.port, handle.bootstrapState);
    handle.shutdown = {
      format: 'hivem1nd-shutdown-v1', endpoint: handle.bridge.endpoint, secret: handle.bridge.secret,
      mindPath: paths.mind, machine: paths.machine, startedAt: handle.bootstrap.startedAt, nonce,
    };
    handle.shutdownBytes = Buffer.from(`${canonicalJson(handle.shutdown)}\n`);
    await atomicWrite(options.store, shutdownPath(options), handle.shutdownBytes);
    await protectBootstrapFiles(paths.localDirectory, shutdownPath(options), { aclRunner: options.aclRunner, store: options.store });
    // The beat tells the other machines and the interface that this one answers, so it is written before the service is
    // offered; the settings report that goes with it waits for the deferred start.
    handle.beat = await armServiceBeat(handle.runtime, { settings: options.deferSync !== true });
    if (options.deferSync === true) {
      // Nobody may ask for a view (an agent using the service alone), so the deferred work starts on its own soon after.
      handle.syncTimer = setTimeout(() => { handle.runtime?.startSync?.(); }, options.deferSyncMs ?? 5000);
      handle.syncTimer.unref?.();
    }
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
    cosmicPath: located.cosmic,
    machine: located.config.machine,
    originPath: located.config.origin.path,
  });
  if (path.resolve(paths.localDirectory) !== path.dirname(located.configFile)) {
    throw new CoreError(422, 'invalid_path', 'The configured machine directory does not match the M1ND.');
  }
  if (path.resolve(paths.staging) !== path.resolve(located.config.stagingPath)) {
    throw new CoreError(422, 'invalid_path', 'The configured staging path does not match the M1ND.');
  }
  const projects = options.projects ?? await configuredProjects(paths);
  const store = options.store ?? createRuntimeStore(paths, { ...options, projects });
  return startService({
    ...options,
    store,
    paths,
    projects,
    port: options.port ?? located.config.port,
    userKey: options.userKey,
    guardPort: options.guardPort,
    retainHosts: true,
    // The running service answers before it starts its first pass over the files, its publishing and its report.
    deferSync: options.deferSync ?? true,
  });
}

async function configuredProjects(paths) {
  const readRecord = async (file) => {
    await assertNoLinks(file, { root: paths.mind });
    const state = await lstat(file).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!state) return null;
    if (!state.isFile()) throw new CoreError(422, 'invalid_path', 'A project registry record is not a regular file.');
    return readFile(file, 'utf8');
  };
  const routes = parseRoutes(await readRecord(path.join(paths.mind, 'user', 'routes.md')) ?? '');
  if (routes.projects.length === 0) return [];
  const machineText = await readRecord(machineRecordPath(paths.mind, paths.machine));
  const machine = machineText === null ? null : parseMachineRecord(machineText);
  if (machine && (machine.machine !== paths.machine || !path.isAbsolute(machine.mind) || path.resolve(machine.mind) !== path.resolve(paths.mind))) {
    throw new CoreError(422, 'invalid_body', 'The project registry does not match the configured machine and M1ND.');
  }
  const names = new Set();
  const projects = [];
  for (const project of routes.projects) {
    validateName(project.name, { label: 'project' });
    const key = project.name.toLowerCase();
    if (names.has(key)) throw new CoreError(409, 'project_unavailable', 'The project registry is ambiguous.');
    names.add(key);
    const mappings = (machine?.paths ?? []).filter(entry => entry.name.toLowerCase() === key);
    if (mappings.length > 1) throw new CoreError(409, 'project_unavailable', 'The machine project path is ambiguous.');
    const unavailable = { name: project.name, localPath: null, eligible: false };
    const localPath = mappings[0]?.path;
    if (!localPath) { projects.push(unavailable); continue; }
    if (!path.isAbsolute(localPath)) throw new CoreError(422, 'invalid_path', 'A registered project path must be absolute.');
    await assertNoLinks(localPath);
    const state = await lstat(localPath).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!state) { projects.push(unavailable); continue; }
    if (!state.isDirectory()) throw new CoreError(422, 'invalid_path', 'A registered project path must be a directory.');
    const product = await readRecord(path.join(paths.mind, 'user', 'projects', project.name, 'product.json'));
    const provenance = product ? JSON.parse(product) : null;
    if (provenance?.removed) continue;
    if (provenance?.additionId) {
      if (!isUuid(provenance.additionId) || !/^[a-f0-9]{64}$/.test(provenance.pin?.digest ?? '')) throw new CoreError(409, 'destination_changed', 'The accepted repository ownership changed.');
      const expected = repositoryCheckoutPath(path.join(paths.localDirectory, 'additions'), provenance.additionId, provenance.pin.digest);
      if (path.resolve(localPath) !== path.resolve(expected)) throw new CoreError(409, 'destination_changed', 'The owned checkout mapping changed.');
      const recoveryPath = path.join(paths.localDirectory, 'additions', 'repository-recovery', `${provenance.additionId}-${provenance.pin.digest}.json`);
      await assertNoLinks(recoveryPath, { root: paths.localDirectory });
      const recovery = JSON.parse(await readFile(recoveryPath));
      const expectedOwner = hashBytes(Buffer.from(canonicalJson([paths.mindKey, paths.machine, path.resolve(paths.localDirectory)])));
      if (recovery.format !== 'hivem1nd-addition-checkout-v1' || recovery.id !== provenance.additionId || recovery.ownerHash !== expectedOwner || canonicalJson(recovery.pin) !== canonicalJson(provenance.pin)) throw new CoreError(409, 'destination_changed', 'The checkout recovery ownership changed.');
    }
    projects.push({ name: project.name, localPath: await realpath(localPath), eligible: true,
      ...(provenance?.additionId ? { additionId: provenance.additionId, origin: provenance.origin, pin: provenance.pin, title: provenance.title } : {}) });
  }
  return projects;
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
  if (active.mindPath !== options.paths.mind) throw new CoreError(409, 'service_mind_conflict', 'Another M1ND owns the service lock.');
  if (active.machine !== options.paths.machine || path.resolve(active.localDirectory) !== path.resolve(options.paths.localDirectory)) {
    throw new CoreError(503, 'service_unavailable', 'The running service does not match this user.');
  }
  await assertNoLinks(bootstrapPath(options));
  await verifyBootstrapFiles(options.paths.localDirectory, bootstrapPath(options), options);
  const lock = parseLock(await readFile(lockPath(options)).catch(() => null));
  const userKey = options.userKey ?? await resolveUserKey(options);
  const digest = createHash('sha256').update(canonicalJson(identityOf(options, userKey, port, active.pid))).digest('hex');
  if (!lock || lock.pid !== active.pid || lock.digest !== digest || !pidAlive(active.pid)) {
    throw new CoreError(503, 'service_unavailable', 'The running service could not be verified.');
  }
  return { attached: true, port, bootstrap, active, mutated: false };
}

export async function refreshAdditionProjects(context) {
  const owner = context.additionOwner ?? context.settingsOwner ?? context;
  const registered = (await configuredProjects(context.paths)).filter(project => project.additionId);
  const previous = context.projects ?? owner.projects ?? [];
  const names = new Set(registered.map(project => project.name));
  const next = [...previous.filter(project => !project.additionId && !names.has(project.name)), ...registered];
  const arrays = new Set([context.projects, owner.projects, context.sync?.projects, owner.sync?.projects].filter(Array.isArray));
  for (const projects of arrays) projects.splice(0, projects.length, ...next);
  context.projects ??= next; owner.projects ??= context.projects;
  bindProjects(context.store, context.projects);
  return context.projects;
}

export function restartService(handle) {
  if (!handle || handle.attached) throw new CoreError(503, 'service_unavailable', 'Restart using the local HIVEM1ND launcher.');
  if (handle.restarting) return handle.restarting;
  handle.restarting = (async () => {
    const lock = parseLock(await readFile(lockPath(handle.options)).catch(() => null));
    if (!handle.guard?.listening || lock?.nonce !== handle.nonce || lock.digest !== handle.lock.digest) {
      throw new CoreError(409, 'service_unavailable', 'The service ownership changed.');
    }
    const options = { ...handle.options, port: handle.http.port, credentials: undefined, bus: undefined, adapters: handle.injectedAdapters,
      receiptPrincipals: handle.receiptPrincipals, recoveryHosts: handle.recoveryHosts };
    handle.stopping = true;
    handle.bootstrapState.valid = false;
    for (const audience of ['desktop', 'phone', 'agent']) handle.credentials.revokeAudience(audience);
    await unlink(bootstrapPath(options)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await closeOwned(handle);
    for (const adapter of new Set(Object.values(handle.injectedAdapters ?? {}))) adapter.reopen?.();
    for (const file of [activePath(options), shutdownPath(options)]) await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    // Keep the user guard and lock throughout replacement so contenders can only attach.
    return startService(options, handle);
  })().finally(() => { handle.restarting = null; });
  return handle.restarting;
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

// How often the service looks for a consent whose worker ended.
const WAKE_RESTART_MS = 30_000;

export async function adoptWake(options, { nonce, bus } = {}) {
  const directory = path.join(options.paths.mind, 'user', 'relay', 'wake', 'policies');
  const skipped = [];
  let names = [];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith('.json'));
  } catch (error) {
    if (error?.code === 'ENOENT') return finishWake([], options, nonce, skipped, directory);
    throw error;
  }
  const policies = [];
  for (const name of names) {
    try {
      policies.push(await readPolicyFile(path.join(directory, name)));
    } catch (error) {
      // A policy that OneDrive is still syncing is truncated or locked: it is reported and read again later, and the others are adopted.
      skipped.push({ file: name, code: error?.code ?? error?.name ?? 'unreadable' });
      try { bus?.emit({ name: 'issue.changed', data: { issue: 'wake_policy_unreadable', file: name, code: skipped.at(-1).code } }); } catch { /* the issue is advisory */ }
    }
  }
  return finishWake(policies, options, nonce, skipped, directory);
}

async function readPolicyFile(file) {
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyntaxError('The wake policy is not an object.');
  return parsed;
}

// The policies that could not be read at the start are read again, and a consent among them gets its worker once its file is whole.
async function adoptSkipped(skipped, directory, options, controller) {
  for (const item of [...skipped]) {
    let policy;
    try { policy = await readPolicyFile(path.join(directory, item.file)); } catch { continue; }
    skipped.splice(skipped.indexOf(item), 1);
    if (policy.kind !== 'relay-wake-policy' || policy.version !== 1 || policy.binding?.machine !== options.paths?.machine) continue;
    try {
      policy = await controller.wake.adopt(policy.binding) ?? policy;
      if (eligibleWake(policy, options, options.now?.() ?? Date.now())) controller.wake.start(policy.binding);
    } catch { /* a binding that cannot be adopted does not become a worker */ }
  }
}

async function finishWake(policies, options, nonce, skipped = [], directory = null) {
  const controller = await startWakeController(options, nonce);
  const now = options.now?.() ?? Date.now();
  let workersSpawned = 0;
  const merged = new Map();
  const invalid = new Set();
  for (let policy of policies) {
    let malformed = false;
    if (policy?.kind === 'relay-wake-policy' && policy.version === 1 && policy.binding?.machine === options.paths?.machine) {
      try { policy = await controller.wake.adopt(policy.binding) ?? policy; }
      catch { malformed = true; }
    }
    const binding = policy.binding ?? {};
    const id = canonicalJson([binding.unitId ?? binding.unit, binding.nativeSessionId, binding.client, binding.machine]);
    if (malformed) invalid.add(id);
    const prior = merged.get(id);
    merged.set(id, prior ? mergePolicy(prior, policy) : policy);
  }
  for (const [id, policy] of merged) {
    if (invalid.has(id)) continue;
    if (!eligibleWake(policy, options, now)) continue;
    try {
      controller.wake.start(policy.binding);
      workersSpawned += 1;
    } catch {
      // A binding that cannot be normalized does not become a worker.
    }
  }
  controller.restartEnded(options.wakeRestartMs ?? WAKE_RESTART_MS, () => skipped.length ? adoptSkipped(skipped, directory, options, controller) : null);
  return { policies: [...merged.values()], workersSpawned, signaled: [], skipped, nonce, controller };
}

function eligibleWake(policy, options, now) {
  const binding = policy?.binding;
  if (policy?.kind !== 'relay-wake-policy' || policy.version !== 1) return false;
  if (!binding?.unit || !binding.nativeSessionId || !binding.client || !binding.machine) return false;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(policy.generation ?? '')) return false;
  if (binding.machine !== options.paths?.machine) return false;
  if (policy.enabled !== true || policy.pausedReason) return false;
  if (policy.activity?.value === 'unknown') return false;
  if (policy.quota?.exhausted === true) return false;
  if (policy.unlimited === true) return true;
  const deadline = Date.parse(policy.deadlineAt);
  return Number.isFinite(deadline) && deadline > now;
}

function bridgeOperations(relay, options, runtime) {
  return {
    register: (binding) => relay.register(binding),
    send: (binding) => relay.send(binding),
    read: (binding) => relay.read(binding),
    history: (binding) => relay.history(binding),
    reminder: (binding) => relay.reminder(binding),
    activity: (binding) => activityOperation(options, runtime, binding),
    wake: (binding) => wakeOperation(options, runtime, binding),
  };
}

async function wakeOperation(options, runtime, binding) {
  const delivery = await verifiedDelivery(options, runtime, binding, binding);
  return bridgeDelivery(delivery, binding);
}

async function activityOperation(options, runtime, binding) {
  const live = await nativeSessionLive(options, runtime, binding);
  if (!live) return { activity: 'unknown', verified: false };
  if (binding?.activity === 'busy' || binding?.activity === 'idle') return { activity: binding.activity, verified: true };
  return { activity: 'unknown', verified: true };
}

async function verifiedDelivery(options, runtime, binding, input = {}) {
  const gated = deliveryGate(options, binding, input);
  if (gated) return gated;
  const live = await nativeSessionLive(options, runtime, binding);
  if (!live) return { status: 'not_submitted', reason: 'SINK_NOT_SUBMITTED' };
  const adapter = (runtime?.adapters ?? options.adapters)?.[binding?.client];
  if (typeof adapter?.send !== 'function') return { status: 'not_submitted', reason: 'SINK_NOT_SUBMITTED' };
  let result;
  try {
    result = await adapter.send({
      unit: binding?.unit ?? null,
      unitId: binding?.unitId ?? null,
      nativeSessionId: binding?.nativeSessionId,
      client: binding?.client,
      machine: binding?.machine || options.paths?.machine,
      text: typeof input?.text === 'string' ? input.text : '',
      messageIds: Array.isArray(input?.messageIds) ? input.messageIds : [],
      urgent: input?.urgent === true || binding?.urgent === true,
    });
  } catch {
    return { status: 'ambiguous', reason: 'SINK_AMBIGUOUS' };
  }
  return classifySend(result);
}

function classifySend(result) {
  if (!result || typeof result !== 'object') return { status: 'ambiguous', reason: 'SINK_AMBIGUOUS' };
  if (result.ambiguous === true || result.status === 'ambiguous') {
    return { status: 'ambiguous', reason: typeof result.reason === 'string' ? result.reason : 'SINK_AMBIGUOUS' };
  }
  if (result.submitted === true || result.status === 'submitted') return { status: 'submitted' };
  return {
    status: 'not_submitted',
    reason: typeof result.reason === 'string' ? result.reason : 'SINK_NOT_SUBMITTED',
    ...(result.deferred === true ? { deferred: true } : {}),
  };
}

function deliveryGate(options, binding, input) {
  const activity = input?.activity ?? binding?.activity ?? 'unknown';
  const urgent = input?.urgent === true || binding?.urgent === true;
  if (activity === 'busy' && !urgent) return { status: 'not_submitted', reason: 'SINK_NOT_SUBMITTED', deferred: true };
  if (activity !== 'idle' && !(activity === 'busy' && urgent)) return { status: 'not_submitted', reason: 'SINK_NOT_SUBMITTED' };
  const quota = input?.quota ?? binding?.quota;
  if (quota?.exhausted === true) return { status: 'not_submitted', reason: 'SINK_NOT_SUBMITTED' };
  if (binding?.watch === true || input?.watch === true) {
    const now = options.now?.() ?? Date.now();
    const watched = options.watch ? resolveActivity(options.watch, binding?.unitId ?? binding?.unit, now) : null;
    if (!watched) return { status: 'not_submitted', reason: 'SINK_NOT_SUBMITTED' };
  }
  return null;
}

function bridgeDelivery(delivery, binding) {
  const deliveryId = typeof binding?.deliveryId === 'string' ? binding.deliveryId : null;
  if (delivery?.status === 'submitted') return { delivered: true, state: 'submitted', deliveryId };
  const result = {
    delivered: false,
    state: delivery?.status === 'ambiguous' ? 'ambiguous' : 'not_submitted',
    reason: delivery?.reason ?? 'SINK_NOT_SUBMITTED',
    deliveryId,
  };
  if (delivery?.deferred === true) result.deferred = true;
  return result;
}

async function nativeSessionLive(options, runtime, binding) {
  if (!binding?.nativeSessionId || !binding?.client || !binding?.unit && !binding?.runId) return false;
  const machine = binding.machine || options.paths?.machine;
  if (!machine || binding.machine && binding.machine !== options.paths?.machine) return false;
  const adapter = (runtime?.adapters ?? options.adapters)?.[binding.client];
  if (typeof adapter?.confirm !== 'function') return false;
  const confirmed = await adapter.confirm({
    unitId: binding.unitId ?? null,
    nativeSessionId: binding.nativeSessionId,
    client: binding.client,
    machine,
  });
  if (confirmed !== true) return false;
  const { runIds, readRunRecord } = await import('./runs.mjs');
  for (const id of await runIds(options)) {
    const run = (await readRunRecord(options, id)).record;
    if (!['open', 'stopping'].includes(run.state) || run.machine !== machine) continue;
    for (const attempt of run.attempts.filter(a => (!binding.runId ? a.role === 'coordinator' : run.id === binding.runId && a.role === binding.role) && !a.resolved)) {
      const file = path.join(options.paths.localDirectory, 'runs', id, 'intents', `${attempt.id}.json`);
      const saved = await readOptionalJson(file), actor = saved?.binding;
      if (actor?.nativeSessionId === binding.nativeSessionId && actor.client === binding.client && actor.unitId === binding.unitId
        && actor.sessionId === attempt.sessionId) return true;
    }
  }
  const sessionId = binding.sessionId
    ?? (binding.unitId ? uuidV8(['session', machine, binding.client, binding.nativeSessionId, binding.unitId]) : null);
  if (!sessionId) return false;
  const directory = path.join(options.paths.localDirectory, 'session-starts');
  let names = [];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  const owned = runtime?.ownedPids ?? options.ownedPids;
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    let journal;
    try {
      journal = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
    } catch {
      continue;
    }
    if (journal?.sessionId !== sessionId) continue;
    if (ownsSessionExecution({ ownedPids: owned, ownedExecutions: runtime?.ownedExecutions ?? options.ownedExecutions }, journal)) return true;
  }
  return false;
}

export async function writeBeat(options, state) {
  const record = {
    format: 'hivem1nd-service-v1',
    machine: options.paths.machine,
    state,
    version: '3.0.0',
    heartbeatAt: new Date(options.now()).toISOString(),
    startedAt: new Date(options.startedAt ?? options.now()).toISOString(),
    clients: Array.isArray(options.clients) ? options.clients.map((item) => ({ id: item.id, enabled: item.enabled === true, installed: item.installed === true })) : [],
  };
  const directory = options.paths.origin ? path.join(options.paths.origin, 'machines', options.paths.machine) : options.paths.localDirectory;
  const file = path.join(directory, 'service.json');
  await writeDurable(options.store, file, Buffer.from(`${canonicalJson(record)}\n`), [options.paths.mind, options.paths.localDirectory, options.paths.origin, options.store.confineRoot]);
  return record;
}

export async function composeCore(options) {
  options.projects ??= await configuredProjects(servicePathsFor(options));
  if (options.store && options.projects) bindProjects(options.store, options.projects);
  const paths = servicePathsFor(options);
  const bus = options.bus ?? createEventBus({ now: options.now, machine: paths.machine, mind: paths.mind });
  const credentials = options.credentials ?? createCredentialStore({ now: options.now ?? (() => Date.now()) });
  const bootstrap = { valid: false, secret: null, secretBytes: null, file: null, record: null };
  const runtime = await openServiceSync({ ...options, paths, bus }, paths);
  await recoverContexts({ ...options, paths, bus, now: options.now ?? (() => Date.now()) });
  const http = await createHttpServer({
    ...options,
    assetDir: options.assetDir ?? fileURLToPath(new URL('../../gui/app/', import.meta.url)),
    paths,
    bus,
    credentials,
    bootstrap,
    handlers: options.handlers ?? {},
    ledger: runtime.ledger,
    sync: runtime.sync,
    pulse: runtime.pulse,
    settingsOwner: runtime.settingsOwner,
    additionOwner: runtime.settingsOwner,
  });
  bindRuntime({ http, runtime });
  const runContext = { ...options, paths, bus, now: options.now ?? (() => Date.now()), settingsOwner: runtime.settingsOwner };
  await recoverRuns(runContext);
  const runSupervisor = await openRunSupervisor(runContext);
  const closeHttp = http.close.bind(http);
  http.close = async () => {
    http.stopAdmission();
    await closeRunSupervisor(runContext);
    await Promise.allSettled(Object.values(options.adapters ?? {}).map(adapter => adapter.close?.()));
    await http.drainRequests();
    await drainRunLaunches(runContext);
    await closeRunProcesses(runContext);
    return closeHttp();
  };
  try {
    await publishBootstrap({ ...options, paths }, http.port, bootstrap);
    await armServiceBeat(runtime);
  } catch (error) {
    await http.close();
    throw error;
  }
  return { bus, credentials, http, bootstrap, runtime, runSupervisor };
}

function serviceInUse(handle) {
  // Viewer logout and native launch closure release the existing host/session leases.
  return (handle.runSupervisor?.openCount ?? 0) > 0 || (handle.http?.viewers?.size ?? 0) > 0 || (handle.bridge?.launches?.size ?? 0) > 0 || (handle.options.store?.ownedExecutions?.size ?? 0) > 0;
}

export async function stopService(handle, { force = false } = {}) {
  if (!handle || handle.attached) return { stopped: false };
  if (handle.restarting) await handle.restarting;
  if (!force && handle.options.retainHosts && serviceInUse(handle)) return { stopped: false, inUse: true };
  handle.stopping = true;
  if (handle.bootstrapState) handle.bootstrapState.valid = false;
  handle.credentials?.revokeAudience('agent');
  await closeOwned(handle, { beat: true });
  const raw = await readFile(lockPath(handle.options)).catch(() => null);
  const parsed = parseLock(raw);
  if (handle.bootstrapState) handle.bootstrapState.valid = false;
  if (parsed?.nonce === handle.nonce) {
    await unlink(lockPath(handle.options)).catch(() => {});
    await unlink(bootstrapPath(handle.options)).catch(() => {});
    await unlink(activePath(handle.options)).catch(() => {});
    const shutdown = await readFile(shutdownPath(handle.options)).catch(() => null);
    if (shutdown && handle.shutdownBytes?.equals(shutdown)) await unlink(shutdownPath(handle.options));
  }
  if (handle.guard) await new Promise((resolve) => handle.guard.close(() => resolve()));
  return { stopped: true, signaled: handle.signaled };
}

export async function readOwnedServiceBridge(options = {}) {
  const platform = options.platform ?? process.platform;
  const paths = servicePaths({
    platform, env: options.env ?? process.env, home: options.homeDir ?? options.home ?? os.homedir(),
    mindPath: options.mindPath, cosmicPath: options.cosmicPath,
    machine: options.hostname ?? options.machine ?? os.hostname(),
  });
  const selected = { ...options, paths };
  const userKey = await resolveUserKey(selected);
  const port = options.guardPort ?? guardPortFor(userKey);
  if (!await guardOccupied(port)) return { absent: true };
  for (const file of [activePath(selected), lockPath(selected), shutdownPath(selected)]) await assertNoLinks(file);
  const active = await readOptionalJson(activePath(selected));
  if (active && active.mindPath !== paths.mind) {
    const otherPaths = servicePaths({ platform, env: options.env ?? process.env, home: options.homeDir ?? options.home ?? os.homedir(),
      mindPath: active.mindPath, cosmicPath: paths.cosmic, machine: active.machine });
    await assertNoLinks(bootstrapPath({ paths: otherPaths }));
    await verifyBootstrapFiles(otherPaths.localDirectory, bootstrapPath({ paths: otherPaths }), { aclRunner: options.aclRunner, store: options.store });
    await attachOrStart({ ...selected, paths: otherPaths, userKey, attachTimeoutMs: options.shutdownTimeoutMs ?? 3000 }, port);
    return { unrelated: true };
  }
  const attached = await attachOrStart({ ...selected, userKey, attachTimeoutMs: options.shutdownTimeoutMs ?? 3000 }, port);
  const file = shutdownPath(selected);
  await verifyBootstrapFiles(paths.localDirectory, file, { aclRunner: options.aclRunner, store: options.store });
  const raw = await readFile(file);
  let descriptor;
  try { descriptor = JSON.parse(raw.toString('utf8')); } catch { throw new CoreError(503, 'service_unavailable', 'The shutdown descriptor is not valid.'); }
  const lock = parseLock(await readFile(lockPath(selected)).catch(() => null));
  if (!descriptor || Object.keys(descriptor).sort().join(',') !== 'endpoint,format,machine,mindPath,nonce,secret,startedAt'
      || descriptor.format !== 'hivem1nd-shutdown-v1' || descriptor.mindPath !== paths.mind || descriptor.machine !== paths.machine
      || descriptor.startedAt !== attached.active.startedAt || descriptor.startedAt !== attached.bootstrap.startedAt
      || descriptor.nonce !== lock?.nonce || !/^[A-Za-z0-9_-]{43}$/.test(descriptor.secret)
      || typeof descriptor.endpoint !== 'string' || !descriptor.endpoint.startsWith(process.platform === 'win32' ? '\\\\.\\pipe\\hivem1nd-' : `${os.tmpdir()}${path.sep}hivem1nd-`)) {
    throw new CoreError(503, 'service_unavailable', 'The shutdown descriptor does not match the running service.');
  }
  if (!(await readFile(file)).equals(raw)) throw new CoreError(409, 'service_unavailable', 'The service ownership changed.');
  return { descriptor, paths, file, port };
}

export async function stopConfiguredService(options = {}) {
  const owned = await readOwnedServiceBridge(options);
  if (!owned.descriptor) return { stopped: false, ...owned };
  const { descriptor, paths, file, port } = owned;
  const selected = { ...options, paths };
  const result = await dispatchLocal(descriptor, 'shutdown', {
    mindPath: paths.mind, machine: paths.machine, startedAt: descriptor.startedAt, nonce: descriptor.nonce,
  });
  if (result?.accepted !== true) throw new CoreError(503, 'service_unavailable', 'The service did not accept shutdown.');
  const deadline = Date.now() + (options.shutdownTimeoutMs ?? 10000);
  while (Date.now() <= deadline) {
    const remaining = await Promise.all([file, activePath(selected), lockPath(selected)].map(target => readFile(target).catch(error => { if (error?.code === 'ENOENT') return null; throw error; })));
    if (remaining.every(value => value === null) && !await guardOccupied(port)) return { stopped: true, authenticated: true };
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new CoreError(503, 'service_unavailable', 'The authenticated service has not finished shutdown.');
}

function guardOccupied(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1000, () => socket.destroy(new CoreError(503, 'service_unavailable', 'The service guard did not answer.')));
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', error => error?.code === 'ECONNREFUSED' ? resolve(false) : reject(error));
  });
}

function mergePolicy(left, right) {
  if (left.key && left.key === right.key && left.generation === right.generation) return right;
  const deadline = earlier(left.deadlineAt, right.deadlineAt);
  const wakeCount = Math.max(left.wakeCount ?? 0, right.wakeCount ?? 0);
  const remaining = Math.min((left.maxHandoffs ?? 20) - (left.wakeCount ?? 0), (right.maxHandoffs ?? 20) - (right.wakeCount ?? 0));
  const deliveries = { ...(left.deliveries ?? {}), ...(right.deliveries ?? {}) };
  for (const id of new Set([...Object.keys(left.deliveries ?? {}), ...Object.keys(right.deliveries ?? {})])) {
    deliveries[id] = dominate(left.deliveries?.[id], right.deliveries?.[id]);
  }
  return { ...left, startedAt: earlier(left.startedAt, right.startedAt), deadlineAt: deadline,
    wakeCount, maxHandoffs: wakeCount + remaining, deliveries,
    maxDailyHandoffs: Math.min(left.maxDailyHandoffs ?? 200, right.maxDailyHandoffs ?? 200),
    day: !left.day && !right.day ? undefined : left.day?.date === right.day?.date
      ? { ...left.day, count: Math.max(left.day?.count ?? 0, right.day?.count ?? 0),
        ...(left.day?.noticeAt || right.day?.noticeAt ? { noticeAt: earlier(left.day?.noticeAt, right.day?.noticeAt) } : {}) }
      : String(left.day?.date ?? '') >= String(right.day?.date ?? '') ? left.day : right.day,
    enabled: left.enabled === true && right.enabled === true, pausedReason: left.pausedReason ?? right.pausedReason,
    unlimited: left.unlimited === true && right.unlimited === true && !deadline, extended: left.extended === true && right.extended === true };
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
    try {
      await handle.http.drain();
      await closeServiceSync(handle.runtime);
    } finally {
      await closeHttp();
    }
  };
}

async function openServiceSync(options, paths, { migrate = true } = {}) {
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
    bus: options.bus ?? null,
    env: options.env ?? process.env,
    clientOptions: Array.isArray(options.clients) ? options.clients : null,
    startedAt: new Date(options.startedAt ?? now()).toISOString(),
  };
  runtime.settingsOwner = createSettingsOwner({ ...options, paths, now, sync, pulse, ledger, bus: runtime.bus, startedAt: runtime.startedAt });
  runtime.lockWatch = watchHeldLocks(options.store, paths.localDirectory);
  await recoverTransactions(options.store, { beforeRecover: () => refreshClusterProjects(runtime.settingsOwner) });
  await refreshAdditionProjects(runtime.settingsOwner);
  if (migrate) await migrateClusters(runtime.settingsOwner);
  await refreshClusterProjects(runtime.settingsOwner);
  try {
    try {
      await recoverIncomingGroups(sync);
    } catch (error) {
      runtime.lastError = error;
      runtime.bus?.emit({ name: 'issue.changed', data: { issue: 'incoming_recovery_failed', code: error?.code ?? 'sync_failed' } });
    }
    // A service that answers first (deferSync) starts its first pass over the files, the publication of what is staged and the
    // settings report when the first view has been served, instead of before it listens: on a large M1ND those took the
    // start from seconds to tens of seconds. startSync is that start, and it runs once.
    const defer = options.deferSync === true;
    runtime.unwatchProject = await watchLocalChanges(runtime, changes => emitObserved(runtime, changes), { deferBaseline: defer });
    runtime.syncStarted = false;
    runtime.startSync = () => {
      runtime.syncStart ??= (async () => {
        try {
          if (runtime.closed) return;
          await runtime.unwatchProject?.baseline?.();
          if (runtime.closed) return;
          await pulse.resume();
          await publishMachineSettings(runtime.settingsOwner);
        } catch (error) {
          if (!defer) throw error;
          runtime.lastError = error;
          runtime.bus?.emit({ name: 'issue.changed', data: { issue: 'sync_start_failed', code: error?.code ?? 'sync_failed' } });
        }
        runtime.syncStarted = true;
        if (runtime.originWaiting && !runtime.closed) {
          runtime.originWaiting = false;
          reconcileOrigin(runtime).catch((error) => { runtime.lastError = error; });
        }
      })();
      return runtime.syncStart;
    };
    if (!defer) await runtime.startSync();
    runtime.unwatch = watchOrigin(origin, () => {
      if (!runtime.syncStarted) {
        runtime.originWaiting = true;
        return;
      }
      reconcileOrigin(runtime).catch((error) => {
        runtime.lastError = error;
      });
    });
    return runtime;
  } catch (error) {
    await closeServiceSync(runtime, { beat: false });
    throw error;
  }
}

async function publishServiceBeat(runtime, state, { settings = true } = {}) {
  if (!runtime.clientRecords) {
    if (runtime.clientOptions) runtime.clientRecords = runtime.clientOptions;
    else {
      try {
        runtime.clientRecords = clientRecords(await probeClients({ env: runtime.env ?? process.env, store: runtime.settingsOwner.store, platform: process.platform }));
      } catch {
        runtime.clientRecords = clientRecords({});
      }
    }
  }
  const record = {
    format: 'hivem1nd-service-v1',
    machine: runtime.paths.machine,
    state,
    version: '3.0.0',
    heartbeatAt: new Date(runtime.now()).toISOString(),
    startedAt: runtime.startedAt,
    clients: runtime.clientRecords,
  };
  const result = await runtime.pulse.beat(record);
  if (result.published) runtime.beat = result.record ?? record;
  runtime.settingsOwner.active = state === 'running';
  if (settings) await publishMachineSettings(runtime.settingsOwner, 'service');
  return runtime.beat;
}

// A lock held for a minute is a service that stopped answering: who took it is written once to the machine's diagnostics,
// so the next stall can be traced instead of guessed.
const HELD_LOCK_MS = 60000;

function watchHeldLocks(store, localDirectory) {
  if (typeof store?.locks?.longHeld !== 'function') return null;
  const logged = new Set();
  const timer = setInterval(() => {
    const held = store.locks.longHeld(HELD_LOCK_MS).filter((entry) => !logged.has(entry.ticket));
    if (!held.length) return;
    for (const entry of held) logged.add(entry.ticket);
    const lines = held.map((entry) => `${new Date().toISOString()} ${entry.key} held since ${new Date(entry.at).toISOString()}\n${entry.stack}\n`).join('\n');
    mkdir(path.join(localDirectory, 'diagnostics'), { recursive: true })
      .then(() => appendFile(path.join(localDirectory, 'diagnostics', 'held-locks.log'), `${lines}\n`)).catch(() => {});
  }, HELD_LOCK_MS / 2);
  timer.unref?.();
  return timer;
}

async function closeServiceSync(runtime, { beat = true } = {}) {
  if (!runtime || runtime.closed) return;
  runtime.closed = true;
  if (runtime.lockWatch) clearInterval(runtime.lockWatch);
  if (runtime.beatTimer) clearInterval(runtime.beatTimer);
  runtime.beatTimer = null;
  if (runtime.unwatch) await runtime.unwatch();
  runtime.unwatch = null;
  if (runtime.unwatchProject) await runtime.unwatchProject();
  runtime.unwatchProject = null;
  if (runtime.reconciling) await runtime.reconciling.catch(() => {});
  if (beat) {
    try {
      await publishServiceBeat(runtime, 'stopped');
    } catch {
      // A failed final beat must not leave the watcher or the pulse open.
    }
  }
  await runtime.pulse.close().done;
  await closeOrigin(runtime.origin);
}

async function reconcileOrigin(runtime) {
  if (runtime.closed) return;
  noteProjectionChange(runtime.sync.store);
  runtime.reconcileAgain = true;
  if (runtime.reconciling) return runtime.reconciling;
  runtime.reconciling = (async () => {
    do {
      runtime.reconcileAgain = false;
      await reconcileIncoming(runtime);
    } while (runtime.reconcileAgain && !runtime.closed);
  })().finally(() => { runtime.reconciling = null; });
  return runtime.reconciling;
}

async function reconcileIncoming(runtime) {
  try {
    await receiveOrigin(runtime);
    const previous = await readInboundFailure(runtime.sync);
    await clearInboundFailure(runtime.sync);
    if (previous) await publishSyncState(runtime);
  } catch (error) {
    runtime.lastError = error;
    await recordInboundFailure(runtime.sync, error);
    await publishSyncState(runtime);
    throw error;
  }
}

async function publishSyncState(runtime) {
  if (!runtime?.bus) return;
  const snapshot = await readSync({
    sync: runtime.sync,
    ledger: runtime.ledger,
    paths: runtime.paths,
    now: runtime.now,
  });
  publishDomainEvents({
    bus: runtime.bus,
    paths: runtime.paths,
    store: runtime.sync.store,
  }, [{
    name: 'sync.changed',
    operationId: `sync-state:${snapshot.state}:${snapshot.error?.code ?? 'clear'}:${snapshot.retryAt ?? ''}`,
    source: { kind: 'service', id: runtime.paths.machine, unitId: null },
    data: {
      state: snapshot.state,
      pendingChanges: snapshot.pendingChanges,
      limits: snapshot.limits,
      retryAt: snapshot.retryAt,
      error: snapshot.error,
    },
  }]);
}

async function receiveOrigin(runtime) {
  const names = await listMachineNames(runtime.origin);
  const bindings = await ownerBindings(runtime.sync);
  const provider = {
    async readHead(machine) { return readHead(runtime.origin, machine); },
    async readPack(machine, sequence) { return readOriginPack(runtime.origin, machine, sequence); },
  };
  for (const machine of names) {
    if (runtime.closed) return;
    await mirrorBeat(runtime, machine);
    if (machine === runtime.origin.machine) continue;
    const head = await readHead(runtime.origin, machine);
    const sequence = head?.sequence ?? 0;
    for (let index = 1; index <= sequence; index += 1) {
      if (runtime.closed) return;
      const packed = await readOriginPack(runtime.origin, machine, index);
      if (!packed) continue;
      const applied = await applyPack(runtime.sync, packed, {
        provider,
        bindings,
        ledger: runtime.ledger,
        projects: runtime.sync.projects,
      });
      await emitImported(runtime, applied);
    }
  }
  await retryPending(runtime, provider, bindings);
  runtime.processingRemoteSettings = true;
  try { await processSettingsRequests(runtime.settingsOwner); }
  finally { runtime.processingRemoteSettings = false; }
  if (runtime.restartAfterSettings) {
    const restart = runtime.restartAfterSettings;
    runtime.restartAfterSettings = null;
    const settled = runtime.reconciling;
    setImmediate(() => Promise.resolve(settled).then(restart).catch(error => { runtime.lastError = error; }));
  }
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
    if (runtime.closed) return;
    if (!machine.isDirectory() || machine.isSymbolicLink()) continue;
    const names = await readdir(path.join(root, machine.name));
    for (const name of names) {
      if (runtime.closed) return;
      if (!name.endsWith('.json')) continue;
      const sequence = Number(name.slice(0, -'.json'.length));
      if (!Number.isInteger(sequence)) continue;
      const packed = await readOriginPack(runtime.origin, machine.name, sequence);
      if (!packed) continue;
      const applied = await applyPack(runtime.sync, packed, {
        provider,
        bindings,
        ledger: runtime.ledger,
        projects: runtime.sync.projects,
      });
      await applyImportedDecisions(runtime, applied);
      await emitImported(runtime, applied);
    }
  }
}

// An approval answered, or a grant revoked, on another machine or from the phone is queued for the machine that owns
// the agent. The owner applies it when the record arrives by sync and once at start for what arrived while it was off;
// before, nothing applied it, so the agent waited until its request expired and the grant stayed in force.
async function applyQueuedDecisions(context, approvalIds = null, revocations = true) {
  for (const id of approvalIds ?? [null]) {
    try { await consumeAnswers(context, id); } catch { /* A record that cannot be read waits for the next sync or start. */ }
  }
  if (!revocations) return;
  try { await consumeRevocations(context); } catch { /* Same: the request stays queued. */ }
}

async function applyImportedDecisions(runtime, result) {
  if (result?.status !== 'applied' || result.machine === runtime.paths.machine) return;
  const ids = new Set();
  let revocations = false;
  for (const change of result.changes ?? []) {
    const file = slashPath(change.target?.path);
    const answer = /^user\/relay\/approvals\/([^/]+)\/answers\/[^/]+\.json$/.exec(file);
    if (answer && change.operation !== 'delete') ids.add(answer[1]);
    if (file.startsWith(`user/relay/grant-revocations/${runtime.paths.machine}/`) && change.operation !== 'delete') revocations = true;
  }
  if (!ids.size && !revocations) return;
  const context = { store: runtime.sync.store, paths: runtime.paths, now: runtime.now, projects: runtime.sync.projects ?? [], bus: runtime.bus };
  await applyQueuedDecisions(context, ids.size ? [...ids] : [], revocations);
}

async function emitImported(runtime, result) {
  if (!runtime?.bus || result?.status !== 'applied' || result.replayed === true) return;
  if (result.machine === runtime.paths.machine) return;
  return emitChanges(runtime, result);
}

async function emitObserved(runtime, changes) {
  return emitChanges(runtime, { machine: runtime.paths.machine, sequence: changes.map(change => change.id).join(':'), changes }, true);
}

const BULK_EVENT_LIMIT = 200;
const BULK_COLLECTIONS = ['approvals', 'chats', 'clusters', 'editors', 'groups', 'leads', 'machines', 'mailboxes', 'messages', 'plans', 'projects', 'runs', 'sessions', 'squads', 'tasks', 'units', 'waiting'];

async function emitChanges(runtime, result, local = false) {
  if (!runtime?.bus) return;
  const selected = latestImported(result.changes ?? []);
  if (selected.length === 0) return;
  const context = {
    paths: runtime.paths,
    store: runtime.sync.store,
    now: runtime.now,
    projects: runtime.sync.projects ?? [],
    principal: { audience: 'desktop', unitId: 'root:master' },
  };
  const sourceMachine = result.machine ?? selected[0].machine;
  const events = [];
  const collections = new Set();
  const seen = new Map();
  // Each detailed event reads the projection again, so a bulk change such as the first observation of a migrated
  // M1ND announced one view change instead of rebuilding the whole projection once per file for hours.
  const bulk = selected.length > BULK_EVENT_LIMIT;
  if (bulk) for (const name of BULK_COLLECTIONS) collections.add(name);
  // Every change of the batch reads from one view instead of building it once or twice per change.
  context.batch = viewBatch(context);
  for (const change of bulk ? [] : selected) {
    try {
      const built = await eventsForImported(runtime, context, change);
      for (const event of built.events) {
        const data = event.data ?? {};
        const identity = event.name === 'message.read' ? `${data.chatId ?? data.mailboxId}:${data.readerId}` : data.thread?.id ?? data.proposal?.id ?? data.asset?.id ?? data.task?.id ?? data.message?.id ?? data.approval?.id ?? data.session?.id ?? data.chat?.id ?? data.noticeKey ?? data.requestId ?? event.resourceId ?? event.unitId ?? data.readerId ?? '';
        const marker = `${event.name}:${identity}`;
        if (seen.has(marker)) {
          if (event.name === 'message.read') seen.get(marker).data.messageIds = [...new Set([...seen.get(marker).data.messageIds, ...data.messageIds])];
          continue;
        }
        seen.set(marker, event);
        events.push({ ...event, operationId: `sync:${sourceMachine}:${result.sequence}:${marker}`, source: local ? { kind: 'service', id: sourceMachine, unitId: null } : event.source ?? syncSource(change) });
      }
      for (const name of built.collections) collections.add(name);
    } catch (error) {
      runtime.lastError = error;
    }
  }
  if (collections.size > 0) {
    events.push({
      name: 'view.changed',
      operationId: `sync-view:${sourceMachine}:${result.sequence}`,
      source: { kind: local ? 'service' : 'sync', id: sourceMachine, unitId: null },
      data: {
        revision: hashBytes(Buffer.from(selected.map((item) => item.id).sort().join('\n'))),
        collections: [...collections].sort(),
      },
    });
  }
  if (events.length === 0) return;
  publishDomainEvents({ bus: runtime.bus, paths: runtime.paths, store: runtime.sync.store }, events);
}

function latestImported(changes) {
  const unique = [];
  const seen = new Set();
  for (const change of changes) {
    if (!change?.id || seen.has(change.id)) continue;
    seen.add(change.id);
    unique.push(change);
  }
  const byTarget = new Map();
  for (const change of unique) byTarget.set(importedTargetKey(change.target), change);
  return [...byTarget.values()];
}

function importedTargetKey(target) {
  const file = slashPath(target?.path);
  if (target?.kind === 'project') return `project\n${target.project ?? ''}\n${file}`;
  return `mind\n${file}`;
}

function slashPath(value) {
  return String(value ?? '').replaceAll('\\', '/');
}

function syncSource(change) {
  return { kind: 'sync', id: change.machine, unitId: null };
}

async function eventsForImported(runtime, context, change) {
  const target = change.target ?? {};
  const file = slashPath(target.path);
  if (!file || file.includes('.conflict-')) return { events: [], collections: [] };
  const sidecar = await importedSidecarEvents(context, change);
  if (sidecar) return sidecar;
  if (target.kind === 'project') return editorImport(runtime, change, target, file);
  return mindImport(runtime, context, change, file);
}

async function mindImport(runtime, context, change, file) {
  const source = syncSource(change);
  const message = /^user\/relay\/chats\/([^/]+)\/(?:notices\/)?([^/]+)\.md$/.exec(file);
  if (message && message[2] !== 'chat') {
    if (change.operation === 'delete') return { events: [], collections: ['chats'] };
    const chatId = message[1];
    const bytes = await bytesAt(runtime.paths.mind, file);
    const projected = await detailOf(context, 'messages', headerValue(bytes, 'id') || message[2], { chatId });
    const events = [{
      name: 'message.created',
      operationId: change.id,
      chatId,
      source,
      data: { chatId, mailboxId: null, message: projected },
    }];
    try {
      const chat = await chatOf(context, chatId);
      events.push({ name: 'chat.changed', operationId: change.id, chatId, source, data: { chat } });
    } catch (error) {
      if (error?.code !== 'chat_not_found') throw error;
    }
    return { events, collections: ['chats'] };
  }
  const chatMeta = /^user\/relay\/chats\/([^/]+)\/chat\.md$/.exec(file);
  if (chatMeta) {
    if (change.operation === 'delete') return { events: [], collections: ['chats'] };
    const chat = await chatOf(context, chatMeta[1]);
    return {
      events: [{ name: 'chat.changed', operationId: change.id, chatId: chat.id, source, data: { chat } }],
      collections: ['chats'],
    };
  }
  const fallbackUnit = stateUnitId(file);
  if (!fallbackUnit) return { events: [], collections: [] };
  if (change.operation === 'delete') return { events: [], collections: ['units', 'leads', 'squads'] };
  const bytes = await bytesAt(runtime.paths.mind, file);
  const unit = await detailOf(context, 'units', headerValue(bytes, 'unit-id') || fallbackUnit);
  return {
    events: [{ name: 'unit.changed', operationId: change.id, unitId: unit.id, source, data: { unit } }],
    collections: ['units', 'leads', 'squads', 'waiting'],
  };
}

function detailOf(context, name, id, scope) {
  return context.batch ? context.batch.detail(name, id, scope) : readDetail(context, name, id, scope);
}

function chatOf(context, id) {
  return context.batch ? context.batch.chat(id) : projectChat(context, id);
}

function stateUnitId(file) {
  const parts = file.split('/');
  if (parts[0] !== 'user' || !file.endsWith('.md')) return null;
  if (parts[1] === 'state' && parts.length === 3) return `root:${path.basename(parts[2], '.md').toLowerCase()}`;
  if (parts[1] === 'envs' && parts[3] === 'state' && parts.length === 5) return `env:${parts[2]}:${path.basename(parts[4], '.md').toLowerCase()}`;
  if (parts[1] === 'projects' && parts[3] === 'state' && parts.length === 5) return `project:${parts[2]}:${path.basename(parts[4], '.md').toLowerCase()}`;
  return null;
}

function headerValue(bytes, name) {
  const text = bytes.toString('utf8');
  const split = text.search(/\r?\n\r?\n/);
  const head = split >= 0 ? text.slice(0, split) : text;
  for (const line of head.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    if (line.slice(0, colon).trim().toLowerCase() === name) return line.slice(colon + 1).trim();
  }
  return '';
}

async function editorImport(runtime, change, target, file) {
  const kind = editorKind(file);
  if (!kind) return { events: [], collections: [] };
  if (change.operation === 'delete') return { events: [], collections: ['editors'] };
  const project = (runtime.sync.projects ?? []).find((item) => item.name === target.project && item.localPath);
  if (!project) return { events: [], collections: [] };
  const bytes = await bytesAt(project.localPath, file);
  const revision = hashBytes(bytes);
  const resourceId = await catalogResourceId(runtime, target.project, file, kind);
  const source = syncSource(change);
  if (kind === 'blueprint') {
    return {
      events: [{
        name: 'blueprint.changed',
        operationId: change.id,
        resourceId,
        revision,
        source,
        data: { resourceId, revision, operation: 'import', nodeId: null },
      }],
      collections: ['editors'],
    };
  }
  let rev = null;
  try {
    rev = JSON.parse(bytes.toString('utf8'))?.rev ?? null;
  } catch {
    rev = null;
  }
  return {
    events: [{
      name: 'void.changed',
      operationId: change.id,
      resourceId,
      revision,
      source,
      data: { resourceId, revision, rev, operation: 'import', k: null, lang: null },
    }],
    collections: ['editors'],
  };
}

function editorKind(file) {
  if (!file.startsWith('docs/')) return null;
  const rest = file.slice('docs/'.length);
  if (rest.endsWith('.orig.json') || rest.endsWith('.comments.json') || rest.endsWith('.versions.jsonl')) return null;
  if (rest === 'flows/boards/index.json' || rest.startsWith('flows/assets/') || rest.startsWith('flows/comments/')) return null;
  if (rest.startsWith('flows/boards/') && (rest.endsWith('.json') || rest.endsWith('.mjs'))) return 'blueprint';
  if (rest.endsWith('.json') || rest.endsWith('.mjs')) return 'void';
  return null;
}

async function catalogResourceId(runtime, project, file, kind) {
  try {
    const catalog = JSON.parse(await readFile(path.join(runtime.paths.mind, 'user', 'gui', 'resources.json'), 'utf8'));
    const entry = (catalog?.resources ?? []).find((item) => item?.project === project && item?.path === file && typeof item.id === 'string');
    if (entry) return entry.id;
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  return uuidV8(['editor', kind, project, file]);
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
  if (!options?.paths?.mind || !options?.store) throw new CoreError(503, 'service_unavailable', 'The service needs a configured M1ND.');
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
  const shutdown = await readFile(shutdownPath(handle.options)).catch(() => null);
  if (shutdown && handle.shutdownBytes?.equals(shutdown)) await unlink(shutdownPath(handle.options)).catch(() => {});
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
  if (!options.mindPath) throw new CoreError(503, 'mind_not_configured', 'The M1ND has no service configuration.');
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
    if (error?.code === 'ENOENT') throw new CoreError(503, 'mind_not_configured', 'The M1ND has no service configuration.');
    throw error;
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const file = path.join(root, entry.name, 'config.json');
    await assertNoLinks(file);
    let parsed;
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw new CoreError(422, 'invalid_body', 'The service configuration is not valid.');
    }
    found.push({ machine: entry.name, file, parsed });
  }
  if (found.length === 0) throw new CoreError(503, 'mind_not_configured', 'The M1ND has no service configuration.');
  const wanted = options.hostname ?? options.machine ?? null;
  const chosen = wanted ? found.find((item) => item.machine === wanted || item.parsed?.machine === wanted) : found.length === 1 ? found[0] : null;
  if (!chosen) throw new CoreError(409, 'service_mind_conflict', 'The configured machine does not match.');
  if (chosen.parsed?.format !== 'hivem1nd-service-config-v1') throw new CoreError(422, 'invalid_body', 'The service configuration is not valid.');
  const config = bootstrapConfig(chosen.parsed);
  if (path.resolve(config.mindPath) !== mindPath || config.machine !== chosen.machine) {
    throw new CoreError(422, 'invalid_body', 'The configured M1ND does not match.');
  }
  await verifyBootstrapFiles(path.dirname(chosen.file), chosen.file, options);
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
  // The running service keeps its last build of the M1ND; the file watchers and the store's own writes throw it away.
  if (options.projectionCache !== false) store.projectionCache = createProjectionCache();
  bindProjects(store, options.projects ?? []);
  return store;
}

async function startWakeController(options, nonce) {
  const wake = await createRelayWakeController({
    mindPath: options.paths.mind,
    hostname: options.paths.machine,
    pollIntervalMs: 1000,
    clock: {
      now: () => options.now?.() ?? Date.now(),
      sleep(ms, signal) {
        return new Promise((resolve) => {
          const timer = setTimeout(resolve, ms);
          timer.unref?.();
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        });
      },
    },
    sink: options.wakeSink ?? ((input) => verifiedDelivery(options, { adapters: options.adapters, ownedPids: options.ownedPids }, input?.binding, input)),
  });
  let closed = false;
  let restartTimer = null;
  return {
    started: true,
    nonce: nonce ?? null,
    wake,
    // A worker that ended because of a problem that lasted, such as a record OneDrive kept busy, leaves its consent enabled with
    // nobody serving it; every so often the service starts it again. One whose consent ended meanwhile ends again at once, and a
    // worker that was stopped on purpose is not started.
    restartEnded(everyMs, alsoDo = null) {
      if (restartTimer || closed) return;
      restartTimer = setInterval(() => {
        if (closed) return;
        for (const binding of wake.lapsedWorkers()) {
          try { wake.start(binding); } catch { /* a binding that cannot be normalized does not become a worker */ }
        }
        Promise.resolve(alsoDo?.()).catch(() => {});
      }, everyMs);
      restartTimer.unref?.();
    },
    close() {
      if (closed) return null;
      closed = true;
      clearInterval(restartTimer);
      return wake.stopAll('stopped');
    },
  };
}

export function openNativeAdapters(env = process.env, hooks = {}) {
  // Production supplies the owned process handle itself: plans and supervised launches stop without it.
  const shared = { live: true, env, spawn: hooks.spawn, platform: hooks.platform, timeoutMs: hooks.timeoutMs, createNativeLaunch: hooks.createNativeLaunch, onNativeRegistered: hooks.onNativeRegistered,
    ownProcess: hooks.ownProcess ?? ownChildProcess };
  const adapters = {
    claude: createNativeAdapter('claude', shared),
    codex: createNativeAdapter('codex', shared),
    cursor: createNativeAdapter('cursor', shared),
    lyra: createNativeAdapter('lyra', { env: hooks.store?.confineRoot ? { ...env, LYRA_HOME: path.join(hooks.store.confineRoot, 'lyra') } : env,
      store: hooks.store, ...hooks.lyra }),
  };
  return {
    adapters,
    async close() {
      await Promise.all(Object.values(adapters).map((adapter) => adapter.close()));
    },
  };
}

async function armServiceBeat(runtime, { settings = true } = {}) {
  if (!runtime || runtime.closed || runtime.beatTimer) return runtime?.beat ?? null;
  runtime.beat = await publishServiceBeat(runtime, 'running', { settings });
  runtime.beatTimer = setInterval(() => {
    publishServiceBeat(runtime, 'running').catch((error) => {
      runtime.lastError = error;
    });
  }, 60000);
  runtime.beatTimer.unref?.();
  return runtime.beat;
}

async function closeOwned(handle, { beat = true } = {}) {
  if (handle.syncTimer) clearTimeout(handle.syncTimer);
  handle.http?.stopAdmission();
  let runContext;
  if (handle.options?.store) {
    runContext = { ...handle.options, paths: servicePathsFor(handle.options), now: handle.options.now ?? (() => Date.now()) };
    await closeRunSupervisor(runContext);
  }
  await handle.adopted?.controller?.close?.();
  if (handle.adapters?.close) await handle.adapters.close().catch(() => {});
  await handle.http?.drainRequests();
  if (runContext) { await drainRunLaunches(runContext); await closeRunProcesses(runContext); }
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

function shutdownPath(options) {
  return path.join(options.paths.localDirectory, 'shutdown.json');
}

function activePath(options) {
  return options.paths.activeFile ?? path.join(path.dirname(path.dirname(options.paths.localDirectory)), 'active.json');
}
