import { lstat, readFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, canonicalJson, hashBytes, recordHeaders, replaceHeader, uuidV8 } from '../service/identity.mjs';
import { resolveTarget } from '../service/paths.mjs';
import { compressObject, countLogicalMessages, decodePack, isDeterministicNotice, sessionVerdict, validateChange, validateHead } from './pack.mjs';
import { reserveReceipt } from './limits.mjs';
import { openLedger } from './limits.mjs';
import { projectPathSet, resolveIncoming, targetKey } from './store.mjs';
import { bindProjects, resolveAuthorized } from '../service/store.mjs';
import { writeDurable } from './origin.mjs';

const FUTURE_MS = 30000;
const RESULT_FORMATS = new Set([
  'hivem1nd-session-result-v1',
  'hivem1nd-approval-result-v1',
  'hivem1nd-approval-answer-result-v1',
  'hivem1nd-grant-revocation-result-v1',
]);

export function compareVersions(left, right) {
  const earlier = Date.parse(left?.at);
  const later = Date.parse(right?.at);
  if (!Number.isFinite(earlier) || !Number.isFinite(later)) throw new CoreError(422, 'invalid_pack', 'The change time must be UTC.');
  if (earlier !== later) return earlier < later ? -1 : 1;
  if (left.machine !== right.machine) return left.machine < right.machine ? -1 : 1;
  if (left.id !== right.id) return left.id < right.id ? -1 : 1;
  return 0;
}

export function validateOwner({ packMachine, target, record = null, headers = null, bindings = {} } = {}) {
  const format = record?.format ?? null;
  if (format === 'hivem1nd-session-result-v1') {
    const owner = bindings.requests?.[record.requestId]?.targetMachine ?? null;
    if (!owner) return pendingOwner(`request:${record.requestId ?? ''}`);
    if (owner !== packMachine || claimedMachine(record) !== null && claimedMachine(record) !== packMachine) ownerError();
  }
  if (format === 'hivem1nd-approval-result-v1' || format === 'hivem1nd-approval-answer-result-v1') {
    const owner = bindings.approvals?.[record.approvalId]?.machine ?? null;
    if (!owner) return pendingOwner(`approval:${record.approvalId ?? ''}`);
    if (owner !== packMachine || claimedMachine(record) !== null && claimedMachine(record) !== packMachine) ownerError();
  }
  if (format === 'hivem1nd-grant-revocation-result-v1') {
    const owner = bindings.revocations?.[record.requestId]?.machine ?? null;
    if (!owner) return pendingOwner(`revocation:${record.requestId ?? ''}`);
    if (owner !== packMachine || claimedMachine(record) !== null && claimedMachine(record) !== packMachine) ownerError();
  }
  if (format === 'hivem1nd-session-status-v1') {
    const owner = bindings.sessions?.[record.sessionId]?.machine ?? null;
    if (!owner) return pendingOwner(`session:${record.sessionId ?? ''}`);
    if (owner !== packMachine || claimedMachine(record) !== null && claimedMachine(record) !== packMachine) ownerError();
  }
  if (format === 'hivem1nd-service-v1' && record.machine !== packMachine) ownerError();
  if (isReadReceipt(target?.path)) {
    const reader = receiptMachine(target.path);
    if (!reader || reader !== packMachine || (record?.machine && record.machine !== packMachine)) ownerError();
  }
  if (headers && messageHeaders(headers)) {
    if (isDeterministicNotice(headers)) return { state: 'accept', packMachine, format };
    if (headers.machine && headers.machine !== packMachine) ownerError();
    const fromId = headers['from-id'];
    if (fromId) {
      const actors = actorMachines(bindings, fromId);
      if (actors.length === 0) return pendingOwner(`actor:${fromId}`);
      if (!actors.includes(packMachine)) ownerError();
    } else if (headers.machine !== packMachine) ownerError();
  }
  return { state: 'accept', packMachine, format };
}

