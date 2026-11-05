import { readFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, canonicalJson, hashBytes, validateMachineName } from '../service/identity.mjs';
import { createStore, readBytes } from '../service/store.mjs';
import { applyPack, recoverIncomingGroups } from './apply.mjs';
import { limitsFor, openLedger } from './limits.mjs';
import { callbackOrigin, writeDurable } from './origin.mjs';
import { claimDirectory } from './ownership.mjs';
import { decodeSyncEnvelope, encodeSyncEnvelope, validateHead } from './pack.mjs';
import { createPulse } from './pulse.mjs';
import { listCommittedGroups, listStaged, stageCommittedGroup } from './store.mjs';

export const SYNC_API_VERSION = 1;

const owners = new Set();
const publicErrors = new WeakSet();
const permanent = new Set(['invalid_body', 'invalid_json', 'invalid_pack', 'invalid_name', 'invalid_record_owner',
  'invalid_schema', 'invalid_ack', 'corrupt_resource', 'revision_conflict', 'resource_too_large', 'pack_too_large',
  'message_too_large', 'ineligible_data', 'unsafe_path']);
const transient = new Set(['sync_failed', 'deadline_exceeded', 'aborted', 'head_pending', 'sync_rate_limited',
  'message_rate_limited', 'offline', 'closed', 'store_in_use', 'authentication_failed', 'encryption_key_missing', 'invalid_encryption_key']);
const operations = new Set(['create', 'validate', 'serialize', 'applyAtomic', 'encode', 'decode', 'stage', 'flush',
  'listCommitted', 'ackStaged', 'reconcile', 'listMachines', 'readHead', 'readPack', 'publishPack', 'watch', 'unwatch', 'close', 'changed', 'resume', 'status']);

