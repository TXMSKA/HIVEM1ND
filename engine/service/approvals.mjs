import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CLIENTS, CoreError, canonicalJson, hashBytes, parseTaskId, parseUnitId, replaceHeader, uuidV8, validateName } from './identity.mjs';
import { assertChatSession, classifyApprovalAction, enqueueStart } from './adapters.mjs';
import { authorize } from './security.mjs';
import { readUnitState as readState, readUnitStates } from './state.mjs';
import { publishDomainEvents } from './events.mjs';
import { createChat } from './chats.mjs';
import { paginate, readDetail } from './projection.mjs';
import { commitTransaction, readBytes, revisionOf, withLocalChanges, withLocks } from './store.mjs';
import { noteSync, openSync, stageTransaction } from '../sync/store.mjs';

const LIFETIME_MS = 120000;
const ACTIONS = new Set(['process.run', 'file.write', 'network.request', 'session.open', 'git.commit', 'git.push']);
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
const DECISIONS = new Set(['approve', 'approve-always', 'deny']);

export function normalizeAction(action, pattern, options = {}) {
  if (!ACTIONS.has(action)) throw new CoreError(422, 'unsupported_action', 'The action has no exact approval shape.');
  if (!pattern || typeof pattern !== 'object' || Array.isArray(pattern)) {
    throw new CoreError(422, 'invalid_body', 'The action pattern must be an object.');
  }
  if (action === 'process.run') return normalizeProcess(pattern, options.projects ?? []);
  if (action === 'git.commit' || action === 'git.push') return normalizeGit(action, pattern, options.projects ?? []);
  if (action === 'file.write') return normalizeFile(pattern);
  if (action === 'session.open') return normalizeSession(pattern);
  return normalizeNetwork(pattern);
}

export function approvalRevision({ request, answers = [], result = null }) {
  const requestHash = hashBytes(asBuffer(request));
  const answerHashes = answers.map((item) => hashBytes(asBuffer(item))).sort();
  const resultHash = result ? hashBytes(asBuffer(result)) : null;
  return hashBytes(Buffer.from(canonicalJson([requestHash, answerHashes, resultHash])));
}

export async function requestApproval(context, input) {
  const unitId = context.principal?.unitId;
  const sessionId = context.principal?.sessionId;
  if (!unitId || !sessionId) throw new CoreError(422, 'invalid_binding', 'The approval binding is incomplete.');
  const parsed = parseUnitId(unitId);
  const normalized = normalizeAction(input?.action, input?.pattern, { projects: context.projects ?? [] });
  if (typeof input?.display !== 'string' || input.display.length < 1 || input.display.length > 240) {
    throw new CoreError(422, 'invalid_body', 'The approval display is not valid.');
  }
  if (input?.alwaysAllowed !== undefined && typeof input.alwaysAllowed !== 'boolean') throw new CoreError(422, 'invalid_body', 'alwaysAllowed must be boolean.');
  const state = await readState(context, parsed);
  if (!state) throw new CoreError(404, 'unit_not_found', 'The requesting unit does not exist.');
  if (normalized.action === 'session.open') await validateChild(context, normalized.pattern, sessionId);
  const chat = await chatFor(context, input?.chatId, parsed.id);
  const tombstones = await readTombstones(context);
  const existing = normalized.alwaysAllowed && grantsOf(state.bytes).find((grant) => !tombstones.ids.has(grant.id) && grant.action === normalized.action && normalized.exact && canonicalJson(grant.pattern) === canonicalJson(normalized.pattern));
  const id = randomUUID();
  const requestedAt = stamp(context);
  const request = {
    format: 'hivem1nd-approval-v1',
    id,
    unitId: parsed.id,
    sessionId,
    chatId: chat.id,
    action: normalized.action,
    pattern: normalized.pattern,
    display: input.display,
    alwaysAllowed: Boolean(normalized.alwaysAllowed && input.alwaysAllowed !== false && !existing),
    desktopOnly: normalized.desktopOnly,
    operationId: typeof input?.operationId === 'string' ? input.operationId : null,
    requestedAt,
    expiresAt: new Date(context.now() + LIFETIME_MS).toISOString(),
  };
  const requestBytes = jsonBytes(request);
  const bindingBytes = jsonBytes({ format: 'hivem1nd-approval-binding-v1', approvalId: id, unitId: parsed.id, sessionId, machine: context.paths.machine });
  const entries = [
    entry(context, `user/relay/approvals/${id}/request.json`, null, requestBytes),
    entry(context, `user/relay/approvals/${id}/binding.json`, null, bindingBytes),
  ];
  let result = null;
  if (existing) {
    result = {
      format: 'hivem1nd-approval-result-v1',
      approvalId: id,
      state: 'approved',
      answerId: null,
      grantId: existing.id,
      at: requestedAt,
    };
    entries.push(entry(context, `user/relay/approvals/${id}/result.json`, null, jsonBytes(result)));
  } else {
    entries.push(entry(context, noticePath(chat.id, id), null, noticeBytes(context, parsed, id, input.display)));
  }
  const approval = projectApproval({
    request,
    requestBytes,
    binding: { machine: context.paths.machine },
    result,
    resultBytes: result ? jsonBytes(result) : null,
  }, existing ? 'approved' : 'pending');
  const owned = (name) => ownedEvent(context, { request, binding: { machine: context.paths.machine } }, name, approval);
  await commitFiles(context, entries, existing ? [owned('approval.requested'), owned('approval.answered')] : [owned('approval.requested')]);
  if (!existing) arm(context, request);
  if (!existing && context.notify) {
    try {
      await context.notify(request);
    } catch {
      throw new CoreError(502, 'delivery_failed', 'The approval notice was not delivered.');
    }
  }
  const live = existing ? await resumeNative(context, request, existing.id) : false;
  return {
    status: existing ? 200 : 202,
    approval,
    prompted: !existing,
    allow: Boolean(existing && live),
    resumed: Boolean(existing && live),
  };
}