export async function preserveConflict(sync, target, bytes, change, roots) {
  const located = await resolveTarget(sync.paths, target, { projects: sync.projects });
  const chosen = await chooseConflict(located.absolute, bytes, change);
  if (!chosen.existing) await writeDurable(sync.store, chosen.absolute, bytes, roots);
  return { absolute: chosen.absolute, relative: locatedRelative(located, chosen.absolute) };
}

export async function applyPack(sync, packBytes, { provider = { async readHead() { return null; }, async readPack() { return null; } }, bindings = {}, projects = null, ledger = null } = {}) {
  const resolvedProjects = projects ?? sync.projects ?? [];
  const incoming = await resolveIncoming(sync, packBytes, provider);
  const decoded = incoming.decoded;
  const appliedMarker = path.join(sync.paths.localDirectory, 'received', decoded.header.machine, `${decoded.header.sequence}.applied.json`);
  const applied = await readJsonAbsolute(appliedMarker);
  if (applied) {
    if (applied.packHash === decoded.packHash) return { status: 'applied', replayed: true, sequence: decoded.header.sequence };
    throw new CoreError(409, 'revision_conflict', 'An applied pack sequence cannot be reused for different bytes.');
  }
  const verified = await readJsonAbsolute(path.join(sync.paths.localDirectory, 'received', decoded.header.machine, 'head.json'));
  const next = (verified?.sequence ?? 0) + 1;
  if (decoded.header.sequence !== next) {
    await writePending(sync, decoded, decoded.packHash, 'sequence_incomplete');
    return { status: 'pending', code: 'sequence_incomplete', packHash: decoded.packHash };
  }
  const remote = await provider.readHead?.(decoded.header.machine);
  if (remote) {
    const listed = Array.isArray(remote.packs) && remote.packs.some((item) => item.sequence === decoded.header.sequence);
    validateHead(remote, {
      machine: decoded.header.machine,
      previous: verified ?? undefined,
      packBytes: listed ? packBytes : null,
      sequence: listed ? decoded.header.sequence : null,
    });
  } else {
    const packs = [...(verified?.packs ?? []), {
      sequence: decoded.header.sequence,
      file: `${String(decoded.header.sequence).padStart(12, '0')}.pack`,
      hash: decoded.packHash,
      bytes: Buffer.isBuffer(packBytes) ? packBytes.length : Buffer.byteLength(packBytes),
    }];
    validateHead({
      format: 'hivem1nd-head-v1',
      machine: decoded.header.machine,
      sequence: decoded.header.sequence,
      updatedAt: new Date(sync.now()).toISOString(),
      packs,
    }, { machine: decoded.header.machine, previous: verified ?? undefined, packBytes, sequence: decoded.header.sequence });
  }
  const roots = writeRoots(sync, resolvedProjects);
  if (incoming.status === 'pending') {
    await chargeReceipt(ledger, decoded, packBytes, incoming.objects);
    return { status: 'pending', missing: incoming.missing, packHash: incoming.packHash };
  }
  const prepared = decoded.changes.map((change) => {
    const raw = change.operation === 'delete' ? null : incoming.objects.get(change.hash);
    return { change, raw, record: parseRecord(raw), headers: parseHeaders(raw) };
  });
  const ownerBindings = await mergeOwnerBindings(sync, bindings);
  for (const item of prepared) absorbOwnerRecord(ownerBindings, item.record);
  const missingOwners = [];
  for (const item of prepared) {
    if (item.change.target.kind === 'mind' && item.change.target.path.startsWith('user/relay/sessions/') && item.raw && sessionVerdict(item.raw) !== 'ok') {
      throw new CoreError(422, 'invalid_pack', 'A session registration still carries a local secret.');
    }
    if (Date.parse(item.change.at) > sync.now() + FUTURE_MS) throw new CoreError(422, 'invalid_pack', 'The change time is too far in the future.');
    const verdict = validateOwner({ packMachine: decoded.header.machine, target: item.change.target, record: item.record, headers: item.headers, bindings: ownerBindings });
    if (verdict.state === 'pending') missingOwners.push(verdict.missing);
  }
  if (missingOwners.length > 0) {
    await writePending(sync, decoded, incoming.packHash, 'owner_unavailable');
    return { status: 'pending', code: 'owner_unavailable', missing: missingOwners, packHash: incoming.packHash };
  }
  let missingProject = false;
  for (const item of prepared) {
    if (item.change.target.kind !== 'project') continue;
    const project = resolvedProjects.find((entry) => entry.name === item.change.target.project && entry.localPath && entry.eligible !== false);
    if (!project) {
      missingProject = true;
      continue;
    }
    const allowed = await projectPathSet(project, { mind: sync.paths.mind });
    if (!allowed.has(item.change.target.path)) throw new CoreError(422, 'invalid_pack', 'The target is not an eligible record.');
  }
  if (missingProject) {
    await writePending(sync, decoded, incoming.packHash, 'project_unavailable');
    return { status: 'pending', code: 'project_unavailable', packHash: incoming.packHash };
  }
  for (const item of prepared) await resolveTarget(sync.paths, item.change.target, { projects: resolvedProjects });
  const versions = await readVersions(sync);
  const tombstones = new Set(await readGrantTombstones(sync));
  for (const item of prepared) {
    if (item.record?.format === 'hivem1nd-grant-revocation-result-v1' && item.record.grantId) tombstones.add(item.record.grantId);
  }
  const staged = await readStaged(sync);
  const plans = [];
  for (const item of prepared) {
    const key = targetKey(item.change.target);
    const localVersion = competitor(versions.targets[key], staged.get(key));
    const located = await resolveTarget(sync.paths, item.change.target, { projects: resolvedProjects });
    const localBytes = await readRegular(located.absolute);
    if (isImmutable(item) && localBytes && item.raw && !localBytes.equals(item.raw)) {
      throw new CoreError(422, 'corrupt_resource', 'An immutable record cannot be replaced.');
    }
    plans.push(planChange(item, localBytes, localVersion, located, tombstones));
    if (plans[plans.length - 1].version) versions.targets[key] = plans[plans.length - 1].version;
  }
  if (plans.some((plan) => plan.corrupt)) throw new CoreError(422, 'corrupt_resource', 'An immutable record cannot be replaced.');
  await chargeReceipt(ledger, decoded, packBytes, incoming.objects);
  const groups = groupPlans(prepared, plans);
  bindProjects(sync.store, resolvedProjects);
  let completed = 0;
  for (const group of groups) {
    const versionBytes = Buffer.from(`${canonicalJson(versions)}\n`, 'utf8');
    const ops = [...group.ops];
    if (group.version) ops.push({ kind: 'write', file: versionPath(sync), bytes: versionBytes.toString('base64') });
    if (tombstones.size > 0) {
      ops.push({ kind: 'write', file: grantPath(sync), bytes: Buffer.from(`${canonicalJson({ format: 'hivem1nd-grant-tombstones-v1', ids: [...tombstones].sort() })}\n`, 'utf8').toString('base64') });
    }
    await runGroup(sync, group.id, ops, group.events, roots);
    completed += 1;
  }
  await checkpoint(sync, decoded, packBytes, ledger);
  sync.store.events.push({ type: 'sync.applied', machine: decoded.header.machine, sequence: decoded.header.sequence });
  return { status: 'applied', sequence: decoded.header.sequence, groups: completed };
}

