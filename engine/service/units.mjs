import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CoreError, canonicalJson, hashBytes, parseUnitId, replaceHeader, unitStatePath, uuidV8, validateName, validateRole, canonicalScope } from './identity.mjs';
import { answersFor, readDetail, readProjection } from './projection.mjs';
import { readUnitState as readState, readUnitStates } from './state.mjs';
import { checkRevision, commitChange, commitTransaction, prepareChangeUndo, readBytes, revisionOf, withLocalChanges, withLocks, withReceipt } from './store.mjs';
import { prepareUnitMembershipRemoval, projectGroup } from './groups.mjs';
import { editChatMetadata, projectChatBytes } from './chats.mjs';
import { stopSession } from './adapters.mjs';
import { noteSync, openSync, stageTransaction } from '../sync/store.mjs';
import { clusterChoices, clusterEntry, clusterEvents, rawClusters, readCluster, resolveClusterLink } from './clusters.mjs';

export async function createUnit(context, input, options = {}) {
  if (input?.clusterId) input = await deriveClusterUnit(context, input);
  const run = () => createPrepared(context, input);
  if (!options.receipt) return run();
  return withReceipt(context.store, options.receipt, async (receipt) => {
    const prepared = await prepareCreate(context, input);
    return finish(context, prepared, { ...prepared.transaction, receipt });
  });
}

async function createPrepared(context, input) {
  const prepared = await prepareCreate(context, input);
  return finish(context, prepared, prepared.transaction);
}

export async function connectLead(context, unitId, input) {
  if (input?.confirmed !== true) throw new CoreError(422, 'invalid_body', 'Connecting a lead needs confirmation.');
  const parsed = parseUnitId(unitId);
  if (parsed.id === 'root:master' || parsed.role === 'master') {
    throw new CoreError(422, 'invalid_lead', 'Master cannot have a lead.');
  }
  const current = await readState(context, parsed);
  if (!current || header(current.bytes, 'removed') === 'true') throw new CoreError(404, 'unit_not_found', 'The unit does not exist.');
  if (header(current.bytes, 'role') === 'master' || parsed.unit === 'master') {
    throw new CoreError(422, 'invalid_lead', 'Master cannot have a lead.');
  }
  const leadId = input.leadId ?? null;
  if (leadId !== null) {
    const lead = parseUnitId(leadId);
    const leadState = await readState(context, lead);
    if (!leadState || header(leadState.bytes, 'removed') === 'true') throw new CoreError(422, 'invalid_lead', 'The lead does not exist.');
    assertNoCycle(parsed.id, lead.id, await leadMap(context));
  }
  let next = setHeader(current.bytes, 'lead-id', leadId);
  if (leadId) {
    const lead = parseUnitId(leadId);
    next = setHeader(next, 'lead', lead.unit);
  }
  const events = [
    { name: 'unit.changed', data: { unit: { id: parsed.id, leadId } } },
    { name: 'view.changed', data: { revision: hashBytes(next), collections: ['units', 'leads', 'squads'] } },
  ];
  return finish(context, {
    events,
    stage: [{ target: { kind: 'mind', path: current.relative }, bytes: next }],
  }, transactionOf(context, [{
    resource: current.relative,
    recordPath: current.absolute,
    beforeRevision: input.expectedRevision,
    afterBytes: next,
  }], events));
}

export async function setUnitAlias(context, unitId, input) {
  const parsed = parseUnitId(unitId);
  const current = await readState(context, parsed);
  if (!current || header(current.bytes, 'removed') === 'true') throw new CoreError(404, 'unit_not_found', 'The unit does not exist.');
  if (!Object.hasOwn(input ?? {}, 'alias')) throw new CoreError(422, 'invalid_body', 'An alias value is required.');
  const alias = input.alias === null ? '' : input.alias;
  if (typeof alias !== 'string' || alias.length > 128 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(alias)) {
    throw new CoreError(422, 'invalid_alias', 'The alias must be a single line of at most 128 characters.');
  }
  const next = replaceHeader(current.bytes, 'alias', alias.trim());
  const events = [
    { name: 'unit.changed', data: { unit: { id: parsed.id } } },
    { name: 'view.changed', data: { revision: hashBytes(next), collections: ['units', 'leads', 'squads'] } },
  ];
  return finish(context, {
    events,
    stage: [{ target: { kind: 'mind', path: current.relative }, bytes: next }],
  }, transactionOf(context, [{ resource: current.relative, recordPath: current.absolute,
    beforeRevision: input.expectedRevision, afterBytes: next }], events));
}