export async function answerApproval(context, approvalId, input) {
  assertMaster(context);
  if (!DECISIONS.has(input?.decision)) throw new CoreError(422, 'invalid_body', 'The decision is not supported.');
  if (typeof input?.expectedRevision !== 'string') throw new CoreError(422, 'invalid_body', 'The approval revision is required.');
  return withLocks(context.store, [`approval:${approvalId}`], async () => {
    const loaded = await loadApproval(context, approvalId);
    authorize(context.principal, 'approval.answer', { decision: input.decision, desktopOnly: classifyApprovalAction(loaded.request.action, loaded.request.pattern).desktopOnly });
    if (loaded.result) {
      await recordLateAnswer(context, loaded, input.decision);
      const expired = loaded.result.state === 'expired';
      throw new CoreError(expired ? 410 : 409, expired ? 'approval_expired' : 'approval_resolved', 'The approval is already resolved.');
    }
    const answer = answerRecord(context, approvalId, input.decision);
    if (Date.parse(loaded.request.expiresAt) <= context.now()) {
      if (isOwner(context, loaded.binding)) await settle(context, withAnswer(loaded, answer), null, 'expired', answer);
      throw new CoreError(410, 'approval_expired', 'The approval request expired.');
    }
    const revision = approvalRevision({ request: loaded.requestBytes, answers: loaded.answerBytes });
    if (input.expectedRevision !== revision) throw new CoreError(409, 'revision_conflict', 'The approval dialog is stale.');
    if (input.decision === 'approve-always' && !validAnswer(loaded.request, answer)) {
      throw new CoreError(422, 'always_unavailable', 'This action cannot be granted forever.');
    }
    if (!isOwner(context, loaded.binding)) {
      const queued = withAnswer(loaded, answer);
      const approval = projectApproval(queued, 'answering');
      await commitFiles(context, [entry(context, answerPath(approvalId, answer.id), null, jsonBytes(answer))], [
        ownedEvent(context, queued, 'approval.answered', approval),
      ]);
      return { status: 202, state: 'queued', answerId: answer.id, approval, allow: false };
    }
    const decision = answer.decision === 'deny' ? 'denied' : 'approved';
    return settle(context, withAnswer(loaded, answer), answer, decision, answer);
  });
}

export async function listApprovals(context, query = {}) {
  const wanted = query.state ?? 'pending';
  const items = [];
  for (const id of await approvalIds(context)) {
    const loaded = await loadApproval(context, id);
    const approval = projectApproval(loaded);
    if (query.unitId && approval.unitId !== query.unitId) continue;
    if (wanted !== approval.state) continue;
    items.push(approval);
  }
  items.sort((left, right) => left.id.localeCompare(right.id));
  return paginate(items, query);
}

export async function readApproval(context, approvalId) {
  const loaded = await loadApproval(context, approvalId);
  return projectApproval(loaded);
}

export async function readAnswerResult(context, approvalId, answerId) {
  const parsed = await readJson(context, `user/relay/approvals/${approvalId}/answer-results/${answerId}.json`);
  if (!parsed) throw new CoreError(404, 'answer_not_found', 'The answer does not exist.');
  return {
    answerId: parsed.answerId,
    approvalId: parsed.approvalId,
    state: parsed.state,
    resultAnswerId: parsed.resultAnswerId ?? null,
    at: parsed.at ?? null,
  };
}

