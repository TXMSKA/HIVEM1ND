import path from 'node:path';
import { CoreError, canonicalJson, hashBytes } from '../service/identity.mjs';
import { readBytes } from '../service/store.mjs';
import { chargeMetadata, claimLimitNotice, limitsFor, reservePublication, retryAtFor, SYNC_BYTES_MAX, MESSAGE_MAX } from './limits.mjs';
import { countLogicalMessages, decodePack, encodePack, MAX_AGGREGATE_BYTES, MAX_INDEX_ITEMS, packFileName, resolveDependencies, validateHead } from './pack.mjs';
import { listMachineNames, prepareServiceBeat, publishBeat, publishPack, readHead, readOriginPack, writeDurable } from './origin.mjs';
import { ackPublished, clearSyncFailure, listStaged, readStagedObject, recordSyncFailure } from './store.mjs';

// A pack of a large first publication takes the event loop for a while: after this many milliseconds of work the pulse
// lets the service answer the requests that are waiting before it goes on.
const WORK_SLICE_MS = 20;
const breathe = () => new Promise((resolve) => setImmediate(resolve));

export function nextDue(now, first, last, limits) {
  if (first === null) return null;
  if (limits.state === 'paused') return Date.parse(limits.retryAt);
  const slow = limits.state === 'slowing';
  return Math.max(now, Math.min(last + (slow ? 4000 : 2000), first + (slow ? 30000 : 10000)));
}