export async function createSyncCoordinator({ store, domain, codec, origin, limits = {}, clock = {}, events } = {}) {
  if (!limits || typeof limits !== 'object' || !clock || typeof clock !== 'object') {
    throw publicError({ code: 'invalid_body', retryable: false, operation: 'create', machine: null, sequence: null });
  }
  const now = clock.now ?? Date.now;
  const setTimer = clock.setTimeout ?? globalThis.setTimeout;
  const clearTimer = clock.clearTimeout ?? globalThis.clearTimeout;
  const timeout = limits.operationTimeoutMs ?? 10000;
  const retryDelayMs = limits.retryDelayMs ?? 2000;
  let machine;
  try {
    machine = validateMachineName(store?.machine);
    if (typeof store.namespace !== 'string' || !store.namespace || store.namespace.length > 256
      || /[\r\n\u0000]/.test(store.namespace) || !path.isAbsolute(store.localDirectory)) throw new Error();
    for (const [owner, methods] of [[store.outbox, ['listCommitted', 'ackStaged']], [domain, ['validate', 'serialize', 'applyAtomic']],
      [codec, ['encode', 'decode']], [origin, ['publishPack', 'readHead', 'readPack', 'listMachines', 'reconcile', 'close', 'watch']]]) {
      if (methods.some((name) => typeof owner?.[name] !== 'function')) throw new Error();
    }
    if (typeof codec.format !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(codec.format)
      || !Number.isSafeInteger(codec.version) || codec.version < 1
      || typeof codec.encryption !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(codec.encryption)) throw new Error();
    if (typeof now !== 'function' || typeof setTimer !== 'function' || typeof clearTimer !== 'function'
      || !Number.isFinite(now())
      || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120000
      || !Number.isSafeInteger(retryDelayMs) || retryDelayMs < 1 || retryDelayMs > 120000) throw new Error();
    for (const [name, value] of Object.entries({ messages: 60, messageBytes: 1000000, syncBytes: 50000000 })) {
      if (limits[name] !== undefined && limits[name] !== value) throw new Error();
    }
  } catch {
    throw publicError({ code: 'invalid_body', retryable: false, operation: 'create', machine: null, sequence: null });
  }
  const namespace = store.namespace;
  const directory = path.join(path.resolve(store.localDirectory), 'sync-v1', hashBytes(Buffer.from(namespace)), machine);
  const ownerKey = process.platform === 'win32' ? directory.toLowerCase() : directory;
  if (owners.has(ownerKey)) throw publicError({ code: 'store_in_use', retryable: true, operation: 'create', machine, sequence: null });
  owners.add(ownerKey);
  let release;
  try {
    release = await claimDirectory(directory);
  } catch (error) {
    owners.delete(ownerKey);
    throw publicError(shape(error, 'create', machine));
  }
  let closed = false;
  let closePromise = null;
  let watcher = null;
  let lastError = null;
  let queue = Promise.resolve();
  let flushing = null;
  const reported = new WeakSet();
  const cancellation = new AbortController();
  const emit = (event) => {
    if (closed) return;
    try { if (typeof events === 'function') events(event); else events?.push(event); } catch { /* Notifications cannot own durable progress. */ }
  };
  const report = (error, operation, owner = machine, sequence = null) => {
    if (error && typeof error === 'object' && reported.has(error)) return error;
    lastError = shape(error, operation, owner, sequence);
    emit({ type: 'sync.error', ...lastError });
    const safe = publicError(lastError);
    reported.add(safe);
    return safe;
  };
  async function bounded(operation, run, owner = machine, sequence = null, allowClosed = false) {
    const controller = new AbortController();
    let timer;
    let rejectStop;
    const stopped = new Promise((_resolve, reject) => { rejectStop = reject; });
    const stop = (code) => {
      controller.abort();
      rejectStop(publicError({ code, retryable: true, operation, machine: owner, sequence }));
    };
    const abort = () => stop('aborted');
    if (!allowClosed) cancellation.signal.addEventListener('abort', abort, { once: true });
    try {
      if (closed && !allowClosed) throw publicError({ code: 'closed', retryable: true, operation, machine: owner, sequence });
      timer = setTimer(() => stop('deadline_exceeded'), timeout);
      return await Promise.race([Promise.resolve().then(() => run(controller.signal)), stopped]);
    } catch (error) {
      throw report(error, operation, owner, sequence);
    } finally {
      if (timer !== undefined) clearTimer(timer);
      cancellation.signal.removeEventListener('abort', abort);
    }
  }
  const invoke = (operation, args, owner = machine, sequence = null) => bounded(operation,
    (signal) => origin[operation](...args, { signal }), owner, sequence);
  const sink = { push(event) {
    if (event.type === 'sync.error') report({ code: event.code }, 'flush');
    else emit(event);
  } };
  const localStore = createStore({ root: directory, mindPath: directory, localDirectory: directory, confineRoot: directory,
    now, events: sink, autoRecover: false });
  const sync = { store: localStore, paths: { localDirectory: directory }, machine, namespace, now,
    domain: {
      validate: (entry) => bounded('validate', () => domain.validate(entry)),
      serialize: (entry) => bounded('serialize', () => domain.serialize(entry)),
      applyAtomic: (group, context) => bounded('applyAtomic', () => domain.applyAtomic(group, context), context.machine, context.sequence),
    } };
  const safeCodec = {
    get format() { return codec.format; },
    get version() { return codec.version; },
    get encryption() { return codec.encryption; },
    encode: (pack) => bounded('encode', () => codec.encode(pack)),
    decode: (bytes, context) => bounded('decode', () => codec.decode(bytes), context.machine, context.sequence),
  };
  const transport = callbackOrigin({ sync, invoke, report,
    encode: (pack) => encodeSyncEnvelope(pack, { codec: safeCodec, namespace }),
    decode: (bytes) => decodeSyncEnvelope(bytes, { codec: safeCodec, namespace }) });
  const ledger = openLedger({ store: localStore, paths: sync.paths, machine, now });
  const pulse = createPulse({ sync, origin: transport, ledger, now, setTimeout: setTimer, clearTimeout: clearTimer, events: sink, retryDelayMs });
  const readJson = async (file) => {
    const bytes = await readBytes(localStore, file);
    return bytes ? JSON.parse(bytes) : null;
  };
  const writeJson = (file, record) => writeDurable(localStore, file, Buffer.from(`${canonicalJson(record)}\n`), [directory]);
  const quarantinePath = (key) => path.join(directory, 'quarantine', `${hashBytes(Buffer.from(key))}.json`);
  const quarantined = (key) => readJson(quarantinePath(key));
  async function quarantine(key, error, operation, owner = machine, sequence = null) {
    const safe = shape(error, operation, owner, sequence);
    const previous = await quarantined(key);
    await writeJson(quarantinePath(key), safe);
    if (canonicalJson(previous) !== canonicalJson(safe)) report(error, operation, owner, sequence);
  }
  const clearQuarantine = (key) => unlink(quarantinePath(key)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  transport.quarantine = async (error, ids) => {
    const file = path.join(directory, 'outgoing', 'publication.json');
    const journal = await readJson(file);
    for (const group of await listCommittedGroups(sync)) {
      if (group.changeIds.some((id) => ids.includes(id))) await quarantine(`group:${group.id}`, error, 'flush');
    }
    if (journal?.phase === 'prepared' && journal.ids?.some((id) => ids.includes(id))) {
      await writeJson(file, { ...journal, phase: 'quarantined' });
    }
  };
  transport.quarantineInput = (error, input) => quarantine(`dependency:${input.machine}:${input.sequence}:${input.digest}`,
    error, 'decode', input.machine, input.sequence);
  transport.clearQuarantineInput = (input) => clearQuarantine(`dependency:${input.machine}:${input.sequence}:${input.digest}`);
  transport.reportFailure = (error) => report(error, 'flush');
  function serial(run, operation = 'reconcile') {
    const pending = queue.catch(() => {}).then(() => closed ? { closed: true } : run()).catch((error) => { throw report(error, operation); });
    queue = pending;
    return pending;
  }
  async function drain() {
    const groups = await bounded('listCommitted', () => store.outbox.listCommitted());
    if (!Array.isArray(groups)) throw report({ code: 'invalid_body' }, 'listCommitted');
    for (const group of groups) {
      const key = `outbox:${group?.transactionId}`;
      if (await quarantined(key)) continue;
      let changes;
      try {
        changes = await stageCommittedGroup(sync, group);
      } catch (error) {
        const safe = shape(error, 'stage', machine);
        if (safe.retryable) throw report(error, 'stage');
        await quarantine(key, error, 'stage');
        continue;
      }
      await pulse.changed((await listStaged(sync)).map((change) => change.id));
      await bounded('ackStaged', () => store.outbox.ackStaged(group.transactionId, changes.map((change) => change.id)));
    }
    return pulse.resume();
  }
  async function pendingIncoming(owner, sequence, code) {
    await writeJson(path.join(directory, 'received', 'pending', owner, `${sequence ?? 0}.json`), { machine: owner, sequence, code });
  }
  async function reconcile(retryQuarantined = false) {
    await invoke('reconcile', []);
    const machines = await transport.listMachines();
    if (!Array.isArray(machines) || machines.length > 10000) throw report({ code: 'invalid_pack' }, 'listMachines');
    for (const name of new Set(machines)) {
      let owner;
      try { owner = validateMachineName(name); } catch { report({ code: 'invalid_name' }, 'listMachines', null); continue; }
      if (owner === machine) continue;
      let sequence = null;
      let key = `head:${owner}:invalid`;
      try {
        const remote = await invoke('readHead', [owner], owner);
        if (remote === null) { await pendingIncoming(owner, null, 'head_missing'); continue; }
        key = `head:${owner}:${hashBytes(Buffer.from(canonicalJson(Buffer.isBuffer(remote) ? remote.toString('base64') : remote)))}`;
        if (!retryQuarantined && await quarantined(key)) continue;
        const previous = await readJson(path.join(directory, 'received', owner, 'head.json'));
        const head = validateHead(remote, { machine: owner, previous });
        await clearQuarantine(key);
        await transport.clearQuarantineInput({ machine: owner, sequence: null, digest: 'head' });
        const complete = previous && await readJson(path.join(directory, 'received', owner, `${previous.sequence}.applied.json`));
        let next = previous ? previous.sequence + (complete ? 1 : 0) : 1;
        for (const pack of head.packs.filter((item) => item.sequence >= next)) {
          sequence = pack.sequence;
          if (sequence !== next) { await pendingIncoming(owner, next, 'sequence_incomplete'); break; }
          const bytes = await transport.readPack(owner, sequence);
          if (bytes === null) { await pendingIncoming(owner, sequence, 'pack_missing'); break; }
          if (!(bytes instanceof Uint8Array)) throw new CoreError(422, 'invalid_pack', 'The pack is not bytes.');
          const digest = hashBytes(bytes);
          key = `pack:${owner}:${sequence}:${pack.hash}:${digest}`;
          if (!retryQuarantined && await quarantined(key)) break;
          if (digest !== pack.hash || bytes.length !== pack.bytes) throw new CoreError(422, 'corrupt_resource', 'The pack digest does not match.');
          const result = await applyPack(sync, Buffer.from(bytes), { provider: transport, ledger, expectedMachine: owner, expectedSequence: sequence, retryQuarantined });
          if (result.status === 'pending') { await pendingIncoming(owner, sequence, result.code ?? 'dependency_missing'); break; }
          await clearQuarantine(key);
          await transport.clearQuarantineInput({ machine: owner, sequence, digest });
          await unlink(path.join(directory, 'received', 'pending', owner, `${sequence}.json`)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
          next += 1;
        }
        await unlink(path.join(directory, 'received', 'pending', owner, '0.json')).catch((error) => { if (error.code !== 'ENOENT') throw error; });
      } catch (error) {
        const safe = shape(error, 'reconcile', owner, sequence);
        if (!safe.retryable && key) {
          await quarantine(key, error, 'reconcile', owner, sequence);
          await unlink(path.join(directory, 'received', 'pending', owner, `${sequence ?? 0}.json`)).catch((failure) => { if (failure.code !== 'ENOENT') throw failure; });
        }
        else { report(error, 'reconcile', owner, sequence); await pendingIncoming(owner, sequence, safe.code); }
      }
    }
  }
  function changed(_ids = []) {
    return serial(drain, 'changed');
  }
  function flush() {
    if (flushing) return flushing;
    flushing = serial(async () => {
      const before = new Set((await listCommittedGroups(sync)).filter((group) => group.phase === 'published').map((group) => group.id));
      await drain();
      const result = await pulse.flush();
      const groups = await listCommittedGroups(sync);
      const published = groups.filter((group) => group.phase === 'published' && !before.has(group.id));
      const pending = [];
      for (const group of groups) if (group.phase === 'staged' && !await quarantined(`group:${group.id}`)) pending.push(group.id);
      return { ...result, published: result.published || published.length > 0,
        ids: [...new Set([...(result.ids ?? []), ...published.flatMap((group) => group.changeIds)])],
        pending: pending.length, publicationBlocked: await transport.publicationBlocked() };
    }, 'flush').finally(() => { flushing = null; });
    return flushing;
  }
  function resume() {
    return serial(async () => {
      if (!watcher) {
        try {
          watcher = origin.watch(() => { serial(reconcile).catch((error) => report(error, 'reconcile')); },
            (error) => { report(error, 'watch'); serial(reconcile).catch((failure) => report(failure, 'reconcile')); });
          if (typeof watcher !== 'function') throw new CoreError(422, 'invalid_body', 'A watcher must return an unsubscribe function.');
        } catch (error) { throw report(error, 'watch'); }
      }
      await recoverIncomingGroups(sync);
      await drain();
      await reconcile(true);
      return status();
    }, 'resume');
  }
  function status() {
    return readStatus().catch((error) => { throw report(error, 'status'); });
  }
  async function readStatus() {
    const committed = await bounded('listCommitted', () => store.outbox.listCommitted(), machine, null, closed);
    const manifests = await listCommittedGroups(sync);
    const groups = new Map();
    for (const group of committed) groups.set(group.transactionId, { transactionId: group.transactionId,
      changeIds: group.entries.map((entry) => entry.id), state: await quarantined(`outbox:${group.transactionId}`) ? 'quarantined' : 'durable-local' });
    for (const group of manifests) groups.set(group.id, { transactionId: group.id, changeIds: group.changeIds,
      state: await quarantined(`group:${group.id}`) ? 'quarantined' : group.phase === 'published'
        ? group.ackScope === 'provider-confirmed' ? 'provider-confirmed' : 'published-to-origin' : 'pending' });
    const counts = (state) => [...groups.values()].filter((group) => group.state === state).length;
    const pending = counts('durable-local') + counts('pending');
    const incomingPending = await recordsBelow(path.join(directory, 'received', 'pending'));
    return { apiVersion: SYNC_API_VERSION, machine, namespace, closed,
      state: counts('pending') > 0 || incomingPending.length > 0 ? 'pending' : counts('durable-local') > 0 ? 'durable-local' : counts('provider-confirmed') > 0 ? 'provider-confirmed'
        : counts('published-to-origin') > 0 ? 'published-to-origin' : counts('quarantined') > 0 ? 'quarantined' : 'durable-local',
      durableLocal: groups.size, pending, publishedToOrigin: counts('published-to-origin') + counts('provider-confirmed'),
      providerConfirmed: counts('provider-confirmed'), quarantined: (await recordsBelow(path.join(directory, 'quarantine'))).length,
      groups: [...groups.values()], incomingPending, lastError, publicationBlocked: await transport.publicationBlocked(), limits: await limitsFor(ledger) };
  }
  function close() {
    if (closePromise) return closePromise;
    closed = true;
    cancellation.abort();
    const pulseDone = pulse.close().done;
    closePromise = (async () => {
      let failure;
      try {
        try { if (watcher) await bounded('unwatch', () => watcher(), machine, null, true); } catch (error) { failure = error; }
        await Promise.allSettled([queue, flushing, pulseDone]);
        await bounded('close', () => origin.close(), machine, null, true);
      } finally {
        try { await release(); }
        catch (error) { throw report(error, 'close'); }
        finally { owners.delete(ownerKey); }
      }
      if (failure) throw failure;
      return { closed: true };
    })();
    return closePromise;
  }
  return { changed, flush, resume, close, status };
}

function shape(error, operation, machine = null, sequence = null) {
  const code = permanent.has(error?.code) || transient.has(error?.code) ? error.code : 'sync_failed';
  try { machine = machine === null ? null : validateMachineName(machine); } catch { machine = null; }
  if (!Number.isSafeInteger(sequence) || sequence < 1) sequence = null;
  const actualOperation = error && publicErrors.has(error) && operations.has(error.operation) ? error.operation : operation;
  return { code, retryable: typeof error?.retryable === 'boolean' ? error.retryable
    : !(permanent.has(code) || code === 'authentication_failed' && actualOperation === 'decode'),
    operation: actualOperation,
    machine, sequence };
}

function publicError(record) {
  const error = Object.assign(new Error('Synchronization operation failed.'), record);
  publicErrors.add(error);
  return error;
}

async function recordsBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
  const records = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) records.push(...await recordsBelow(file));
    else if (entry.name.endsWith('.json')) records.push(JSON.parse(await readFile(file, 'utf8')));
  }
  return records;
}