function planChange(item, localBytes, localVersion, located, tombstones) {
  const incoming = { at: item.change.at, machine: item.change.machine, id: item.change.id };
  const wins = !localVersion || compareVersions(incoming, localVersion) > 0;
  const raw = item.raw ? filterGrants(item.raw, item.record, tombstones) : null;
  const version = {
    hash: item.change.operation === 'delete' ? null : hashBytes(raw),
    at: item.change.at,
    machine: item.change.machine,
    id: item.change.id,
    deleted: item.change.operation === 'delete',
  };
  const kept = localVersion ? {
    hash: localVersion.hash ?? null,
    at: localVersion.at,
    machine: localVersion.machine,
    id: localVersion.id,
    deleted: Boolean(localVersion.deleted),
  } : null;
  if (item.change.operation === 'delete') {
    if (!wins) return { version: kept, ops: [], events: [] };
    const ops = [];
    if (localBytes) ops.push(conflictOp(located, localBytes, item.change));
    ops.push({ kind: 'remove', file: located.absolute, target: projectTarget(located) });
    return { version, ops, events: conflictEvents(item, ops) };
  }
  if (localVersion?.deleted && !wins) {
    const ops = [conflictOp(located, raw, item.change)];
    return { version: kept, ops, events: conflictEvents(item, ops) };
  }
  if (localBytes && raw && localBytes.equals(raw)) {
    return { version: wins ? version : kept, ops: [], events: [] };
  }
  if (!wins) {
    const ops = [conflictOp(located, raw, item.change)];
    return { version: kept ?? versionFrom(localBytes, localVersion), ops, events: conflictEvents(item, ops) };
  }
  const ops = [];
  const baseMismatch = item.change.baseHash === null || (localBytes && hashBytes(localBytes) !== item.change.baseHash);
  if (localBytes && baseMismatch) ops.push(conflictOp(located, localBytes, item.change));
  ops.push({ kind: 'write', file: located.absolute, target: projectTarget(located), bytes: raw.toString('base64') });
  ops.push(markerOp(item, raw));
  return { version, ops, events: conflictEvents(item, ops) };
}