export async function listGrants(context, unitId, query = {}) {
  const parsed = parseUnitId(unitId);
  const state = await readState(context, parsed);
  if (!state) throw new CoreError(404, 'unit_not_found', 'The unit does not exist.');
  const unit = await readDetail(context, 'units', parsed.id);
  const tombstones = await readTombstones(context);
  const items = unit.approvalGrants.filter(grant => !tombstones.ids.has(grant.id)).map(grant => ({ ...grant, unitId: parsed.id }));
  return paginate(items, query);
}

export async function readRevocation(context, requestId) {
  const result = await readJson(context, `user/relay/grant-revocation-results/${requestId}.json`);
  if (result) return result;
  const pending = await readJson(context, `user/relay/grant-revocations/${context.paths.machine}/${requestId}.json`);
  if (!pending) throw new CoreError(404, 'revocation_not_found', 'The revocation does not exist.');
  return { requestId: pending.id, unitId: pending.unitId, grantId: pending.grantId, state: 'pending', revision: null };
}

export async function consumeAnswers(context, approvalId = null) {
  const ids = approvalId ? [approvalId] : await approvalIds(context);
  const outcomes = [];
  for (const id of ids) {
    outcomes.push(await withLocks(context.store, [`approval:${id}`], async () => {
      const loaded = await loadApproval(context, id);
      if (!isOwner(context, loaded.binding)) return { approvalId: id, skipped: true, allow: false };
      if (loaded.result) return { approvalId: id, replayed: true, allow: false, resumed: false, state: loaded.result.state };
      if (Date.parse(loaded.request.expiresAt) <= context.now()) return settle(context, loaded, null, 'expired');
      const winner = [...loaded.answers].sort(byArrival).find((item) => validAnswer(loaded.request, item));
      if (!winner) return { approvalId: id, state: 'pending', allow: false };
      return settle(context, loaded, winner, winner.decision === 'deny' ? 'denied' : 'approved');
    }));
  }
  return outcomes;
}

export async function revokeGrant(context, unitId, grantId, input) {
  assertMaster(context);
  const parsed = parseUnitId(unitId);
  const state = await readState(context, parsed);
  if (!state) throw new CoreError(404, 'unit_not_found', 'The unit does not exist.');
  const grants = grantsOf(state.bytes);
  if (!grants.some((grant) => grant.id === grantId)) throw new CoreError(404, 'grant_not_found', 'The grant does not exist.');
  if (revisionOf(state.bytes) !== input?.expectedRevision) throw new CoreError(409, 'revision_conflict', 'The unit changed before revocation.');
  const owner = headerValue(state.bytes, 'machine');
  const request = {
    format: 'hivem1nd-grant-revocation-v1',
    id: randomUUID(),
    unitId: parsed.id,
    grantId,
    requestedBy: context.principal?.unitId ?? 'root:master',
    at: stamp(context),
  };
  const relative = `user/relay/grant-revocations/${owner}/${request.id}.json`;
  if (owner !== context.paths.machine) {
    await commitFiles(context, [entry(context, relative, null, jsonBytes(request))], []);
    return { status: 202, requestId: request.id, unitId: parsed.id, grantId, state: 'pending', revision: null };
  }
  const applied = await applyRevocation(context, state, request, { writeRequest: true });
  return { status: 200, ...applied };
}

export async function consumeRevocations(context) {
  await reconcileGrants(context);
  const results = [];
  for (const request of await revocationRequests(context)) {
    const state = await readState(context, parseUnitId(request.unitId));
    if (!state || headerValue(state.bytes, 'machine') !== context.paths.machine) continue;
    const existing = await readJson(context, `user/relay/grant-revocation-results/${request.id}.json`);
    if (existing) continue;
    results.push(await applyRevocation(context, state, request, { writeRequest: false }));
  }
  await reconcileGrants(context);
  return results;
}

export async function recoverApprovals(context) {
  const outcomes = [];
  for (const id of await approvalIds(context)) {
    const loaded = await loadApproval(context, id);
    if (!isOwner(context, loaded.binding) || loaded.result) continue;
    const delay = Date.parse(loaded.request.expiresAt) - context.now();
    if (delay <= 0) outcomes.push(await withLocks(context.store, [`approval:${id}`], () => settle(context, loaded, null, 'expired')));
    else arm(context, loaded.request);
  }
  return outcomes;
}