export async function removeUnit(context, unitId, input) {
  if (context.principal?.audience !== 'desktop' || context.principal.capabilities && !context.principal.capabilities.includes('unit.create')) {
    throw new CoreError(403, 'forbidden', 'Only the desktop can remove a unit.');
  }
  if (input?.confirmed !== true) throw new CoreError(422, 'confirmation_required', 'Removing a unit requires confirmation.');
  const parsed = parseUnitId(unitId);
  if (parsed.id === 'root:master') throw new CoreError(422, 'invalid_unit', 'Master cannot be removed.');
  return withLocks(context.store, [`launch:${parsed.id}`], () => withLocalChanges(context.store, async () => {
    const current = await readState(context, parsed);
    if (!current) throw new CoreError(404, 'unit_not_found', 'The unit does not exist.');
    if (header(current.bytes, 'role') === 'master') throw new CoreError(422, 'invalid_unit', 'Master cannot be removed.');
    const key = uuidV8(['unit-removal', parsed.id, context.receipt?.principalHash ?? null, context.receipt?.key ?? input.expectedRevision]);
    const journalPath = path.join(context.store.localDirectory, 'unit-removals', `${key}.json`);
    let journalBytes = await readBytes(context.store, journalPath);
    let journal = journalBytes ? JSON.parse(journalBytes) : null;
    if (journal?.phase === 'committed' && header(current.bytes, 'removed') === 'true') return journal.response;
    if (header(current.bytes, 'removed') === 'true') throw new CoreError(404, 'unit_not_found', 'The unit is archived.');
    checkRevision(current.bytes, input.expectedRevision);
    let view = await readProjection(context);
    if (view.units.some((unit) => unit.leadId === parsed.id)) throw new CoreError(409, 'unit_has_reports', 'Connect the surviving reports to another lead first.');
    let membership = await prepareUnitMembershipRemoval(context, parsed.id);
    const newJournal = !journal || journal.phase === 'committed';
    if (newJournal) {
      journal = { format: 'hivem1nd-unit-removal-v1', id: randomUUID(), unitId: parsed.id, expectedRevision: input.expectedRevision,
        phase: 'prepared', stoppedSessionIds: [], stoppingSessionId: null };
    }
    const journalEntry = (value) => ({ resource: `unit-removal:${key}`, recordPath: journalPath,
      beforeRevision: revisionOf(journalBytes), afterBytes: Buffer.from(`${canonicalJson(value)}\n`), private: true });
    const saveJournal = async (value) => {
      const entry = journalEntry(value);
      await commitTransaction(context.store, { id: randomUUID(), entries: [entry], events: [] });
      journalBytes = entry.afterBytes;
      journal = value;
    };
    if (newJournal) await saveJournal(journal);
    for (const session of view.sessions.filter((session) => session.unitId === parsed.id && session.state !== 'stopped')) {
      if (journal.stoppedSessionIds.includes(session.id)) continue;
      if (journal.phase === 'stopping') {
        // An interrupted native call is reconciled from its durable acknowledgment, never signaled again.
        const stopped = await readProjection(context);
        if (!stopped.sessions.some((item) => item.id === journal.stoppingSessionId && item.state === 'stopped')) {
          throw new CoreError(409, 'stop_unavailable', 'The interrupted stop has no verified acknowledgment.');
        }
      }
      await saveJournal({ ...journal, phase: 'stopping', stoppingSessionId: session.id });
      try {
        await stopSession(context, session.id, { confirmed: true, onAcknowledged: () => {
          const value = { ...journal, phase: 'prepared', stoppingSessionId: null, stoppedSessionIds: [...journal.stoppedSessionIds, session.id] };
          const entry = journalEntry(value);
          journal = value;
          journalBytes = entry.afterBytes;
          return [entry];
        } });
      } catch (error) {
        if (['remote_session', 'stop_unavailable', 'client_unavailable'].includes(error.code)) throw new CoreError(409, 'stop_unavailable', 'The running session could not be stopped safely.');
        throw error;
      }
      if (context.removalFault === 'after-stop') throw new CoreError(500, 'injected_crash', 'Injected crash after acknowledged stop.');
    }
    checkRevision((await readState(context, parsed))?.bytes, input.expectedRevision);
    view = await readProjection(context);
    if (view.units.some((unit) => unit.leadId === parsed.id)) throw new CoreError(409, 'unit_has_reports', 'Connect the surviving reports to another lead first.');
    membership = await prepareUnitMembershipRemoval(context, parsed.id);
    const unit = view.units.find((unit) => unit.id === parsed.id);
    const next = replaceHeader(current.bytes, 'removed', 'true');
    const entries = [{ resource: current.relative, recordPath: current.absolute, beforeRevision: input.expectedRevision, beforeBytes: current.bytes, afterBytes: next }, ...membership.entries];
    const archivedUnit = { ...unit, removed: true, revision: revisionOf(next), sessionIds: [] };
    const events = [{ name: 'unit.changed', data: { unit: archivedUnit } }, ...membership.events];
    const undoEvents = [{ name: 'unit.changed', data: { unit: { ...unit, sessionIds: [] } } }, ...membership.undoEvents];
    for (const chat of view.allChats.filter((chat) => chat.kind === 'direct' && !chat.archived && chat.members.includes(parsed.id))) {
      const relative = `user/relay/chats/${chat.id}/chat.md`;
      const beforeBytes = await readBytes(context.store, absolute(context, relative));
      const afterBytes = editChatMetadata(beforeBytes, { listed: false, archived: true });
      entries.push({ resource: relative, recordPath: absolute(context, relative), beforeRevision: revisionOf(beforeBytes), beforeBytes, afterBytes });
      events.push({ name: 'chat.changed', chatId: chat.id, data: { chat: projectChatBytes(afterBytes, chat.id, chat) } });
      undoEvents.push({ name: 'chat.changed', chatId: chat.id, data: { chat } });
    }
    const changed = { name: 'view.changed', data: { revision: revisionOf(next), collections: ['units', 'mailboxes', 'chats', 'groups', 'leads', 'squads'] } };
    events.push(changed);
    undoEvents.push({ ...changed, data: { ...changed.data, revision: unit.revision } });
    const undo = await prepareChangeUndo(context, { id: journal.id, permission: 'unit.create', resourceIds: [parsed.id], entries, events: undoEvents });
    const response = { unitId: parsed.id, changeId: journal.id, undoUntil: undo.undoUntil };
    await commitChange(context, { id: journal.id, entries: [...entries, undo.entry, journalEntry({ ...journal, phase: 'committed', response })],
      events, response: { status: 200, body: response } });
    return response;
  }));
}