function conflictOp(located, bytes, change) {
  const stamp = change.at.replace(/[-:]/g, '').replace(/\./g, '');
  const filename = `${path.basename(located.absolute)}.conflict-${change.machine}-${stamp}`;
  const absolute = path.join(path.dirname(located.absolute), filename);
  const slash = located.relative.lastIndexOf('/');
  const relative = `${slash === -1 ? '' : located.relative.slice(0, slash + 1)}${filename}`;
  return { kind: 'write', file: absolute, target: projectTarget(located, relative), bytes: Buffer.from(bytes).toString('base64'), conflict: true, relative };
}

function projectTarget(located, relative = located?.relative) {
  if (located?.kind !== 'project' || typeof relative !== 'string' || relative === '') return undefined;
  return { kind: 'project', project: located.project, path: relative };
}

async function concreteFile(sync, op) {
  if (op?.target?.kind !== 'project') return op.file;
  if (!(sync.store.projects ?? []).some((item) => item.name === op.target.project)) bindProjects(sync.store, sync.projects);
  return resolveAuthorized(sync.store, op.target);
}

function conflictEvents(item, ops) {
  const conflict = ops.find((op) => op.conflict);
  if (!conflict) return [];
  const phase = 'conflict';
  const window = item.change.at;
  const subject = targetKey(item.change.target);
  const id = uuidV8(['notice', phase, window, subject]);
  const body = `id: ${id}\nfrom: master\nto: master\nkind: notice\nphase: ${phase}\nwindow: ${window}\nsubject: ${subject}\n\n${conflict.relative}\n`;
  return [{ type: 'sync.conflict', path: conflict.relative, id: item.change.id, noticeId: id, body }];
}

function markerOp(item, raw) {
  const key = targetKey(item.change.target);
  const id = uuidV8(['applied', item.change.machine, key, hashBytes(raw), item.change.at]);
  return {
    kind: 'marker',
    key,
    bytes: Buffer.from(`${canonicalJson({ hash: hashBytes(raw), deleted: false, at: item.change.at, id })}\n`, 'utf8').toString('base64'),
  };
}

function groupPlans(prepared, plans) {
  const groups = new Map();
  prepared.forEach((item, index) => {
    const id = item.change.transactionId ?? item.change.id;
    const group = groups.get(id) ?? { id, ops: [], events: [], version: false };
    group.ops.push(...plans[index].ops);
    group.events.push(...plans[index].events);
    if (plans[index].version) group.version = true;
    groups.set(id, group);
  });
  return [...groups.values()];
}