async function settle(context, loaded, answer, state, pending = null) {
  const request = loaded.request;
  if (loaded.result) return { approvalId: request.id, replayed: true, allow: false, resumed: false, state: loaded.result.state };
  const tombstones = await readTombstones(context);
  const grantId = state === 'approved' && answer?.decision === 'approve-always' ? freshGrantId(tombstones.ids) : null;
  const at = stamp(context);
  const result = {
    format: 'hivem1nd-approval-result-v1',
    approvalId: request.id,
    state,
    answerId: answer?.id ?? null,
    grantId,
    at,
  };
  const entries = [entry(context, `user/relay/approvals/${request.id}/result.json`, null, jsonBytes(result))];
  if (pending) entries.push(entry(context, answerPath(request.id, pending.id), null, jsonBytes(pending)));
  const outcomes = [];
  for (const item of loaded.answers) {
    const outcome = !answer || item.id !== answer.id ? (state === 'expired' ? 'expired' : 'rejected') : 'applied';
    const record = {
      format: 'hivem1nd-approval-answer-result-v1',
      answerId: item.id,
      approvalId: request.id,
      state: outcome,
      resultAnswerId: answer?.id ?? null,
      at,
    };
    outcomes.push(record);
    entries.push(entry(context, `user/relay/approvals/${request.id}/answer-results/${item.id}.json`, null, jsonBytes(record)));
  }
  const approval = projectApproval({
    ...loaded,
    result,
    resultBytes: jsonBytes(result),
    outcomes,
  }, state);
  const events = [ownedEvent(context, loaded, 'approval.answered', approval)];
  if (grantId) {
    const unit = parseUnitId(request.unitId);
    const current = await readState(context, unit);
    const grants = grantsOf(current.bytes).filter((grant) => grant.id !== grantId);
    grants.push({ id: grantId, action: request.action, pattern: request.pattern, grantedAt: at, grantedBy: answer.answeredBy });
    const next = replaceHeader(current.bytes, 'approvals', canonicalJson(grants));
    entries.push(entry(context, current.relative, revisionOf(current.bytes), next));
    events.push({ name: 'approval.grant.changed', data: { unitId: request.unitId, grantId, operation: 'granted', revision: hashBytes(next) } });
    events.push({ name: 'unit.changed', data: { unit: { id: request.unitId } } });
  }
  await commitFiles(context, entries, events);
  let child = null;
  if (state === 'approved' && request.action === 'session.open') {
    const owner = { ...context, principal: { ...context.principal, unitId: request.unitId, sessionId: request.sessionId } };
    try {
      const target = await validateChild(owner, request.pattern, request.sessionId);
      child = await enqueueStart(owner, { ...request.pattern, targetMachine: request.pattern.machine, stateRevision: hashBytes(target.bytes), approvalId: request.id });
    } catch (error) {
      child = { state: 'failed', error: { code: error.code ?? 'client_unavailable', message: 'The approved CLI could not be opened.' } };
    }
  }
  const resumed = state === 'approved' && request.action !== 'session.open' && await resumeNative(context, request, grantId);
  return { status: 200, approval, answerId: answer?.id ?? null, state, grantId, allow: resumed, resumed, child, replayed: false };
}

async function recordLateAnswer(context, loaded, decision) {
  const answer = {
    format: 'hivem1nd-approval-answer-v1',
    id: randomUUID(),
    approvalId: loaded.request.id,
    decision,
    answeredBy: context.principal?.unitId ?? 'root:master',
    machine: context.paths.machine,
    audience: context.principal?.audience ?? 'desktop',
    at: stamp(context),
  };
  const outcome = loaded.result.state === 'expired' ? 'expired' : 'rejected';
  await commitFiles(context, [
    entry(context, answerPath(loaded.request.id, answer.id), null, jsonBytes(answer)),
    entry(context, `user/relay/approvals/${loaded.request.id}/answer-results/${answer.id}.json`, null, jsonBytes({
      format: 'hivem1nd-approval-answer-result-v1',
      answerId: answer.id,
      approvalId: loaded.request.id,
      state: outcome,
      resultAnswerId: loaded.result.answerId,
      at: stamp(context),
    })),
  ], []);
}

