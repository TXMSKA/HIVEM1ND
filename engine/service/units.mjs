import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CoreError, canonicalJson, hashBytes, parseUnitId, replaceHeader, unitStatePath, validateName, validateRole, canonicalScope } from './identity.mjs';
import { answersFor } from './projection.mjs';
import { commitTransaction, readBytes, revisionOf, withReceipt } from './store.mjs';
import { openSync, stageTransaction } from '../sync/store.mjs';

export async function createUnit(context, input, options = {}) {
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
  if (!current) throw new CoreError(404, 'unit_not_found', 'The unit does not exist.');
  if (header(current.bytes, 'role') === 'master' || parsed.unit === 'master') {
    throw new CoreError(422, 'invalid_lead', 'Master cannot have a lead.');
  }
  const leadId = input.leadId ?? null;
  if (leadId !== null) {
    const lead = parseUnitId(leadId);
    const leadState = await readState(context, lead);
    if (!leadState) throw new CoreError(422, 'invalid_lead', 'The lead does not exist.');
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
  if (!hasLook && !hasLanguage) throw new CoreError(422, 'invalid_body', 'Settings need a look or a language.');
  if (hasLook && input.look !== 'modern' && input.look !== 'high-contrast') throw new CoreError(422, 'invalid_body', 'The look is not supported.');
  if (hasLanguage && input.language !== 'en' && input.language !== 'es') throw new CoreError(422, 'invalid_body', 'The language is not supported.');
  const current = await readJson(context, 'user/gui/settings.json');
  const settings = {
    ...(current.value ?? { format: 'hivem1nd-settings-v1', look: 'modern', language: 'en' }),
    format: 'hivem1nd-settings-v1',
  };
  if (hasLook) settings.look = input.look;
  if (hasLanguage) settings.language = input.language;
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
  const state = Buffer.from(renderState({ unit, id: id.id, role, scope, machine, leadId, job: input.job ?? null, model: input.model ?? null }));
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
  return {
    id: id.id,
    events,
    stage: [
      { target: { kind: 'mind', path: relative }, bytes: state },
      { target: { kind: 'mind', path: 'user/gui/layout.json' }, bytes: layoutBytes },
    ],
    transaction: transactionOf(context, [
      { resource: relative, recordPath: absolute(context, relative), beforeRevision: null, afterBytes: state },
      { resource: 'user/gui/layout.json', recordPath: absolute(context, 'user/gui/layout.json'), beforeRevision: layoutFile.revision, afterBytes: layoutBytes },
    ], events),
  };
}

async function finish(context, prepared, transaction) {
  const result = await commitTransaction(context.store, transaction);
  const sync = openSync({ store: context.store, paths: context.paths, now: () => context.now() });
  await stageTransaction(sync, prepared.stage);
  for (const event of prepared.events) {
    context.store.events.push(event);
    context.bus?.emit(event);
  }
  return { ...result, replayed: false };
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
  return `${lines.join('\n')}\n\nReady.\n`;
}

function unitIdFor(unit, scope) {
  if (scope.kind === 'root') return `root:${unit}`;
  if (scope.kind === 'environment') return `env:${scope.name}:${unit}`;
  return `project:${scope.name}:${unit}`;
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
  for (const relative of await stateFiles(context)) {
    const bytes = await readBytes(context.store, absolute(context, relative));
    if (!bytes) continue;
    const id = header(bytes, 'unit-id');
    if (!id || map.has(id)) continue;
    map.set(id, { id, role: header(bytes, 'role'), leadId: header(bytes, 'lead-id') });
  }
  return map;
}

async function stateFiles(context) {
  const relatives = [];
  const addDir = async (relativeDir) => {
    const directory = path.join(context.paths.mind, ...relativeDir.split('/'));
    let names = [];
    try {
      names = await readdir(directory);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const name of names) {
      if (!name.endsWith('.md') || name.includes('.conflict-')) continue;
      relatives.push(`${relativeDir}/${name}`);
    }
  };
  await addDir('user/state');
  for (const kind of ['environments', 'projects']) {
    const parent = path.join(context.paths.mind, 'user', kind);
    let children = [];
    try {
      children = await readdir(parent);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const child of children) await addDir(`user/${kind}/${child}/state`);
  }
  return relatives;
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

async function readState(context, parsed) {
  const relative = unitStatePath(parsed);
  const bytes = await readBytes(context.store, absolute(context, relative));
  if (bytes && header(bytes, 'unit-id') === parsed.id) return { bytes, relative, absolute: absolute(context, relative) };
  const legacy = `user/state/${parsed.unit}.md`;
  if (legacy === relative) return null;
  const old = await readBytes(context.store, absolute(context, legacy));
  if (!old || header(old, 'unit-id') !== parsed.id) return null;
  return { bytes: old, relative: legacy, absolute: absolute(context, legacy) };
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