async function runGroup(sync, id, ops, events, roots) {
  const file = path.join(sync.paths.localDirectory, 'received', 'groups', id + '.json');
  const existing = await readJsonAbsolute(file);
  if (!existing) {
    for (const op of ops) {
      if (op.kind !== 'write' || op.conflict) continue;
      const file = await concreteFile(sync, op);
      const current = await readRegular(file);
      op.priorHash = current ? hashBytes(current) : null;
      if (current) {
        op.hidden = `${file}.import-hidden`;
        await writeDurable(sync.store, op.hidden, current, roots);
      }
    }
  }
  const progress = existing ?? { id, done: 0, emitted: false, ops, events };
  if (!existing) await writeDurable(sync.store, file, Buffer.from(`${JSON.stringify(progress)}\n`, 'utf8'), roots);
  while (progress.done < progress.ops.length) {
    await perform(sync, progress.ops[progress.done], roots);
    progress.done += 1;
    await writeDurable(sync.store, file, Buffer.from(`${JSON.stringify(progress)}\n`, 'utf8'), roots);
    if (sync.applyFault?.afterWrites != null && progress.done >= sync.applyFault.afterWrites) {
      sync.applyFault = null;
      throw new CoreError(500, 'injected_crash', 'Injected crash during a transaction group.');
    }
  }
  if (!progress.emitted) {
    for (const event of progress.events) {
      sync.store.events.push({ type: event.type, path: event.path, id: event.id });
      if (event.body) await stageNotice(sync, event, roots);
    }
    progress.emitted = true;
    await writeDurable(sync.store, file, Buffer.from(`${JSON.stringify(progress)}\n`, 'utf8'), roots);
  }
}

async function perform(sync, op, roots) {
  if (op.kind === 'write') {
    const bytes = Buffer.from(op.bytes, 'base64');
    let file = await concreteFile(sync, op);
    if (!op.conflict && Object.hasOwn(op, 'priorHash')) {
      const current = await readRegular(file);
      const currentHash = current ? hashBytes(current) : null;
      if (current && currentHash !== op.priorHash && !current.equals(bytes)) {
        await writeDurable(sync.store, `${file}.conflict-replay-${currentHash.slice(0, 8)}`, current, roots);
        return;
      }
    }
    if (op.conflict) {
      const existing = await readRegular(file);
      if (existing?.equals(bytes)) return;
      if (existing) file = `${file}-${hashBytes(existing).slice(0, 8)}`;
    }
    await writeDurable(sync.store, file, bytes, roots);
    return;
  }
  if (op.kind === 'marker') {
    await writeDurable(sync.store, path.join(sync.paths.localDirectory, 'staging', 'applied', `${op.key}.json`), Buffer.from(op.bytes, 'base64'), roots);
    return;
  }
  if (op.kind === 'remove') {
    const file = await concreteFile(sync, op);
    const stats = await lstat(file).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (!stats) return;
    if (stats.isSymbolicLink()) throw new CoreError(422, 'unsafe_path', 'Refusing to follow a link.');
    await unlink(file);
  }
}

async function stageNotice(sync, event, roots) {
  const bytes = Buffer.from(event.body, 'utf8');
  const id = event.noticeId;
  const at = new Date(sync.now()).toISOString();
  const change = validateChange({
    format: 'hivem1nd-change-v1',
    id,
    machine: sync.machine,
    at,
    target: { kind: 'mind', path: `user/inbox/master/${id}.md` },
    operation: 'put',
    hash: hashBytes(bytes),
    size: bytes.length,
    baseHash: null,
    messageId: id,
    transactionId: null,
  }, sync.machine);
  const noticePath = path.join(sync.paths.mind, 'user', 'inbox', 'master', `${id}.md`);
  await writeDurable(sync.store, noticePath, bytes, roots);
  await writeDurable(sync.store, path.join(sync.paths.localDirectory, 'staging', 'objects', `${change.hash}.br`), compressObject(bytes), roots);
  await writeDurable(sync.store, path.join(sync.paths.localDirectory, 'staging', 'changes', `${id}.json`), Buffer.from(`${canonicalJson(change)}\n`, 'utf8'), roots);
}