export function createPulse({ sync, origin, ledger, now, setTimeout, clearTimeout, events = sync.store.events,
  encryption = { algorithm: 'none' }, keyProvider = origin?.keyProvider, ready = () => true, retryDelayMs = 2000 } = {}) {
  if (!sync || !origin || !ledger || !now || !setTimeout || !clearTimeout) {
    throw new CoreError(500, 'internal_error', 'A pulse needs a sync store, origin, ledger, and clock.');
  }
  let first = null;
  let last = null;
  let pending = [];
  // A published pack never changes, so the hashes it carries and a dependency check that passed are kept by its digest.
  // Decoding every earlier pack again for each publication made a large first publish slower with every pack.
  const packIndex = new Map();
  let timer = null;
  let flushing = null;
  let holdUntil = null;
  // Staged changes the last pack left over although nothing but its own size kept them out: they follow at once.
  let backlog = false;
  let closed = false;
  let scheduleToken = 0;
  let finishedJournal = null;
  let activeIds = [];
  const skipped = new Set();

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  async function arm() {
    const token = ++scheduleToken;
    clearTimer();
    if (closed || !ready() || pending.length === 0 || first === null) return;
    if (await origin.publicationBlocked?.()) return;
    const limits = await currentLimits();
    if (token !== scheduleToken || closed) return;
    const due = backlog && limits.state === 'normal' ? now() : nextDue(now(), first, last, limits);
    if (due === null || !Number.isFinite(due)) return;
    timer = setTimeout(backgroundFlush, Math.max(0, due - now()));
  }

  function reportBackgroundFailure(error) {
    try {
      if (sync.domain) origin.reportFailure?.(error);
      else events.push({ type: 'sync.error', code: error?.code ?? 'internal_error' });
    } catch { /* A notification cannot interrupt recovery. */ }
  }

  function retryTimer(error) {
    reportBackgroundFailure(error);
    if (closed || pending.length === 0) return;
    // Disk failures can prevent arm() from reading the ledger. The same pulse timer retries that read.
    try {
      scheduleToken += 1;
      clearTimer();
      holdUntil = now() + retryDelayMs;
      timer = setTimeout(backgroundFlush, retryDelayMs);
    }
    catch (failure) { reportBackgroundFailure(failure); }
  }

  function backgroundFlush() {
    return Promise.resolve().then(() => flush()).catch(retryTimer);
  }

  function changed(ids = []) {
    const fresh = [...ids].filter((id) => typeof id === 'string' && !skipped.has(id) && !pending.includes(id));
    if (fresh.length === 0) return Promise.resolve({ scheduled: false });
    const time = now();
    if (first === null) first = time;
    last = time;
    pending.push(...fresh);
    if (flushing || closed) return Promise.resolve({ scheduled: !closed, queued: true });
    return arm().then(() => ({ scheduled: true }));
  }

  function flush(recoveryOnly = false) {
    if (flushing) return flushing;
    if (closed && sync.domain) return Promise.resolve({ published: false, pending: pending.length, closed: true });
    const queuedIds = [...pending];
    activeIds = [];
    const attempt = (recoveryOnly ? finishJournal() : run()).catch(async (error) => {
      if (!sync.domain) throw error;
      // Keep the known durable work even if quarantine, listing, or failure-record I/O also fails.
      pending = [...new Set([...pending, ...queuedIds, ...activeIds])].filter((id) => !skipped.has(id));
      if (pending.length > 0 && first === null) first = last = now();
      holdUntil = now() + retryDelayMs;
      if (nonRetryable(error) && activeIds.length > 0) await quarantine(error, activeIds);
      pending = (await listStaged(sync)).map((change) => change.id).filter((id) => !skipped.has(id));
      await failOnce(error);
      return { published: false, packs: 0, error: error.code, ids: [] };
    }).finally(() => {
      flushing = null;
      if (!closed && pending.length > 0) return arm();
      return null;
    });
    flushing = sync.domain ? attempt.catch((error) => {
      retryTimer(error);
      return { published: false, packs: 0, error: error?.code, ids: [] };
    }) : attempt;
    return flushing;
  }

  async function run() {
    activeIds = [];
    scheduleToken += 1;
    clearTimer();
    holdUntil = null;
    backlog = false;
    if (!ready()) return { published: false, packs: 0, ids: [], issues: [], waitingForKey: true };
    if (await origin.publicationBlocked?.()) return { published: false, packs: 0, ids: [], pending: true, quarantined: true };
    await loadSkipped();
    const recovered = await finishJournal();
    const batch = new Set(pending);
    pending = [];
    const staged = (await listStaged(sync)).filter((change) => batch.has(change.id) && !skipped.has(change.id));
    staged.sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id));
    if (staged.length === 0) {
      if (pending.length === 0) { first = null; last = null; }
      return { published: recovered.published, packs: recovered.published ? 1 : 0, ids: recovered.ids, issues: [] };
    }
    // The objects of a group are read when the group is looked at, not all at once: a first publication of a large M1ND
    // stages hundreds of megabytes, of which one pack takes at most 64 MB. A staged object is already compressed on disk
    // in the form a pack carries, so it is kept as it is and never compressed again.
    const objects = new Map();
    const compressed = new Map();
    const wanted = new Set();
    for (const change of staged) if (change.operation === 'put') wanted.add(change.hash);
    let sliceStart = performance.now();
    const load = async (group) => {
      for (const change of group) {
        if (change.operation !== 'put' || objects.has(change.hash)) continue;
        const stored = await readStagedObject(sync, change.hash);
        objects.set(change.hash, stored.raw);
        compressed.set(change.hash, stored.compressed);
      }
      if (performance.now() - sliceStart >= WORK_SLICE_MS) {
        await breathe();
        sliceStart = performance.now();
      }
    };
    const limits = await limitsFor(ledger, 'publication');
    const remainingMessages = MESSAGE_MAX - limits.messages.used;
    const remainingBytes = SYNC_BYTES_MAX - limits.syncBytes.used;
    const head = await machineHead();
    const sequence = await nextPreparedSequence(head);
    const committed = await committedObjects(head, wanted);
    const groups = groupChanges(staged);
    const chosen = [];
    const issues = [];
    let deferredIndex = groups.length;
    // A pack grows by adding each group's own size instead of encoding every larger pack again: the separate packs
    // together are never smaller than the merged one, and re-encoding the chosen objects for every group compressed
    // a large first publication once per group, which held the service for hours.
    let chosenBytes = 0;
    let chosenMessages = 0;
    let chosenChanges = 0;
    let chosenRaw = 0;
    const chosenHashes = new Set();
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      activeIds = group.map((change) => change.id);
      await load(group);
      const count = logical(group, objects);
      let alone;
      try {
        alone = await packFor([group], sequence, head, objects, committed, compressed);
      } catch (error) {
        if (error?.code !== 'pack_too_large') throw error;
        issues.push(group);
        continue;
      }
      if (count > MESSAGE_MAX || alone.bytes > SYNC_BYTES_MAX) {
        issues.push(group);
        continue;
      }
      const fresh = [...new Set(group.filter((change) => change.operation === 'put' && !committed.has(change.hash)
        && !chosenHashes.has(change.hash)).map((change) => change.hash))];
      const raw = fresh.reduce((sum, hash) => sum + (objects.get(hash)?.length ?? 0), 0);
      const bytes = chosen.length > 0 ? chosenBytes + alone.bytes : alone.bytes;
      const messages = chosenMessages + count;
      if (messages > remainingMessages || bytes > remainingBytes || chosenChanges + group.length > MAX_INDEX_ITEMS
        || chosenRaw + raw > MAX_AGGREGATE_BYTES) {
        deferredIndex = index;
        break;
      }
      chosen.push(group);
      chosenBytes = bytes;
      chosenMessages = messages;
      chosenChanges += group.length;
      chosenRaw += raw;
      for (const hash of fresh) chosenHashes.add(hash);
    }
    activeIds = [];
    if (issues.length > 0) {
      const ids = issues.flat().map((change) => change.id);
      if (sync.domain) await quarantine(new CoreError(413, 'pack_too_large', 'A group cannot fit in a publication.'), ids);
      else await rememberIssues(ids);
    }
    const deferred = groups.slice(deferredIndex).filter((group) => !issues.includes(group));
    if (chosen.length === 0) {
      pending = [...deferred.flat().map((change) => change.id), ...pending];
      if (deferred.length > 0) {
        await load(deferred[0]);
        holdUntil = await holdFor(deferred[0], objects, sequence, head, committed, compressed, false);
      }
      if (pending.length === 0) { first = null; last = null; }
      else if (first === null) first = now();
      return { published: recovered.published, packs: recovered.published ? 1 : 0, ids: recovered.ids, issues: issues.flat().map((change) => change.id) };
    }
    activeIds = chosen.flat().map((change) => change.id);
    const packed = await packFor(chosen, sequence, head, objects, committed, compressed);
    try {
      await origin.preparePublication?.(packed.body, { messages: logical(chosen.flat(), objects), bytes: packed.bytes });
      await reservePublication(ledger, {
        id: `publication:${packed.hash}`,
        messages: logical(chosen.flat(), objects),
        bytes: packed.bytes,
      });
      await sendPack(packed.body);
    } catch (error) {
      if (sync.domain && nonRetryable(error)) await quarantine(error, activeIds);
      pending = [...chosen.flat().map((change) => change.id), ...deferred.flat().map((change) => change.id), ...pending].filter((id) => !skipped.has(id));
      // A full window names the moment it frees room: retrying every 2 seconds until then packed the same objects again.
      const named = typeof error?.retryAt === 'string' ? Date.parse(error.retryAt) : NaN;
      holdUntil = Number.isFinite(named) && named > now() ? named : now() + retryDelayMs;
      await failOnce(error);
      return { published: false, packs: 0, error: error.code, ids: [], issues: issues.flat().map((change) => change.id) };
    }
    activeIds = [];
    const ids = chosen.flat().map((change) => change.id);
    await ackPublished(sync, ids);
    finishedJournal = packed.hash;
    await clearSyncFailure(sync);
    if (deferred.length > 0) pending = [...deferred.flat().map((change) => change.id), ...pending];
    if (pending.length === 0) {
      first = null;
      last = null;
    } else if (deferred.length > 0) {
      if (first === null) first = now();
      last = now();
      await load(deferred[0]);
      holdUntil = await holdFor(deferred[0], objects, sequence, head, committed, compressed, true);
      backlog = holdUntil <= now();
    } else {
      first = now();
      last = now();
    }
    return { published: true, packs: 1, ids, issues: issues.flat().map((change) => change.id) };
  }

  async function resume() {
    if (origin.recoverOnResume) await flush(true);
    await loadSkipped();
    const staged = await listStaged(sync);
    const result = await changed(staged.map((change) => change.id));
    await arm();
    return result;
  }

  async function beat(record) {
    const clean = prepareServiceBeat(origin.machine, record);
    const limits = await limitsFor(ledger, 'publication');
    if (limits.state === 'paused') return { published: false, state: limits.state, record: clean };
    try {
      const body = Buffer.from(canonicalJson(clean));
      await chargeMetadata(ledger, {
        machine: origin.machine,
        path: `machines/${origin.machine}/service.json`,
        contentHash: hashBytes(body),
        bytes: body.length,
      });
    } catch (error) {
      if (error?.code === 'sync_rate_limited' || error?.code === 'pack_too_large') return { published: false, state: 'paused', record: clean };
      throw error;
    }
    await sendBeat(clean);
    return { published: true, record: clean };
  }

  function close() {
    closed = true;
    scheduleToken += 1;
    clearTimer();
    const done = Promise.resolve(flushing).catch(() => null);
    return { pending: pending.length, done };
  }

  async function currentLimits() {
    const limits = await limitsFor(ledger, 'publication');
    if (holdUntil !== null && holdUntil > now()) {
      return { state: 'paused', retryAt: new Date(holdUntil).toISOString() };
    }
    return limits;
  }

  async function machineHead() {
    if (typeof origin.readHead === 'function') return origin.readHead(origin.machine);
    return readHead(origin, origin.machine);
  }

  // `objects` is the set of hashes the staged changes carry; only their names are needed here.
  async function committedObjects(head, objects) {
    const committed = new Map();
    if (objects.size === 0) return committed;
    const machines = [origin.machine, ...(await listMachineNames(origin)).filter((machine) => machine !== origin.machine).sort()];
    const provider = {
      keyProvider,
      decodePack: origin.decodePack,
      readHead: (machine) => readHead(origin, machine),
      readPack: (machine, sequence) => readOriginPack(origin, machine, sequence),
    };
    for (const machine of machines) {
      let published;
      try {
        const current = machine === origin.machine ? head : await provider.readHead(machine);
        if (!current) continue;
        published = validateHead(current, { machine });
        await origin.clearQuarantineInput?.({ machine, sequence: null, digest: 'head' });
      } catch (error) {
        if (sync.domain ? nonRetryable(error) : error instanceof CoreError || error?.retryable === false) {
          await origin.quarantineInput?.(error, { machine, sequence: null, digest: 'head' });
          continue;
        }
        throw error;
      }
      for (const entry of [...published.packs].reverse()) {
        const key = `${machine}:${entry.sequence}:${entry.hash}`;
        let known = packIndex.get(key);
        let bytes = null;
        try {
          if (!known) {
            bytes = await provider.readPack(machine, entry.sequence);
            if (!bytes || bytes.length !== entry.bytes) continue;
            if (hashBytes(bytes) !== entry.hash) continue;
            const decoded = await decode(bytes);
            if (decoded.header.machine !== machine) continue;
            if (decoded.header.sequence !== entry.sequence) continue;
            known = { hashes: [...decoded.objects.keys()], ready: false };
            packIndex.set(key, known);
          }
          const hashes = known.hashes.filter((hash) => objects.has(hash) && !committed.has(hash));
          if (hashes.length === 0) continue;
          if (!known.ready) {
            bytes ??= await provider.readPack(machine, entry.sequence);
            if (!bytes || bytes.length !== entry.bytes) continue;
            const resolved = await resolveDependencies(bytes, provider);
            if (resolved.status !== 'ready') continue;
            known.ready = true;
          }
          await origin.clearQuarantineInput?.({ machine, sequence: entry.sequence, digest: entry.hash });
          for (const hash of hashes) committed.set(hash, { hash, machine, sequence: entry.sequence, packHash: entry.hash });
          if (committed.size === objects.size) return committed;
        } catch (error) {
          if (sync.domain ? !nonRetryable(error) : !(error instanceof CoreError) && error?.retryable !== false) throw error;
          await origin.quarantineInput?.(error, { machine, sequence: entry.sequence, digest: entry.hash });
        }
      }
    }
    return committed;
  }

  function sendPack(bytes) {
    if (typeof origin.publishPack === 'function') return origin.publishPack(bytes);
    return publishPack(origin, bytes);
  }

  function sendBeat(record) {
    if (typeof origin.publishBeat === 'function') return origin.publishBeat(record);
    return publishBeat(origin, record);
  }

  async function nextPreparedSequence(head) {
    const journal = await readPublication();
    if (journal?.phase === 'prepared') return journal.sequence;
    return (head?.sequence ?? 0) + 1;
  }

  async function finishJournal() {
    activeIds = [];
    const journal = await readPublication();
    if (!journal?.sequence || !journal.packHash) return { ids: [], published: false };
    if (journal.phase === 'quarantined') return { ids: [], published: false };
    // A committed pack whose changes were acknowledged stays the journal until the next publication: reading and decoding
    // it again before every flush cost a 50 MB pack each time.
    if (journal.phase === 'committed' && finishedJournal === journal.packHash) return { ids: [], published: false };
    if (journal.phase === 'prepared') activeIds = journal.ids ?? [];
    const packed = origin.readJournalPack ? await origin.readJournalPack(journal.sequence) : await readOriginPack(origin, origin.machine, journal.sequence);
    if (!packed || hashBytes(packed) !== journal.packHash) return { ids: [], published: false };
    const decoded = await decode(packed);
    if (journal.phase === 'prepared') activeIds = decoded.changes.map((change) => change.id);
    let published = false;
    if (journal.phase === 'prepared') {
      if (journal.charge) await reservePublication(ledger, { id: `publication:${journal.packHash}`, ...journal.charge });
      await sendPack(packed);
      published = true;
    }
    activeIds = [];
    if (journal.ackScope) sync.ackScope = journal.ackScope;
    const live = new Set((await listStaged(sync)).map((change) => change.id));
    const ids = decoded.changes.map((change) => change.id).filter((id) => live.has(id));
    if (ids.length > 0) await ackPublished(sync, ids);
    pending = pending.filter((id) => !ids.includes(id));
    if (journal.phase === 'committed' || published) finishedJournal = journal.packHash;
    return { ids, published };
  }

  // When the next group may go out. The ledger names the moment its window frees enough room. It names none when the group
  // fits already: the last pack was full by its own limits (64 MB of objects, 10000 changes), not by the quota, so there
  // is nothing to wait for. A flat minute here left a large first publication idle for a minute after every pack.
  async function holdFor(group, objects, sequence, head, committed, compressed, progressed) {
    if (!group) return now() + 60000;
    const count = logical(group, objects);
    let bytes = 1;
    try {
      bytes = (await packFor([group], sequence, head, objects, committed, compressed)).bytes;
    } catch {
      bytes = 1;
    }
    const charges = await outgoingCharges();
    const retry = retryAtFor(now(), charges, { messages: Math.min(count, MESSAGE_MAX), bytes: Math.min(bytes, SYNC_BYTES_MAX) });
    return retry ?? (progressed ? now() : now() + 5000);
  }

  async function readPublication() {
    const bytes = await readBytes(sync.store, path.join(sync.paths.localDirectory, 'outgoing', 'publication.json'));
    if (!bytes) return null;
    return JSON.parse(bytes.toString('utf8'));
  }

  async function outgoingCharges() {
    const bytes = await readBytes(ledger.store, ledger.file);
    if (!bytes) return [];
    const data = JSON.parse(bytes.toString('utf8'));
    return (data.outgoing ?? []).map((entry) => ({
      at: Date.parse(entry.at),
      messages: entry.messages ?? 0,
      bytes: entry.bytes ?? 0,
    }));
  }

  async function loadSkipped() {
    const bytes = await readBytes(sync.store, issuesPath());
    if (!bytes) return;
    const parsed = JSON.parse(bytes.toString('utf8'));
    for (const id of parsed.ids ?? []) skipped.add(id);
  }

  async function rememberIssues(ids) {
    const existing = await readBytes(sync.store, issuesPath());
    const prior = existing ? JSON.parse(existing.toString('utf8')).ids ?? [] : [];
    const record = { format: 'hivem1nd-sync-issues-v1', ids: [...new Set([...prior, ...ids])] };
    await writeDurable(sync.store, issuesPath(), Buffer.from(`${canonicalJson(record)}\n`, 'utf8'), [sync.paths.localDirectory, sync.store.confineRoot]);
    for (const id of ids) skipped.add(id);
    pending = pending.filter((id) => !skipped.has(id));
  }

  function issuesPath() {
    return path.join(sync.paths.localDirectory, 'outgoing', 'issues.json');
  }

  async function failOnce(error) {
    await recordSyncFailure(sync, error);
    if (sync.domain) { origin.reportFailure?.(error); return; }
    const notice = await claimLimitNotice(ledger, 'publication');
    if (notice.created) events.push({ type: 'sync.error', code: error?.code ?? 'internal_error', noticeId: notice.id });
  }

  function packFor(...args) {
    return preparePack(...args, { encryption: typeof encryption === 'function' ? encryption() : encryption, keyProvider, encode: origin.encodePack });
  }

  function decode(bytes) {
    return origin.decodePack ? origin.decodePack(bytes) : decodePack(bytes, { keyProvider });
  }

  function nonRetryable(error) {
    if (typeof error?.retryable === 'boolean') return !error.retryable;
    if (['encryption_key_missing', 'invalid_encryption_key'].includes(error?.code)) return false;
    return error instanceof CoreError && error.status >= 400 && error.status < 500 && error.status !== 429;
  }

  async function quarantine(error, ids) {
    await origin.quarantine?.(error, ids);
    await rememberIssues(ids);
  }

  return { changed, flush, resume, beat, close };
}