async function applyRevocation(context, state, request, { writeRequest }) {
  const tombstones = await readTombstones(context);
  tombstones.ids.add(request.grantId);
  const grants = grantsOf(state.bytes).filter((grant) => !tombstones.ids.has(grant.id));
  const next = replaceHeader(state.bytes, 'approvals', canonicalJson(grants));
  const result = {
    format: 'hivem1nd-grant-revocation-result-v1',
    requestId: request.id,
    unitId: request.unitId,
    grantId: request.grantId,
    state: 'revoked',
    revision: hashBytes(next),
    at: stamp(context),
  };
  const records = [
    entry(context, `user/relay/grant-revocation-results/${request.id}.json`, null, jsonBytes(result)),
    entry(context, state.relative, revisionOf(state.bytes), next),
    tombstoneEntry(context, tombstones),
  ];
  if (writeRequest) records.unshift(entry(context, `user/relay/grant-revocations/${context.paths.machine}/${request.id}.json`, null, jsonBytes(request)));
  await commitFiles(context, records, [
    { name: 'approval.grant.changed', data: { unitId: request.unitId, grantId: request.grantId, operation: 'revoked', revision: hashBytes(next) } },
    { name: 'unit.changed', data: { unit: { id: request.unitId } } },
  ]);
  return { requestId: request.id, unitId: request.unitId, grantId: request.grantId, state: 'revoked', revision: hashBytes(next) };
}

async function reconcileGrants(context) {
  const tombstones = await readTombstones(context);
  if (tombstones.ids.size === 0) return;
  for (const { id, relative, bytes } of await readUnitStates(context)) {
    if (!bytes || headerValue(bytes, 'machine') !== context.paths.machine) continue;
    const grants = grantsOf(bytes);
    const kept = grants.filter((grant) => !tombstones.ids.has(grant.id));
    if (kept.length === grants.length) continue;
    const next = replaceHeader(bytes, 'approvals', canonicalJson(kept));
    await commitFiles(context, [entry(context, relative, revisionOf(bytes), next)], [
      { name: 'unit.changed', data: { unit: { id } } },
    ]);
  }
}

function arm(context, request) {
  const delay = Date.parse(request.expiresAt) - context.now();
  if (delay <= 0) return;
  const run = () => {
    recoverApprovals(context).catch(() => {});
  };
  if (typeof context.schedule === 'function') {
    context.schedule(run, delay);
    return;
  }
  const timer = setTimeout(run, delay);
  timer.unref?.();
}

async function chatFor(context, chatId, unitId) {
  if (!chatId) {
    const created = await createChat(context, { members: [unitId] });
    return created.chat;
  }
  const bytes = await readBytes(context.store, absolute(context, `user/relay/chats/${chatId}/chat.md`));
  if (!bytes) throw new CoreError(404, 'chat_not_found', 'The chat does not exist.');
  const members = JSON.parse(headerValue(bytes, 'members') || '[]');
  if (!members.includes('root:master') || !members.includes(unitId)) {
    throw new CoreError(422, 'invalid_chat', 'The chat must contain master and the requesting unit.');
  }
  return { id: chatId, members };
}

async function loadApproval(context, approvalId) {
  const requestBytes = await readBytes(context.store, absolute(context, `user/relay/approvals/${approvalId}/request.json`));
  if (!requestBytes) throw new CoreError(404, 'approval_not_found', 'The approval does not exist.');
  const bindingBytes = await readBytes(context.store, absolute(context, `user/relay/approvals/${approvalId}/binding.json`));
  const answers = await readAnswers(context, approvalId);
  const resultBytes = await readBytes(context.store, absolute(context, `user/relay/approvals/${approvalId}/result.json`));
  return {
    requestBytes,
    request: JSON.parse(requestBytes.toString('utf8')),
    binding: bindingBytes ? JSON.parse(bindingBytes.toString('utf8')) : null,
    answers: answers.map((item) => JSON.parse(item.toString('utf8'))),
    answerBytes: answers,
    result: resultBytes ? JSON.parse(resultBytes.toString('utf8')) : null,
    resultBytes,
    outcomes: await readOutcomes(context, approvalId),
  };
}

async function readAnswers(context, approvalId) {
  const directory = absolute(context, `user/relay/approvals/${approvalId}/answers`);
  let names = [];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const records = [];
  for (const name of names) records.push(await readBytes(context.store, path.join(directory, name)));
  return records.filter(Boolean);
}

async function readOutcomes(context, approvalId) {
  const directory = absolute(context, `user/relay/approvals/${approvalId}/answer-results`);
  let names = [];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const records = [];
  for (const name of names) {
    const bytes = await readBytes(context.store, path.join(directory, name));
    if (bytes) records.push(JSON.parse(bytes.toString('utf8')));
  }
  return records;
}

async function sessionLive(context, sessionId, request) {
  if (typeof context.native?.connected !== 'function') return false;
  if (await context.native.connected(sessionId) !== true) return false;
  if (request?.action === 'file.write' && Array.isArray(context.attached) && !context.attached.includes(request.pattern?.path)) return false;
  return true;
}