async function checkpoint(sync, decoded, packBytes, ledger) {
  const machine = decoded.header.machine;
  const file = path.join(sync.paths.localDirectory, 'received', machine, 'head.json');
  const current = await readJsonAbsolute(file);
  const packs = [...(current?.packs ?? [])];
  if ((current?.sequence ?? 0) > 0 && decoded.header.sequence < current.sequence) {
    throw new CoreError(409, 'revision_conflict', 'The head sequence regressed.');
  }
  if (!packs.some((item) => item.sequence === decoded.header.sequence && item.hash === decoded.packHash)) {
    if (packs.some((item) => item.sequence === decoded.header.sequence)) {
      throw new CoreError(409, 'revision_conflict', 'A committed pack sequence cannot be reused for different bytes.');
    }
    packs.push({
      sequence: decoded.header.sequence,
      file: `${String(decoded.header.sequence).padStart(12, '0')}.pack`,
      hash: decoded.packHash,
      bytes: Buffer.isBuffer(packBytes) ? packBytes.length : Buffer.byteLength(packBytes),
    });
  }
  packs.sort((left, right) => left.sequence - right.sequence);
  const head = {
    format: 'hivem1nd-head-v1',
    machine,
    sequence: packs.at(-1).sequence,
    updatedAt: new Date(sync.now()).toISOString(),
    packs,
  };
  validateHead(head, { machine, previous: current ?? undefined, packBytes, sequence: decoded.header.sequence });
  await writeDurable(sync.store, file, Buffer.from(`${canonicalJson(head)}\n`, 'utf8'), writeRoots(sync, sync.projects));
  await writeDurable(sync.store, path.join(sync.paths.localDirectory, 'received', machine, `${decoded.header.sequence}.applied.json`), Buffer.from(`${canonicalJson({ packHash: decoded.packHash, sequence: decoded.header.sequence })}\n`, 'utf8'), writeRoots(sync, sync.projects));
  if (!ledger) return;
  const data = await readLedgerFile(ledger);
  data.applied[machine] = Math.max(data.applied[machine] ?? 0, decoded.header.sequence);
  await writeDurable(sync.store, ledger.file, Buffer.from(`${canonicalJson(data)}\n`, 'utf8'), writeRoots(sync, sync.projects));
}

async function chargeReceipt(ledger, decoded, packBytes, objects = null) {
  if (!ledger) return;
  const opened = ledger.file ? ledger : openLedger(ledger);
  const bytes = Buffer.isBuffer(packBytes) ? packBytes.length : Buffer.from(packBytes).length;
  const known = new Set(opened.knownMessageIds ?? []);
  const messages = countLogicalMessages({ ...decoded, objects: objects ?? decoded.objects }, known);
  await reserveReceipt(opened, {
    machine: decoded.header.machine,
    id: `${decoded.header.machine}:${decoded.header.sequence}:${decoded.packHash}`,
    messages,
    bytes,
  });
}

async function writePending(sync, decoded, packHash, reason) {
  const file = path.join(sync.paths.localDirectory, 'received', 'pending', decoded.header.machine, `${decoded.header.sequence}.json`);
  const existing = await readJsonAbsolute(file);
  const record = {
    packHash,
    dependencies: [],
    firstSeenAt: existing?.firstSeenAt ?? new Date(sync.now()).toISOString(),
    reason,
  };
  await writeDurable(sync.store, file, Buffer.from(`${canonicalJson(record)}\n`, 'utf8'), writeRoots(sync, sync.projects));
}

function competitor(recorded, staged) {
  if (!recorded) return staged ? { hash: staged.hash, at: staged.at, machine: staged.machine, id: staged.id, deleted: staged.operation === 'delete' } : null;
  if (!staged) return recorded;
  const stagedVersion = { hash: staged.hash, at: staged.at, machine: staged.machine, id: staged.id, deleted: staged.operation === 'delete' };
  return compareVersions(stagedVersion, recorded) > 0 ? stagedVersion : recorded;
}

