import path from 'node:path';
import { CoreError, canonicalJson, hashBytes } from '../service/identity.mjs';
import { readBytes } from '../service/store.mjs';
import { chargeMetadata, claimLimitNotice, limitsFor, reservePublication, retryAtFor, SYNC_BYTES_MAX, MESSAGE_MAX } from './limits.mjs';
import { countLogicalMessages, decodePack, encodePack, MAX_AGGREGATE_BYTES, MAX_INDEX_ITEMS, packFileName, resolveDependencies, validateHead } from './pack.mjs';
import { listMachineNames, prepareServiceBeat, publishBeat, publishPack, readHead, readOriginPack, writeDurable } from './origin.mjs';
import { ackPublished, clearSyncFailure, listStaged, readObject, recordSyncFailure } from './store.mjs';

export function nextDue(now, first, last, limits) {
  if (first === null) return null;
  if (limits.state === 'paused') return Date.parse(limits.retryAt);
  const slow = limits.state === 'slowing';
  return Math.max(now, Math.min(last + (slow ? 4000 : 2000), first + (slow ? 30000 : 10000)));
}

export function createPulse({ sync, origin, ledger, now, setTimeout, clearTimeout, events = sync.store.events } = {}) {
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
  let closed = false;
  let scheduleToken = 0;
  const skipped = new Set();

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  async function arm() {
    const token = ++scheduleToken;
    clearTimer();
    if (closed || pending.length === 0 || first === null) return;
    const limits = await currentLimits();
    if (token !== scheduleToken || closed) return;
    const due = nextDue(now(), first, last, limits);
    if (due === null || !Number.isFinite(due)) return;
    timer = setTimeout(() => flush(), Math.max(0, due - now()));
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

  function flush() {
    if (flushing) return flushing;
    flushing = run().finally(() => {
      flushing = null;
      if (!closed && pending.length > 0) return arm();
      return null;
    });
    return flushing;
  }

  async function run() {
    scheduleToken += 1;
    clearTimer();
    holdUntil = null;
    await loadSkipped();
    const recovered = await finishJournal();
    const batch = pending;
    pending = [];
    const staged = (await listStaged(sync)).filter((change) => batch.includes(change.id) && !skipped.has(change.id));
    staged.sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id));
    if (staged.length === 0) {
      if (pending.length === 0) { first = null; last = null; }
      return { published: recovered.published, packs: recovered.published ? 1 : 0, ids: recovered.ids, issues: [] };
    }
    const objects = new Map();
    for (const change of staged) {
      if (change.operation === 'put') objects.set(change.hash, await readObject(sync, change.hash));
    }
    const limits = await limitsFor(ledger, 'publication');
    const remainingMessages = MESSAGE_MAX - limits.messages.used;
    const remainingBytes = SYNC_BYTES_MAX - limits.syncBytes.used;
    const head = await machineHead();
    const sequence = await nextPreparedSequence(head);
    const committed = await committedObjects(head, objects);
    const groups = groupChanges(staged);
    const compressed = new Map();
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
      const count = logical(group, objects);
      let alone;
      try {
        alone = packFor([group], sequence, head, objects, committed, compressed);
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
    if (issues.length > 0) await rememberIssues(issues.flat().map((change) => change.id));
    const deferred = groups.slice(deferredIndex).filter((group) => !issues.includes(group));
    if (chosen.length === 0) {
      pending = [...deferred.flat().map((change) => change.id), ...pending];
      if (deferred.length > 0) holdUntil = await holdFor(deferred[0], objects, sequence, head, committed);
      if (pending.length === 0) { first = null; last = null; }
      else if (first === null) first = now();
      return { published: recovered.published, packs: recovered.published ? 1 : 0, ids: recovered.ids, issues: issues.flat().map((change) => change.id) };
    }
    const packed = packFor(chosen, sequence, head, objects, committed, compressed);
    try {
      await reservePublication(ledger, {
        id: `publication:${packed.hash}`,
        messages: logical(chosen.flat(), objects),
        bytes: packed.bytes,
      });
      await sendPack(packed.body);
    } catch (error) {
      pending = [...chosen.flat().map((change) => change.id), ...deferred.flat().map((change) => change.id), ...pending];
      holdUntil = now() + 2000;
      await failOnce(error);
      return { published: false, packs: 0, error: error.code, ids: [], issues: issues.flat().map((change) => change.id) };
    }
    const ids = chosen.flat().map((change) => change.id);
    await ackPublished(sync, ids);
    await clearSyncFailure(sync);
    if (deferred.length > 0) pending = [...deferred.flat().map((change) => change.id), ...pending];
    if (pending.length === 0) {
      first = null;
      last = null;
    } else if (deferred.length > 0) {
      if (first === null) first = now();
      last = now();
      holdUntil = await holdFor(deferred[0], objects, sequence, head, committed);
    } else {
      first = now();
      last = now();
    }
    return { published: true, packs: 1, ids, issues: issues.flat().map((change) => change.id) };
  }

  async function resume() {
    await loadSkipped();
    const staged = await listStaged(sync);
    return changed(staged.map((change) => change.id));
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

  async function committedObjects(head, objects) {
    const committed = new Map();
    if (objects.size === 0) return committed;
    const machines = [origin.machine, ...(await listMachineNames(origin)).filter((machine) => machine !== origin.machine).sort()];
    const provider = {
      readHead: (machine) => readHead(origin, machine),
      readPack: (machine, sequence) => readOriginPack(origin, machine, sequence),
    };
    for (const machine of machines) {
      let published;
      try {
        const current = machine === origin.machine ? head : await provider.readHead(machine);
        if (!current) continue;
        published = validateHead(current, { machine });
      } catch (error) {
        if (error instanceof CoreError) continue;
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
            const decoded = decodePack(bytes, { expectedHash: entry.hash, machine });
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
          for (const hash of hashes) committed.set(hash, { hash, machine, sequence: entry.sequence, packHash: entry.hash });
          if (committed.size === objects.size) return committed;
        } catch (error) {
          if (!(error instanceof CoreError)) throw error;
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
    const journal = await readPublication();
    if (!journal?.sequence || !journal.packHash) return { ids: [], published: false };
    const packed = await readOriginPack(origin, origin.machine, journal.sequence);
    if (!packed || hashBytes(packed) !== journal.packHash) return { ids: [], published: false };
    let published = false;
    if (journal.phase === 'prepared') {
      await sendPack(packed);
      published = true;
    }
    const decoded = decodePack(packed);
    const live = new Set((await listStaged(sync)).map((change) => change.id));
    const ids = decoded.changes.map((change) => change.id).filter((id) => live.has(id));
    if (ids.length > 0) await ackPublished(sync, ids);
    pending = pending.filter((id) => !ids.includes(id));
    return { ids, published };
  }

  async function holdFor(group, objects, sequence, head, committed) {
    if (!group) return now() + 60000;
    const count = logical(group, objects);
    let bytes = 1;
    try {
      bytes = packFor([group], sequence, head, objects, committed).bytes;
    } catch {
      bytes = 1;
    }
    const charges = await outgoingCharges();
    const retry = retryAtFor(now(), charges, { messages: Math.min(count, MESSAGE_MAX), bytes: Math.min(bytes, SYNC_BYTES_MAX) });
    return retry ?? now() + 60000;
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
    for (const id of ids) skipped.add(id);
    pending = pending.filter((id) => !skipped.has(id));
    const existing = await readBytes(sync.store, issuesPath());
    const prior = existing ? JSON.parse(existing.toString('utf8')).ids ?? [] : [];
    const record = { format: 'hivem1nd-sync-issues-v1', ids: [...new Set([...prior, ...ids])] };
    await writeDurable(sync.store, issuesPath(), Buffer.from(`${canonicalJson(record)}\n`, 'utf8'), [sync.paths.localDirectory, sync.store.confineRoot]);
  }

  function issuesPath() {
    return path.join(sync.paths.localDirectory, 'outgoing', 'issues.json');
  }

  async function failOnce(error) {
    await recordSyncFailure(sync, error);
    const notice = await claimLimitNotice(ledger, 'publication');
    if (notice.created) events.push({ type: 'sync.error', code: error?.code ?? 'internal_error', noticeId: notice.id });
  }

  return { changed, flush, resume, beat, close };
}

function packFor(groups, sequence, head, objects, committed, compressed = null) {
  const changes = groups.flat();
  const blobs = objectsFor(changes, objects);
  const body = encodePack({
    compressed,
    machine: changes[0].machine,
    sequence,
    changes,
    objects: blobs.filter(({ hash }) => !committed.has(hash)),
    dependencies: blobs.filter(({ hash }) => committed.has(hash)).map(({ hash }) => committed.get(hash)),
    transactions: transactionsOf(changes),
  });
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