async function preparePack(groups, sequence, head, objects, committed, compressed = null, { encryption, keyProvider, encode } = {}) {
  const changes = groups.flat();
  const blobs = objectsFor(changes, objects);
  const plain = encodePack({
    compressed,
    encryption,
    keyProvider,
    machine: changes[0].machine,
    sequence,
    changes,
    objects: blobs.filter(({ hash }) => !committed.has(hash)),
    dependencies: blobs.filter(({ hash }) => committed.has(hash)).map(({ hash }) => committed.get(hash)),
    transactions: transactionsOf(changes),
  });
  const body = encode ? await encode(plain) : plain;
  const nextHead = {
    format: 'hivem1nd-head-v1',
    machine: changes[0].machine,
    sequence,
    updatedAt: head?.updatedAt ?? '2026-10-10T12:00:00.000Z',
    packs: [...(head?.packs ?? []), {
      sequence,
      file: packFileName(sequence),
      hash: hashBytes(body),
      bytes: body.length,
    }],
  };
  return { body, hash: hashBytes(body), bytes: body.length + Buffer.byteLength(`${canonicalJson(nextHead)}\n`) };
}

function objectsFor(changes, objects) {
  const hashes = [];
  for (const change of changes) {
    if (change.operation === 'put' && !hashes.includes(change.hash)) hashes.push(change.hash);
  }
  return hashes.map((hash) => ({ hash, raw: objects.get(hash) }));
}

function transactionsOf(changes) {
  const groups = new Map();
  for (const change of changes) {
    if (!change.transactionId) continue;
    const ids = groups.get(change.transactionId) ?? [];
    ids.push(change.id);
    groups.set(change.transactionId, ids);
  }
  return [...groups].map(([id, changeIds]) => ({ id, changeIds }));
}

function groupChanges(changes) {
  const order = [];
  const groups = new Map();
  for (const change of changes) {
    const key = change.transactionId ?? change.id;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key).push(change);
  }
  return order.map((key) => groups.get(key));
}

function logical(changes, objects) {
  return countLogicalMessages({ changes, objects });
}