function versionFrom(localBytes, localVersion) {
  if (localVersion) return localVersion;
  if (!localBytes) return null;
  return null;
}

function filterGrants(raw, record, tombstones) {
  if (!raw || tombstones.size === 0) return raw;
  const parsed = recordHeaders(raw);
  if (parsed.headers.has('approvals')) {
    let approvals;
    try {
      approvals = JSON.parse(parsed.headers.get('approvals'));
    } catch {
      approvals = null;
    }
    if (Array.isArray(approvals)) {
      const filtered = approvals.filter((grant) => !tombstones.has(grantId(grant)));
      if (filtered.length !== approvals.length) return replaceHeader(raw, 'approvals', canonicalJson(filtered));
      return raw;
    }
  }
  if (!record || !Array.isArray(record.grants)) return raw;
  const grants = record.grants.filter((grant) => !tombstones.has(grantId(grant)));
  return Buffer.from(`${canonicalJson({ ...record, grants })}\n`, 'utf8');
}

function grantId(grant) {
  if (typeof grant === 'string') return grant;
  return grant?.id ?? '';
}

function isImmutable(item) {
  if (RESULT_FORMATS.has(item.record?.format)) return true;
  if (item.record?.format === 'hivem1nd-session-request-v1' || item.record?.format === 'hivem1nd-approval-v1' || item.record?.format === 'hivem1nd-approval-answer-v1' || item.record?.format === 'hivem1nd-read-v1') return true;
  return /(^|\/)inbox\/[^/]+\/[^/]+\.md$/.test(item.change.target.path) || /(^|\/)archive\/[^/]+\/[^/]+\.md$/.test(item.change.target.path);
}