export async function patchLayout(context, input) {
  const nodes = input?.nodes ?? null;
  const groups = input?.groups ?? null;
  if (!nodes && !groups) throw new CoreError(422, 'invalid_body', 'A layout patch needs a node or a group.');
  const current = await readJson(context, 'user/gui/layout.json');
  const layout = current.value ?? { format: 'hivem1nd-layout-v1', nodes: {}, groups: {} };
  const nextNodes = { ...(layout.nodes ?? {}) };
  const nextGroups = { ...(layout.groups ?? {}) };
  for (const [id, position] of Object.entries(nodes ?? {})) {
    parseUnitId(id);
    if (!(await readState(context, parseUnitId(id)))) throw new CoreError(422, 'unknown_unit', 'The layout names a unit that does not exist.');
    nextNodes[id] = { x: coordinate(position?.x), y: coordinate(position?.y) };
  }
  for (const [id, group] of Object.entries(groups ?? {})) {
    if (!/^(project|env):[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new CoreError(422, 'invalid_body', 'The group id is not canonical.');
    const prior = nextGroups[id] ?? {};
    nextGroups[id] = {
      ...prior,
      x: coordinate(group?.x),
      y: coordinate(group?.y),
      collapsed: Object.prototype.hasOwnProperty.call(group, 'collapsed') ? group.collapsed === true : prior.collapsed === true,
    };
  }
  const next = { ...layout, format: 'hivem1nd-layout-v1', nodes: nextNodes, groups: nextGroups };
  const bytes = Buffer.from(`${canonicalJson(next)}\n`);
  const events = [
    { name: 'layout.changed', data: { layout: next, revision: hashBytes(bytes) } },
    { name: 'view.changed', data: { revision: hashBytes(bytes), collections: ['units'] } },
  ];
  return finish(context, {
    events,
    stage: [{ target: { kind: 'mind', path: 'user/gui/layout.json' }, bytes }],
  }, transactionOf(context, [{
    resource: 'user/gui/layout.json',
    recordPath: absolute(context, 'user/gui/layout.json'),
    beforeRevision: input.expectedRevision ?? null,
    afterBytes: bytes,
  }], events));
}

export async function patchSettings(context, input) {
  const hasLook = Object.prototype.hasOwnProperty.call(input ?? {}, 'look');
  const hasLanguage = Object.prototype.hasOwnProperty.call(input ?? {}, 'language');
  const hasSendToAgent = Object.hasOwn(input ?? {}, 'sendToAgent');
  if (!hasLook && !hasLanguage && !hasSendToAgent) throw new CoreError(422, 'invalid_body', 'Settings need a look or a language.');
  if (hasLook && !['modern', 'high-contrast', 'nebula', 'txmska', 'coffee-cat', 'ntk'].includes(input.look)) throw new CoreError(422, 'invalid_body', 'The look is not supported.');
  if (hasLanguage && input.language !== 'en' && input.language !== 'es') throw new CoreError(422, 'invalid_body', 'The language is not supported.');
  if (hasSendToAgent && typeof input.sendToAgent !== 'boolean') throw new CoreError(422, 'invalid_body', 'Send to agent must be a boolean.');
  const current = await readJson(context, 'user/gui/settings.json');
  const settings = {
    ...(current.value ?? { format: 'hivem1nd-settings-v1', look: 'modern', language: 'en' }),
    format: 'hivem1nd-settings-v1',
  };
  if (hasLook) settings.look = input.look;
  if (hasLanguage) settings.language = input.language;
  settings.sendToAgent = hasSendToAgent ? input.sendToAgent : settings.sendToAgent ?? true;
  const bytes = Buffer.from(`${canonicalJson(settings)}\n`);
  const events = [{ name: 'settings.changed', data: { settings, revision: hashBytes(bytes) } }];
  return finish(context, {
    events,
    stage: [{ target: { kind: 'mind', path: 'user/gui/settings.json' }, bytes }],
  }, transactionOf(context, [{
    resource: 'user/gui/settings.json',
    recordPath: absolute(context, 'user/gui/settings.json'),
    beforeRevision: input.expectedRevision ?? null,
    afterBytes: bytes,
  }], events));
}

async function prepareCreate(context, input) {
  const unit = validateName(input?.unit, { label: 'unit', max: 80 });
  const role = validateRole(input?.role);
  const scope = canonicalScope(input?.scope);
  const machine = validateName(input?.machine, { label: 'machine', max: 48 });
  const id = parseUnitId(unitIdFor(unit, scope));
  if (role === 'master' || id.id === 'root:master') throw new CoreError(422, 'invalid_role', 'Master already exists.');
  const beat = await readBeat(context, machine);
  if (!answersFor(beat, context.now())) {
    throw new CoreError(409, 'machine_unavailable', 'The selected machine is not answering.', { machine, heartbeatAt: beat?.heartbeatAt ?? null });
  }
  const existing = await leadMap(context);
  if (existing.has(id.id)) {
    throw new CoreError(409, 'unit_exists', 'The unit already exists.');
  }
  if (role === 'overseer' && [...existing.values()].some((item) => item.role === 'overseer')) {
    throw new CoreError(409, 'overseer_exists', 'An Overseer already exists.');
  }
  const leadId = input.leadId ?? null;
  if (leadId !== null) {
    const lead = parseUnitId(leadId);
    if (!existing.has(lead.id)) {
      throw new CoreError(422, 'invalid_lead', 'The lead does not exist.');
    }
  }
  const position = input.position ? { x: coordinate(input.position.x), y: coordinate(input.position.y) } : { x: 0, y: 0 };
  const state = Buffer.from(renderState({ unit, id: id.id, role, scope, machine, leadId, job: input.job ?? null, model: input.model ?? null, clusterId: input.clusterId ?? null }));
  const layoutFile = await readJson(context, 'user/gui/layout.json');
  const layout = layoutFile.value ?? { format: 'hivem1nd-layout-v1', nodes: {}, groups: {} };
  layout.nodes = { ...(layout.nodes ?? {}), [id.id]: position };
  const layoutBytes = Buffer.from(`${canonicalJson({ ...layout, format: 'hivem1nd-layout-v1' })}\n`);
  const events = [
    { name: 'unit.changed', data: { unit: { id: id.id, unit, role, machine, leadId } } },
    { name: 'layout.changed', data: { layout: JSON.parse(layoutBytes.toString('utf8')), revision: hashBytes(layoutBytes) } },
    { name: 'view.changed', data: { revision: hashBytes(state), collections: ['units', 'leads', 'squads'] } },
  ];
  const relative = unitStatePath(id);
  const membership = input.clusterId ? await prepareClusterMembership(context, input.clusterId, id.id) : [];
  if (membership.length) events.push(...clusterEvents(projectGroup(membership[0].afterBytes, input.clusterId)),
    { name: 'chat.changed', chatId: input.clusterId, data: { chat: projectChatBytes(membership[1].afterBytes, input.clusterId) } });
  return {
    id: id.id,
    events,
    stage: [
      { target: { kind: 'mind', path: relative }, bytes: state },
      { target: { kind: 'mind', path: 'user/gui/layout.json' }, bytes: layoutBytes },
      ...membership.map(entry => ({ target: { kind: 'mind', path: entry.resource }, bytes: entry.afterBytes })),
    ],
    transaction: transactionOf(context, [
      { resource: relative, recordPath: absolute(context, relative), beforeRevision: null, afterBytes: state },
      { resource: 'user/gui/layout.json', recordPath: absolute(context, 'user/gui/layout.json'), beforeRevision: layoutFile.revision, afterBytes: layoutBytes },
      ...membership,
    ], events),
  };
}

async function finish(context, prepared, transaction) {
  return withLocalChanges(context.store, () => finishLocked(context, prepared, transaction));
}

async function finishLocked(context, prepared, transaction) {
  const leadId = prepared.events.find((event) => event.name === 'unit.changed')?.data?.unit?.leadId;
  if (leadId) {
    const lead = await readState(context, parseUnitId(leadId));
    if (!lead || header(lead.bytes, 'removed') === 'true') throw new CoreError(422, 'invalid_lead', 'The lead does not exist.');
  }
  const result = await commitTransaction(context.store, transaction);
  const sync = context.sync ?? openSync({ store: context.store, paths: context.paths, now: () => context.now() });
  const changes = await stageTransaction(sync, prepared.stage.map((entry) => ({
    ...entry,
    id: uuidV8(['unit-change', transaction.id, entry.target.kind, entry.target.path, hashBytes(entry.bytes)]),
  })), { transactionId: transaction.id });
  noteSync(context, changes.length ? 'pending' : 'local');
  if (context.pulse) {
    const published = await context.pulse.changed(changes.map((item) => item.id));
    if (published?.published === true) noteSync(context, 'published');
  }
  const projected = new Map();
  for (const event of prepared.events) {
    const id = event.name === 'unit.changed' ? event.data?.unit?.id : null;
    if (!id || projected.has(id)) continue;
    projected.set(id, await readDetail(context, 'units', id));
  }
  for (const event of prepared.events) {
    const id = event.name === 'unit.changed' ? event.data?.unit?.id : null;
    if (id && projected.has(id)) event.data = { unit: projected.get(id) };
    context.store.events.push(event);
    context.bus?.emit(event);
  }
  return { ...result, replayed: false, unit: [...projected.values()].at(-1) ?? null };
}

function transactionOf(context, entries, events) {
  return {
    id: randomUUID(),
    entries: entries.map((entry) => ({ ...entry, afterBytes: entry.afterBytes })),
    events: [],
    response: { status: 200, body: null },
  };
}

function renderState(fields) {
  const lines = [
    `unit: ${fields.unit}`,
    `unit-id: ${fields.id}`,
    `role: ${fields.role}`,
    `state: in`,
    `machine: ${fields.machine}`,
  ];
  if (fields.leadId) lines.push(`lead-id: ${fields.leadId}`);
  if (fields.job) lines.push(`job: ${fields.job}`);
  if (fields.model) lines.push(`model: ${fields.model}`);
  if (fields.clusterId) lines.push(`cluster-id: ${fields.clusterId}`);
  return `${lines.join('\n')}\n\nReady.\n`;
}

function unitIdFor(unit, scope) {
  if (scope.kind === 'root') return `root:${unit}`;
  if (scope.kind === 'environment') return `env:${scope.name}:${unit}`;
  return `project:${scope.name}:${unit}`;
}

export async function resolveUnitCluster(context, unitId) {
  const choice = await clusterChoices(context, unitId);
  if (choice.ambiguous) throw new CoreError(409, 'scope_unresolved', 'Choose a cluster explicitly before a write-capable launch.');
  return choice.clusterId;
}

async function deriveClusterUnit(context, input) {
  const cluster = await readCluster(context, input.clusterId, { machine: input.machine ?? context.paths.machine });
  if (!['executor', 'overlord'].includes(input.role)) throw new CoreError(422, 'invalid_role', 'A cluster agent is an Executor or Overlord.');
  const mapping = cluster.link.kind === 'none' ? null : await resolveClusterLink(context, cluster.link, context.paths.machine);
  const scope = cluster.link.kind === 'repository' ? { kind: 'project', name: mapping.projectId } : { kind: 'root' };
  const records = await readUnitStates(context), clusters = await rawClusters(context);
  const base = `${input.role}-${scope.name ?? cluster.id.slice(0, 8)}`.slice(0, 70);
  let unit = base, index = 2;
  while (records.some(record => record.id === unitIdFor(unit, scope))) unit = `${base}-${index++}`;
  let current = cluster, leadId = null;
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    leadId = records.find(record => current.members.includes(record.id) && header(record.bytes, 'role') === 'overlord' && header(record.bytes, 'removed') !== 'true')?.id ?? null;
    if (leadId) break;
    current = clusters.find(record => record.cluster.id === current.parentId)?.cluster;
  }
  leadId ??= records.find(record => header(record.bytes, 'role') === 'overseer' && header(record.bytes, 'removed') !== 'true')?.id ?? null;
  return { ...input, unit, scope, machine: context.paths.machine, leadId };
}

async function prepareClusterMembership(context, clusterId, unitId) {
  const current = (await rawClusters(context)).find(item => item.cluster.id === clusterId && !item.cluster.deleted);
  if (!current) throw new CoreError(409, 'cluster_changed', 'The cluster changed before creation.');
  if (current.cluster.members.length >= 255) throw new CoreError(422, 'invalid_members', 'A cluster can include at most 255 agents.');
  const relative = `user/relay/chats/${clusterId}/chat.md`, beforeChat = await readBytes(context.store, absolute(context, relative));
  if (revisionOf(beforeChat) !== current.record.chatRevision) throw new CoreError(409, 'chat_changed', 'The linked chat changed.');
  const members = [...current.cluster.members, unitId].sort(), afterChat = editChatMetadata(beforeChat, { members: ['root:master', ...members].sort() });
  const after = Buffer.from(`${canonicalJson({ ...current.record, members, chatRevision: revisionOf(afterChat) })}\n`);
  return [clusterEntry(context, current.relative, current.bytes, after), clusterEntry(context, relative, beforeChat, afterChat)];
}

async function readBeat(context, machine) {
  if (!context.paths?.origin) return null;
  try {
    return JSON.parse(await readFile(path.join(context.paths.origin, 'machines', machine, 'service.json'), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function leadMap(context) {
  const map = new Map();
  for (const { bytes, id } of await readUnitStates(context)) {
    map.set(id, { id, role: header(bytes, 'role'), leadId: header(bytes, 'lead-id') });
  }
  return map;
}

function assertNoCycle(unitId, leadId, map) {
  const seen = new Set([unitId]);
  let current = leadId;
  while (current) {
    if (seen.has(current)) throw new CoreError(409, 'lead_cycle', 'The lead chain would loop.');
    seen.add(current);
    current = map.get(current)?.leadId ?? null;
  }
}

async function readJson(context, relative) {
  const bytes = await readBytes(context.store, absolute(context, relative));
  if (!bytes) return { value: null, revision: null };
  return { value: JSON.parse(bytes.toString('utf8')), revision: revisionOf(bytes) };
}

function absolute(context, relative) {
  return path.join(context.paths.mind, ...relative.split('/'));
}

function coordinate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -100000 || value > 100000) {
    throw new CoreError(422, 'invalid_body', 'A layout coordinate must be a finite number from -100000 to 100000.');
  }
  return value;
}

function header(bytes, name) {
  const text = bytes.toString('utf8');
  const end = text.search(/\r?\n\r?\n/);
  const block = end >= 0 ? text.slice(0, end) : text;
  for (const line of block.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    if (line.slice(0, colon).trim() === name) return line.slice(colon + 1).trim();
  }
  return null;
}

function setHeader(bytes, name, value) {
  if (value === null) {
    const text = bytes.toString('utf8');
    const kept = text.split(/\r?\n/).filter((line) => !line.startsWith(`${name}:`));
    return Buffer.from(kept.join('\n'));
  }
  return replaceHeader(bytes, name, value);
}