async function resumeNative(context, request, grantId = null) {
  const live = await sessionLive(context, request.sessionId, request);
  if (!live) return false;
  if (grantId) {
    const tombstones = await readTombstones(context);
    const state = await readState(context, parseUnitId(request.unitId));
    if (tombstones.ids.has(grantId) || !state || !grantsOf(state.bytes).some(grant => grant.id === grantId && grant.action === request.action && canonicalJson(grant.pattern) === canonicalJson(request.pattern))) return false;
  }
  if (typeof context.native?.resolve === 'function') {
    await context.native.resolve({ sessionId: request.sessionId, operationId: request.operationId ?? null, decision: 'approve' });
  }
  return true;
}

async function approvalIds(context) {
  const directory = path.join(context.paths.mind, 'user', 'relay', 'approvals');
  try {
    return (await readdir(directory)).sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function readTombstones(context) {
  const bytes = await readBytes(context.store, path.join(context.paths.localDirectory, 'grant-tombstones.json'));
  if (!bytes) return { ids: new Set(), bytes: null };
  const parsed = JSON.parse(bytes.toString('utf8'));
  return { ids: new Set(Array.isArray(parsed.ids) ? parsed.ids : []), bytes };
}

async function readJson(context, relative) {
  const bytes = await readBytes(context.store, absolute(context, relative));
  return bytes ? JSON.parse(bytes.toString('utf8')) : null;
}

async function revocationRequests(context) {
  const found = [];
  async function walk(directory) {
    let entries = [];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const item of entries) {
      const full = path.join(directory, item.name);
      if (item.isDirectory()) await walk(full);
      else if (item.name.endsWith('.json')) {
        const bytes = await readBytes(context.store, full);
        if (bytes) found.push(JSON.parse(bytes.toString('utf8')));
      }
    }
  }
  await walk(path.join(context.paths.mind, 'user', 'relay', 'grant-revocations'));
  return found;
}

async function commitFiles(context, records, events) {
  return withLocalChanges(context.store, () => commitFilesLocked(context, records, events));
}

async function commitFilesLocked(context, records, events) {
  const id = randomUUID();
  await commitTransaction(context.store, { id, entries: records, events: [] });
  const sync = context.sync ?? openSync({
    store: context.store,
    paths: context.paths,
    now: () => context.now(),
    projects: context.projects ?? [],
  });
  const stage = records.filter((record) => record.resource.startsWith('user/')).map((record) => {
    const bytes = Buffer.isBuffer(record.afterBytes) ? record.afterBytes : Buffer.from(record.afterBytesBase64, 'base64');
    return {
      target: { kind: 'mind', path: record.resource },
      bytes,
      id: uuidV8(['approval-change', id, record.resource, hashBytes(bytes)]),
    };
  });
  if (stage.length) {
    const changes = await stageTransaction(sync, stage, { transactionId: id });
    noteSync(context, changes.length ? 'pending' : 'local');
    if (typeof context.pulse?.changed === 'function') {
      const result = await context.pulse.changed(changes.map((change) => change.id));
      if (result?.published === true) noteSync(context, 'published');
    }
  }
  const enriched = [];
  for (const event of events) {
    const id = event.name === 'unit.changed' ? event.data?.unit?.id : null;
    if (!id) {
      enriched.push(event);
      continue;
    }
    enriched.push({ ...event, data: { unit: await readDetail(context, 'units', id) } });
  }
  publishDomainEvents(context, enriched);
}

function entry(context, relative, before, bytes) {
  return { resource: relative, recordPath: absolute(context, relative), beforeRevision: before, afterBytes: bytes };
}

function tombstoneEntry(context, tombstones) {
  const bytes = jsonBytes({ format: 'hivem1nd-grant-tombstones-v1', ids: [...tombstones.ids].sort() });
  const recordPath = path.join(context.paths.localDirectory, 'grant-tombstones.json');
  return { resource: 'grant-tombstones.json', recordPath, beforeRevision: revisionOf(tombstones.bytes), afterBytes: bytes };
}

function answerRecord(context, approvalId, decision) {
  return {
    format: 'hivem1nd-approval-answer-v1',
    id: randomUUID(),
    approvalId,
    decision,
    answeredBy: context.principal?.unitId ?? 'root:master',
    machine: context.paths.machine,
    audience: context.principal?.audience ?? 'desktop',
    at: stamp(context),
  };
}

function validAnswer(request, answer) {
  if (answer.answeredBy !== 'root:master' || !DECISIONS.has(answer.decision)) return false;
  const classification = classifyApprovalAction(request.action, request.pattern);
  if (answer.audience === 'phone' && (classification.desktopOnly || answer.decision === 'approve-always')) return false;
  if (answer.decision !== 'approve-always') return true;
  return !['session.open', 'git.commit', 'git.push'].includes(request.action)
    && classification.gitAction === null && request.alwaysAllowed === true;
}

function withAnswer(loaded, answer) {
  return { ...loaded, answers: [...loaded.answers, answer], answerBytes: [...loaded.answerBytes, jsonBytes(answer)] };
}

function normalizeProcess(pattern, projects) {
  const command = typeof pattern.command === 'string' ? pattern.command : '';
  const classification = classifyApprovalAction('process.run', pattern);
  const { cwd, known } = approvalLocation(pattern.cwd, projects);
  const exact = command.length > 0 && !/[?*[\]]/.test(command) && !command.includes('..') && known;
  return { action: 'process.run', pattern: { command, cwd }, exact, alwaysAllowed: exact && classification.gitAction === null, ...classification };
}

function approvalLocation(value, projects) {
  const cwd = typeof value === 'string' ? value.replaceAll('\\', '/').replace(/\/+$/, '') : '';
  const known = new Set();
  for (const project of projects) {
    if (typeof project === 'string') {
      const trimmed = project.replaceAll('\\', '/').replace(/\/+$/, '');
      known.add(trimmed);
      continue;
    }
    if (typeof project?.name === 'string') {
      known.add(project.name);
      known.add(`project:${project.name}`);
    }
    if (typeof project?.localPath === 'string') known.add(project.localPath.replaceAll('\\', '/').replace(/\/+$/, ''));
  }
  return { cwd, known: known.has(cwd) };
}

function normalizeGit(action, pattern, projects) {
  if (Object.keys(pattern).length !== 2 || !Object.hasOwn(pattern, 'repository') || !Object.hasOwn(pattern, 'args')
    || !Array.isArray(pattern.args) || pattern.args.length > 256 || pattern.args.some(arg => typeof arg !== 'string' || arg.length > 4096 || /[\u0000-\u001f]/.test(arg))) {
    throw new CoreError(422, 'invalid_body', 'The Git approval must name a repository and literal arguments.');
  }
  const { cwd: repository, known } = approvalLocation(pattern.repository, projects);
  if (!known) throw new CoreError(422, 'unsupported_capability', 'The Git repository is not registered.');
  return { action, pattern: { repository, args: [...pattern.args] }, exact: true, alwaysAllowed: false, ...classifyApprovalAction(action, pattern) };
}

function normalizeSession(pattern) {
  const keys = ['client', 'machine', 'unitId', 'runMode', 'taskId'];
  if (Object.keys(pattern).length !== keys.length || keys.some((key) => !Object.hasOwn(pattern, key))
    || !CLIENTS.includes(pattern.client) || !['task', 'chat'].includes(pattern.runMode)) {
    throw new CoreError(422, 'invalid_body', 'The session approval must name an exact registered CLI and run mode.');
  }
  validateName(pattern.machine, { label: 'machine' });
  parseUnitId(pattern.unitId);
  if (pattern.taskId !== null) parseTaskId(pattern.taskId);
  if (pattern.runMode === 'task' && pattern.taskId === null) throw new CoreError(422, 'task_required', 'A child task session requires its assigned task.');
  return { action: 'session.open', pattern: { ...pattern }, exact: true, alwaysAllowed: false, desktopOnly: false };
}

async function validateChild(context, pattern, sessionId) {
  await assertChatSession(context, sessionId);
  if (pattern.machine !== context.paths.machine) throw new CoreError(409, 'machine_unavailable', 'The child CLI must be on the requesting machine.');
  const target = await readState(context, parseUnitId(pattern.unitId));
  if (!target || headerValue(target.bytes, 'removed') === 'true') throw new CoreError(404, 'unit_not_found', 'The child unit is not registered.');
  if (headerValue(target.bytes, 'machine') !== pattern.machine) throw new CoreError(409, 'machine_unavailable', 'The child unit belongs to another machine.');
  if (context.adapters?.[pattern.client]?.capabilities?.create !== true) throw new CoreError(503, 'client_unavailable', 'The requested CLI is not connected.');
  return target;
}

function normalizeFile(pattern) {
  const resource = typeof pattern.resource === 'string' ? pattern.resource : '';
  const filePath = normalizeRelative(pattern.path);
  const exact = resource.length > 0 && resource.length <= 240 && filePath !== null;
  return { action: 'file.write', pattern: { resource, path: filePath ?? String(pattern.path ?? '') }, exact, alwaysAllowed: exact, desktopOnly: false };
}

function normalizeNetwork(pattern) {
  const method = typeof pattern.method === 'string' ? pattern.method.toUpperCase() : '';
  let origin = '';
  try {
    const url = new URL(pattern.origin);
    origin = url.origin;
    if (url.origin !== pattern.origin && url.origin !== String(pattern.origin).replace(/\/$/, '')) origin = '';
  } catch {
    origin = '';
  }
  const urlPath = typeof pattern.path === 'string' && pattern.path.startsWith('/') && !pattern.path.includes('..') && !/[?*]/.test(pattern.path) ? pattern.path : '';
  const exact = METHODS.has(method) && origin.length > 0 && urlPath.length > 0;
  return { action: 'network.request', pattern: { method, origin, path: urlPath || String(pattern.path ?? '') }, exact, alwaysAllowed: exact, desktopOnly: false };
}

function normalizeRelative(value) {
  if (typeof value !== 'string' || value.length < 1) return null;
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..') || /[?*]/.test(normalized)) return null;
  return normalized;
}

function projectApproval(source, state = null) {
  const request = source?.request ?? source;
  const answers = source?.answers ?? [];
  const answerBytes = source?.answerBytes ?? [];
  const requestBytes = source?.requestBytes ?? jsonBytes(request);
  const result = source?.result ?? null;
  const resultBytes = source?.resultBytes ?? (result ? jsonBytes(result) : null);
  const resolvedState = state ?? result?.state ?? (answers.length > 0 ? 'answering' : 'pending');
  const selected = result?.answerId
    ? answers.find((item) => item.id === result.answerId) ?? null
    : (resolvedState === 'answering' ? [...answers].sort(byArrival).at(-1) ?? null : null);
  return {
    format: request.format,
    id: request.id,
    unitId: request.unitId,
    sessionId: request.sessionId,
    chatId: request.chatId,
    action: request.action,
    pattern: request.pattern,
    display: request.display,
    alwaysAllowed: request.alwaysAllowed,
    desktopOnly: classifyApprovalAction(request.action, request.pattern).desktopOnly,
    requestedAt: request.requestedAt,
    expiresAt: request.expiresAt,
    state: resolvedState,
    revision: approvalRevision({ request: requestBytes, answers: answerBytes, result: resultBytes }),
    answer: selected,
    grantId: result?.grantId ?? null,
    answerOutcomes: source?.outcomes ?? [],
  };
}

function ownedEvent(context, loaded, name, approval) {
  const unitId = loaded?.request?.unitId ?? approval.unitId;
  return {
    name,
    unitId,
    data: { approval },
  };
}

function noticeBytes(context, parsed, approvalId, display) {
  return Buffer.from(`id: ${randomUUID()}\nfrom: ${parsed.unit}\nfrom-id: ${parsed.id}\nto-id: root:master\nkind: approval-notice\nresource-id: ${approvalId}\nnotice-key: ${approvalId}:root:master\ntimestamp: ${stamp(context)}\n\n${display}\n`);
}

function noticePath(chatId, approvalId) {
  return `user/relay/chats/${chatId}/notices/${approvalId}.md`;
}

function answerPath(approvalId, answerId) {
  return `user/relay/approvals/${approvalId}/answers/${answerId}.json`;
}

function grantsOf(bytes) {
  const raw = headerValue(bytes, 'approvals');
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function headerValue(bytes, name) {
  const text = bytes.toString('utf8');
  const end = text.search(/\r?\n\r?\n/);
  for (const line of text.slice(0, end < 0 ? text.length : end).split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    if (line.slice(0, colon).trim() === name) return line.slice(colon + 1).trim();
  }
  return '';
}

function isOwner(context, binding) {
  return binding?.machine === context.paths.machine;
}

function assertMaster(context) {
  if (context.principal?.unitId !== 'root:master') throw new CoreError(403, 'forbidden', 'Only master can decide.');
}

function byArrival(left, right) {
  const delta = Date.parse(left.at) - Date.parse(right.at);
  if (delta !== 0) return delta;
  return left.id < right.id ? -1 : 1;
}

function freshGrantId(ids) {
  let id = randomUUID();
  while (ids.has(id)) id = randomUUID();
  return id;
}

function stamp(context) {
  return new Date(context.now()).toISOString();
}

function jsonBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`);
}

function asBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : canonicalJson(value));
}

function absolute(context, relative) {
  return path.join(context.paths.mind, ...relative.split('/'));
}