function parseRecord(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseHeaders(raw) {
  if (!raw) return null;
  const text = raw.toString('utf8');
  if (!text.startsWith('id:') && !text.startsWith('from:')) return null;
  const headers = {};
  for (const line of text.split(/\r?\n/)) {
    if (line === '') break;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return headers;
}

async function readStaged(sync) {
  const map = new Map();
  const directory = path.join(sync.paths.localDirectory, 'staging', 'changes');
  let names = [];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const parsed = await readJsonAbsolute(path.join(directory, name));
    if (!parsed?.target) continue;
    map.set(targetKey(parsed.target), parsed);
  }
  return map;
}

async function readVersions(sync) {
  const parsed = await readJsonAbsolute(versionPath(sync));
  if (!parsed) return { format: 'hivem1nd-sync-versions-v1', targets: {} };
  parsed.targets ??= {};
  return parsed;
}

async function readGrantTombstones(sync) {
  const parsed = await readJsonAbsolute(grantPath(sync));
  return Array.isArray(parsed?.ids) ? parsed.ids : [];
}

async function readLedgerFile(ledger) {
  const parsed = await readJsonAbsolute(ledger.file);
  if (!parsed) return { format: 'hivem1nd-sync-ledger-v1', admitted: [], outgoing: [], incoming: {}, applied: {}, notices: [] };
  parsed.applied ??= {};
  parsed.incoming ??= {};
  parsed.admitted ??= [];
  parsed.outgoing ??= [];
  parsed.notices ??= [];
  return parsed;
}

async function readJsonAbsolute(file) {
  const bytes = await readRegular(file);
  if (!bytes) return null;
  return JSON.parse(bytes.toString('utf8'));
}

async function readRegular(file) {
  try {
    const stats = await lstat(file);
    if (!stats.isFile() || stats.isSymbolicLink()) return null;
    return await readFile(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function chooseConflict(absolute, bytes, change) {
  const stamp = change.at.replace(/[-:]/g, '').replace(/\./g, '');
  let file = path.join(path.dirname(absolute), `${path.basename(absolute)}.conflict-${change.machine}-${stamp}`);
  const existing = await readRegular(file);
  if (existing && !existing.equals(Buffer.from(bytes))) file = `${file}-${change.id}`;
  return { absolute: file, existing: existing && existing.equals(Buffer.from(bytes)) };
}

function locatedRelative(located, absolute) {
  const slash = located.relative.lastIndexOf('/');
  const prefix = slash === -1 ? '' : located.relative.slice(0, slash + 1);
  return `${prefix}${path.basename(absolute)}`;
}

function writeRoots(sync, projects) {
  return [sync.paths.mind, sync.paths.localDirectory, sync.paths.origin, sync.store.confineRoot, ...(projects ?? []).map((project) => project.localPath)];
}

function versionPath(sync) {
  return path.join(sync.paths.localDirectory, 'sync-versions.json');
}

function grantPath(sync) {
  return path.join(sync.paths.localDirectory, 'grant-tombstones.json');
}

function pendingOwner(missing) {
  return { state: 'pending', missing };
}

function claimedMachine(record) {
  return typeof record?.machine === 'string' ? record.machine : null;
}

function messageHeaders(headers) {
  return Boolean(headers.kind || headers['from-id'] || headers.machine);
}

function actorMachines(bindings, id) {
  const value = bindings.actors?.[id];
  if (!value) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value;
  if (typeof value.machine === 'string') return [value.machine];
  return [];
}

function isReadReceipt(filePath) {
  return typeof filePath === 'string' && filePath.split('/').includes('read');
}

function receiptMachine(filePath) {
  const parts = filePath.split('/');
  const index = parts.lastIndexOf('read');
  const after = parts.slice(index + 1);
  if (parts[index - 1] === 'relay') return after[0] ?? null;
  return after.length >= 2 ? after[1] : null;
}

async function mergeOwnerBindings(sync, supplied = {}) {
  const bindings = {
    requests: { ...(supplied.requests ?? {}) },
    approvals: { ...(supplied.approvals ?? {}) },
    revocations: { ...(supplied.revocations ?? {}) },
    sessions: { ...(supplied.sessions ?? {}) },
    actors: { ...(supplied.actors ?? {}) },
  };
  if (!sync?.paths?.mind) return bindings;
  const roots = [
    path.join(sync.paths.mind, 'user', 'relay', 'requests'),
    path.join(sync.paths.mind, 'user', 'relay', 'approvals'),
    path.join(sync.paths.mind, 'user', 'relay', 'sessions'),
    path.join(sync.paths.mind, 'user', 'relay', 'registrations'),
  ];
  for (const root of roots) await readOwnerTree(root, (record) => absorbOwnerRecord(bindings, record));
  return bindings;
}

function absorbOwnerRecord(bindings, record) {
  if (!record || typeof record !== 'object') return;
  if (record.format === 'hivem1nd-session-request-v1' && record.id && record.targetMachine) {
    bindings.requests[record.id] = { targetMachine: record.targetMachine };
    bindings.revocations[record.id] = { machine: record.targetMachine };
  }
  if ((record.format === 'hivem1nd-approval-v1' || record.format === 'hivem1nd-approval-binding-v1') && record.machine) {
    const id = record.approvalId ?? record.id;
    if (id) bindings.approvals[id] = { machine: record.machine };
  }
  if (record.kind === 'registration' && record.sessionId && record.machine) {
    bindings.sessions[record.sessionId] = { machine: record.machine };
    if (record.unitId) addActor(bindings, record.unitId, record.machine);
  }
}

function addActor(bindings, unitId, machine) {
  const current = actorMachines(bindings, unitId);
  if (!current.includes(machine)) current.push(machine);
  bindings.actors[unitId] = current;
}

async function readOwnerTree(directory, visit) {
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
      await readOwnerTree(full, visit);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      visit(JSON.parse(await readFile(full, 'utf8')));
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
}

function ownerError() {
  throw new CoreError(422, 'invalid_record_owner', 'The record is not owned by the publishing machine.');
}
