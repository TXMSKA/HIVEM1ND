import { generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverAgents, discoverContent, discoverProjects, loadAdapters } from '../discovery.mjs';
import { OWNED_RULE_MODES, autoRuleLine, prepareContentAgentAssets } from '../install.mjs';
import { machineRecordPath, machineSettingsPath, readMachineRecord, serializeMachineRecord } from '../records.mjs';
import { parseRoutes } from '../relay/store.mjs';
import { CoreError, canonicalJson, hashBytes, isUuid, uuidV8, validateMachineName } from './identity.mjs';
import { answersFor, readProjection } from './projection.mjs';
import { assertNoLinks } from './paths.mjs';
import { atomicWrite, bindProjects, checkRevision, commitChange, prepareChangeUndo, readBytes, revisionOf, withLocalChanges, withLocks } from './store.mjs';
import { clusterEntry, clusterEvents, clusterOwner, mappingKey, prepareRepositoryClusters, rawClusters, readClusterMappings, resolveClusterLink } from './clusters.mjs';
import { directoryIdentity, pathKey, readRepositoryIdentity } from './cluster-git.mjs';
import { EVENT_NAMES, publishDomainEvents } from './events.mjs';
import { protectLocalFile } from './security.mjs';
import { probeClients, reloadReviewedClient } from './adapters.mjs';
import { launchBoundary, validateRunsIn } from './runs-in.mjs';
import { stateRunsIn } from './state.mjs';
import { configureOwnedService } from './install.mjs';
import { applyClientConfigChanges, buildClientConfig, clientConfigPaths, readConfigBytes, restoreClientConfig } from '../relay/config.mjs';

// The Settings contract is registered here so the existing bus also serves it.
for (const name of ['machine.settings.changed', 'settings.content.changed']) {
  if (!EVENT_NAMES.includes(name)) EVENT_NAMES.push(name);
}

const CONTENT_PATH = 'user/gui/content.json';
const SECTIONS = ['agents', 'permissions', 'projects', 'service'];
const DEFAULT_PREFERENCES = { addressStyle: 'impersonal', additionalInstructions: '', keepExistingPreferencesFirst: true, updateChecks: 'off' };
const CLIENT_IDS = { 'claude-code': 'claude', vscode: 'copilot' };

function fail(status, code, message) { throw new CoreError(status, code, message); }
function bytes(value) { return Buffer.from(`${canonicalJson(value)}\n`); }
function revision(value) { return hashBytes(bytes(value)); }
function stamp(context) { return new Date(context.now()).toISOString(); }

export async function connectedClients(context) {
  const reports = [];
  for (const [id, adapter] of Object.entries(context.adapters ?? context.settingsOwner?.adapters ?? {})) {
    const report = await Promise.resolve().then(() => adapter.describe?.({ localDirectory: context.paths?.localDirectory, store: context.store })).catch(() => null);
    if (!report || report.id !== id || report.connected !== true) continue;
    if (!['claude', 'codex', 'cursor', 'lyra'].includes(id) || !Array.isArray(report.models)) continue;
    const models = report.models.filter(model => text(model.id, 256) && model.id && text(model.title, 256)
      && Array.isArray(model.efforts) && model.efforts.every(value => text(value, 64))
      && Array.isArray(model.modes) && model.modes.every(value => ['fast', 'normal', 'thinking'].includes(value)))
      .slice(0, 256).map(model => ({ id: model.id, title: model.title, efforts: [...model.efforts], modes: [...model.modes] }));
    if (!models.length) continue;
    const known = id !== 'lyra' && report.quota?.known === true && Number.isFinite(report.quota.remainingPercent)
      && report.quota.remainingPercent >= 0 && report.quota.remainingPercent <= 100;
    const boundary = launchBoundary({ ...report, id, connected: true });
    reports.push({ id, title: text(report.title, 128) ? report.title : id, connected: true, models,
      quota: { remainingPercent: known ? report.quota.remainingPercent : null, period: known && text(report.quota.period, 128) ? report.quota.period : null, known },
      scopeEnforced: boundary === 'confined', boundary, context: { known: report.context?.known === true, compact: report.context?.compact === true } });
  }
  return reports;
}

export async function prepareDefaultRunsIn(context, choice) {
  if (context.principal?.audience !== 'desktop' || context.principal.capabilities && !context.principal.capabilities.includes('settings.write')) fail(403, 'forbidden', 'Changing the default requires Settings authority.');
  const clients = await connectedClients(context);
  validateRunsIn(choice, clients);
  if (!launchBoundary(clients.find(client => client.id === choice.client))) fail(409, 'scope_unavailable', 'The default needs a verified native boundary.');
  const file = path.join(context.paths.localDirectory, 'default-runs-in.json');
  await assertNoLinks(file);
  const before = await readBytes(context.store, file);
  return { resource: 'default-runs-in', recordPath: file, beforeRevision: revisionOf(before), afterBytes: bytes({ machine: context.paths.machine, runsIn: choice }), private: true };
}

export async function defaultRunsIn(context) {
  const file = path.join(context.paths.localDirectory, 'default-runs-in.json');
  await assertNoLinks(file);
  const source = await readBytes(context.store, file);
  const record = source ? JSON.parse(source) : null;
  if (!record) return null;
  if (record.machine !== context.paths.machine) fail(409, 'machine_unavailable', 'The default belongs to another machine.');
  return stateRunsIn(Buffer.from(`runs-in: ${canonicalJson(record.runsIn)}\n`));
}
function absolute(context, relative) { return path.join(context.paths.mind, ...relative.split('/')); }
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function exact(value, fields) {
  if (!plain(value)) fail(422, 'invalid_body', 'A Settings record must be an object.');
  if (Object.keys(value).some(key => !fields.includes(key))) fail(400, 'unknown_field', 'The Settings record contains an unknown field.');
}
function required(value, fields) {
  if (fields.some(key => !Object.hasOwn(value, key))) fail(422, 'invalid_body', 'A required Settings field is missing.');
}
function text(value, maximum = 4096) { return typeof value === 'string' && value.length <= maximum && !/[\u0000-\u001f]/.test(value); }
function byteRevision(value) { return value === null || typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }
function time(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)); }

async function json(context, relative) {
  const file = absolute(context, relative);
  await assertNoLinks(file, { root: context.paths.mind });
  const source = await readBytes(context.store, file);
  if (!source) return null;
  if (source.length > 1_000_000) fail(413, 'body_too_large', 'The Settings record is too large.');
  try { return JSON.parse(source); } catch { fail(422, 'corrupt_resource', 'The Settings record is not valid.'); }
}

export function createSettingsOwner(options) {
  return { ...options, now: options.now ?? (() => Date.now()),
    homeDir: options.homeDir ?? options.home ?? (options.store.confineRoot ? path.join(options.store.confineRoot, 'home') : os.homedir()),
    env: options.env ?? (options.store.confineRoot ? { PATH: '' } : process.env),
    kitPath: options.kitPath ?? fileURLToPath(new URL('../../', import.meta.url)),
    principal: { audience: 'desktop', unitId: 'root:master' }, key: null, active: true };
}

async function ownerKey(context) {
  if (context.key) return context.key;
  return withLocks(context.store, ['settings-owner-key'], async () => {
    if (context.key) return context.key;
    const file = path.join(context.paths.localDirectory, 'settings-owner-key.json');
    const previous = await readBytes(context.store, file);
    const key = previous ? JSON.parse(previous) : (() => {
      const pair = generateKeyPairSync('ed25519');
      return { publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
    })();
    if (!previous) await atomicWrite(context.store, file, bytes(key));
    await protectLocalFile(file, { store: context.store });
    context.key = key;
    return key;
  });
}

async function signed(context, record) {
  const key = await ownerKey(context);
  return { ...record, publicKey: key.publicKey, signature: sign(null, bytes(record), key.privateKey).toString('base64') };
}

function verifyRecord(record, publicKey = record?.publicKey) {
  if (!record || record.publicKey !== publicKey || typeof record.signature !== 'string') return false;
  const { publicKey: ignoredKey, signature, ...body } = record;
  try { return verify(null, bytes(body), publicKey, Buffer.from(signature, 'base64')); } catch { return false; }
}

function reportShape(record, machine) {
  exact(record, ['format', 'machine', 'reportedAt', 'service', 'locations', 'agents', 'permissions', 'projects', 'clusterLinks', 'discoveryOffer', 'connectedClients', 'publicKey', 'signature']);
  if (record.format !== 'hivem1nd-machine-settings-v1' || record.machine !== machine || !time(record.reportedAt) || !verifyRecord(record)) fail(422, 'corrupt_resource', 'The machine Settings report failed its integrity check.');
  exact(record.locations, ['mind', 'staging']);
  if (!text(record.locations.mind) || !text(record.locations.staging)) fail(422, 'corrupt_resource', 'The machine locations are not valid.');
  exact(record.service, ['machine', 'state', 'version', 'startedAt', 'startWithWindows', 'revision']);
  if (record.service.machine !== machine || !['running', 'stopped', 'unknown'].includes(record.service.state) || typeof record.service.startWithWindows !== 'boolean' || !byteRevision(record.service.revision)
    || record.service.version !== null && !text(record.service.version, 128) || record.service.startedAt !== null && !time(record.service.startedAt)) fail(422, 'corrupt_resource', 'The machine service report is not valid.');
  for (const section of ['agents', 'permissions', 'projects']) {
    const value = record[section];
    exact(value, section === 'agents' ? ['revision', 'items'] : section === 'permissions' ? ['revision', 'unitGrants', 'agentPermissions'] : ['revision', 'folders']);
    if (!byteRevision(value.revision)) fail(422, 'corrupt_resource', 'The report revision is not valid.');
  }
  if (!Array.isArray(record.agents.items) || record.agents.items.length > 64) fail(422, 'corrupt_resource', 'The agent list is not valid.');
  for (const item of record.agents.items) {
    exact(item, ['id', 'name', 'version', 'found', 'mode', 'cli', 'app', 'availability']);
    if (item.availability !== undefined && (item.id !== 'lyra' || !['granted', 'models-unavailable', 'lyra_pending', 'lyra_revoked', 'lyra_scopes_required', 'lyra_offline'].includes(item.availability))) fail(422, 'corrupt_resource', 'The local client availability is invalid.');
    exact(item.cli, ['state', 'changes']); exact(item.app, ['name', 'state']);
    if (!text(item.id, 128) || !text(item.name, 128) || item.version !== null && !text(item.version, 128) || typeof item.found !== 'boolean' || !['auto', 'on-demand'].includes(item.mode)
      || !['connected', 'changes-needed', 'missing'].includes(item.cli.state) || !Number.isInteger(item.cli.changes) || item.cli.changes < 0
      || !['connected', 'available', 'missing'].includes(item.app.state) || item.app.name !== null && !text(item.app.name, 128)) fail(422, 'corrupt_resource', 'An agent report is not valid.');
  }
  if (!Array.isArray(record.permissions.unitGrants) || !Array.isArray(record.permissions.agentPermissions) || !Array.isArray(record.projects.folders)) fail(422, 'corrupt_resource', 'The machine lists are not valid.');
  for (const item of record.permissions.unitGrants) {
    exact(item, ['unitId', 'grant']); exact(item.grant, ['id', 'action', 'pattern', 'grantedAt', 'grantedBy']);
    if (!text(item.unitId, 512) || !isUuid(item.grant.id) || !text(item.grant.action, 128) || !plain(item.grant.pattern) || !time(item.grant.grantedAt) || item.grant.grantedBy !== 'root:master') fail(422, 'corrupt_resource', 'A standing approval report is not valid.');
  }
  for (const permission of record.permissions.agentPermissions) {
    validateAgentPermission(permission, machine);
  }
  for (const folder of record.projects.folders) {
    exact(folder, ['id', 'path', 'environment', 'repositories']);
    if (!isUuid(folder.id) || !text(folder.path) || folder.environment !== null && !text(folder.environment, 128) || !Array.isArray(folder.repositories)) fail(422, 'corrupt_resource', 'A project folder is not valid.');
    for (const project of folder.repositories) {
      exact(project, ['id', 'title', 'path', 'registered', 'additionId', 'origin', 'pin']);
      if (!text(project.id, 128) || !text(project.title, 240) || !text(project.path) || typeof project.registered !== 'boolean') fail(422, 'corrupt_resource', 'A registered project is not valid.');
      if (project.additionId != null && !isUuid(project.additionId) || project.origin != null && !text(project.origin, 2048)) fail(422, 'corrupt_resource', 'The project provenance is not valid.');
      if (project.pin != null) {
        exact(project.pin, ['kind', 'value', 'digest']);
        if (!['commit', 'version', 'snapshot'].includes(project.pin.kind) || !text(project.pin.value, 128) || !/^[a-f0-9]{64}$/.test(project.pin.digest ?? '')) fail(422, 'corrupt_resource', 'The project pin is not valid.');
      }
      if (project.additionId && project.path !== `additions/repositories/${project.additionId}`) fail(422, 'corrupt_resource', 'An owned checkout path cannot enter the shared report.');
    }
  }
  // Grant payloads are projected by the approvals owner; reject local transport/configuration material at every depth.
  const forbidden = /^(?:secret|secrets|token|credential|credentials|authorization|endpoint|nativeSessionId|pid|pipe|beforeText|afterText|keptCopies|config|configuration|clipboard|privateKey)$/i;
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) { if (forbidden.test(key)) fail(422, 'corrupt_resource', 'A machine report contains private material.'); visit(item); }
  };
  visit(record.permissions);
  if (record.clusterLinks !== undefined) {
    if (!Array.isArray(record.clusterLinks)) fail(422, 'corrupt_resource', 'The cluster links report is not valid.');
    for (const link of record.clusterLinks) {
      exact(link, ['clusterId', 'title', 'kind', 'projectId', 'localPath', 'available']);
      if (!isUuid(link.clusterId) || !text(link.title, 240) || !['repository', 'folder', 'none'].includes(link.kind)
        || link.localPath !== null || typeof link.available !== 'boolean' || link.projectId !== null && !text(link.projectId, 128)) fail(422, 'corrupt_resource', 'An owner-local path cannot enter shared cluster metadata.');
    }
  }
  if (record.discoveryOffer != null) validatePublicOffer(record.discoveryOffer);
  if (record.connectedClients !== undefined && (!Array.isArray(record.connectedClients) || record.connectedClients.length > 4)) fail(422, 'corrupt_resource', 'The client capabilities are invalid.');
  for (const client of record.connectedClients ?? []) {
    exact(client, ['id', 'title', 'connected', 'models', 'quota', 'scopeEnforced', 'boundary', 'context']);
    exact(client.quota, ['remainingPercent', 'period', 'known']); exact(client.context, ['known', 'compact']);
    if (!['claude', 'codex', 'cursor', 'lyra'].includes(client.id) || !text(client.title, 128) || client.connected !== true
      || typeof client.scopeEnforced !== 'boolean' || client.boundary !== undefined && ![null, 'confined', 'supervised'].includes(client.boundary)
      || typeof client.context.known !== 'boolean' || typeof client.context.compact !== 'boolean'
      || !Array.isArray(client.models) || client.models.length > 256 || typeof client.quota.known !== 'boolean'
      || client.quota.remainingPercent !== null && (!Number.isFinite(client.quota.remainingPercent) || client.quota.remainingPercent < 0 || client.quota.remainingPercent > 100)
      || client.quota.period !== null && !text(client.quota.period, 128)) fail(422, 'corrupt_resource', 'The client capabilities are invalid.');
    for (const model of client.models) {
      exact(model, ['id', 'title', 'efforts', 'modes']);
      if (!text(model.id, 256) || !text(model.title, 256) || !Array.isArray(model.efforts) || !model.efforts.every(value => text(value, 64))
        || !Array.isArray(model.modes) || !model.modes.every(value => ['fast', 'normal', 'thinking'].includes(value))) fail(422, 'corrupt_resource', 'The model capability is invalid.');
    }
  }
  return record;
}

export async function readPublishedSettings(context, machine) {
  validateMachineName(machine);
  const record = await json(context, `user/machines/${machine}/settings.json`);
  return record ? reportShape(record, machine) : null;
}

async function machineOnline(context, machine) {
  if (machine === context.paths.machine) return context.settingsOwner?.active ?? context.active ?? true;
  const roots = [context.paths.origin && path.join(context.paths.origin, 'machines', machine, 'service.json'), absolute(context, `machines/${machine}/service.json`)];
  for (const file of roots.filter(Boolean)) {
    await assertNoLinks(file);
    const source = await readFile(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!source) continue;
    try { const beat = JSON.parse(source); if (beat.machine === machine && answersFor(beat, context.now())) return true; } catch { /* An invalid beat cannot authorize a mutation. */ }
  }
  return false;
}

function ownerOf(context) { return context.settingsOwner ?? context; }

function validateAgentPermission(permission, machine) {
  exact(permission, ['id', 'machine', 'client', 'actions', 'scope', 'grantedAt', 'grantedBy']);
  if (!isUuid(permission.id) || permission.machine !== machine || !text(permission.client, 128) || canonicalJson(permission.actions) !== canonicalJson(['git.commit', 'git.push'])
    || permission.scope !== 'hivem1nd-started-sessions' || !time(permission.grantedAt) || permission.grantedBy !== 'root:master') fail(422, 'corrupt_resource', 'An agent permission report is not valid.');
}

export async function readAgentPermissions(context) {
  const source = await readConfigBytes(path.join(context.paths.localDirectory, 'client-permissions.json'));
  if (!source) return [];
  let record;
  try { record = JSON.parse(source); } catch { fail(422, 'corrupt_resource', 'The local permission ledger is not valid.'); }
  exact(record, ['permissions']);
  if (!Array.isArray(record.permissions) || record.permissions.length > 64 || new Set(record.permissions.map(item => item?.id)).size !== record.permissions.length) fail(422, 'corrupt_resource', 'The local permission ledger is not valid.');
  for (const permission of record.permissions) validateAgentPermission(permission, context.paths.machine);
  return record.permissions;
}

async function revokeAgentPermission(context, id) {
  const file = path.join(context.paths.localDirectory, 'client-permissions.json');
  const original = await readConfigBytes(file);
  const permissions = await readAgentPermissions(context);
  if (!permissions.some(item => item.id === id)) fail(404, 'permission_not_found', 'The agent permission does not exist.');
  await configurationWrite(context, [{ path: file, root: context.paths.localDirectory, before: original, after: bytes({ permissions: permissions.filter(item => item.id !== id) }), internal: true }]);
  const report = await publishMachineSettings(context, 'permissions');
  return { status: 200, body: { permissionId: id, state: 'revoked', revision: report.permissions.revision } };
}

export async function publishMachineSettings(context, section = null) {
  context = ownerOf(context);
  return withLocks(context.store, [`settings-report-build:${context.paths.machine}`], () => publishOwnedSettings(context, section));
}

async function publishOwnedSettings(context, section) {
  const machine = context.paths.machine;
  const existing = await readPublishedSettings(context, machine);
  const { record: legacy } = await readMachineRecord(context.paths.mind, machine);
  const configSource = await readBytes(context.store, path.join(context.paths.localDirectory, 'config.json'));
  const config = configSource ? JSON.parse(configSource) : {};
  const folders = new Map();
  for (const project of context.projects ?? []) {
    if (!project.localPath || project.eligible === false) continue;
    const parent = project.additionId ? 'Owned repositories' : path.dirname(project.localPath);
    if (!folders.has(parent)) folders.set(parent, { id: uuidV8(['settings-folder', machine, parent]), path: parent, environment: project.environment ?? null, repositories: [] });
    folders.get(parent).repositories.push({ id: project.name, title: project.title ?? project.name, path: project.additionId ? `additions/repositories/${project.additionId}` : project.localPath,
      registered: true, additionId: project.additionId ?? null, origin: project.origin ?? null, pin: project.pin ?? null });
  }
  const view = await readProjection(context);
  const unitGrants = view.units.filter(unit => unit.machine === machine).flatMap(unit => (unit.approvalGrants ?? []).map(grant => ({ unitId: unit.id, grant })));
  const permissions = { unitGrants, agentPermissions: await readAgentPermissions(context) };
  const projects = { folders: [...folders.values()] };
  const links = await clusterLinks(context);
  const offer = await discoveryOffer(context);
  const contentRevision = revisionOf(await readBytes(context.store, absolute(context, CONTENT_PATH)));
  const refreshAgents = !existing || section === 'agents' || context.contentRevision !== contentRevision;
  context.contentRevision = contentRevision;
  const report = await signed(context, {
    format: 'hivem1nd-machine-settings-v1', machine, reportedAt: stamp(context),
    locations: { mind: context.paths.mind, staging: context.paths.staging },
    service: { machine, state: context.active === false ? 'stopped' : 'running', version: '3.0.0', startedAt: context.startedAt ?? stamp(context), startWithWindows: config.startWithWindows === true, revision: revisionOf(configSource) },
    agents: refreshAgents ? { revision: null, items: await agentItems(context, legacy) } : existing.agents,
    permissions: { ...permissions, revision: revision(permissions) }, projects: { ...projects, revision: revision(projects) },
    clusterLinks: links.map(link => ({ ...link, localPath: null })), discoveryOffer: publicOffer(offer),
    connectedClients: refreshAgents ? await connectedClients(context) : existing.connectedClients ?? [],
  });
  if (report.agents.revision === null) {
    report.agents.revision = revision(report.agents.items);
    const { publicKey, signature, ...unsigned } = report;
    Object.assign(report, await signed(context, unsigned));
  }
  reportShape(report, machine);
  const file = machineSettingsPath(context.paths.mind, machine);
  const previous = await readBytes(context.store, file);
  if (!previous?.equals(bytes(report))) await commitChange({ ...context, receipt: null }, { id: randomUUID(), entries: [{ resource: `settings-report:${machine}`, recordPath: file, beforeRevision: revisionOf(previous), afterBytes: bytes(report) }], events: [], body: null });
  for (const name of section ? [section] : SECTIONS) {
    if (!existing || canonicalJson(existing[name]) !== canonicalJson(report[name])) publishDomainEvents(context, [{ name: 'machine.settings.changed', data: { machine, section: name, reportedAt: report.reportedAt, revision: report[name].revision } }]);
  }
  return report;
}

async function agentItems(context, legacy) {
  const adapters = await loadAdapters({ kitPath: context.kitPath });
  const detected = await discoverAgents({ homeDir: context.homeDir, env: context.env, adapters });
  const probes = context.probeAgents ? await context.probeAgents() : await probeClients({ env: context.env, store: context.store, platform: context.paths.platform, spawnVersion: true, timeoutMs: 1500 });
  const content = await readContent(context);
  const foundSource = await readBytes(context.store, path.join(context.paths.localDirectory, 'settings-found-agents.json'));
  const foundPaths = foundSource ? JSON.parse(foundSource) : {};
  const connections = await clientOwnership(context);
  const items = await Promise.all(adapters.map(async adapter => {
    const id = CLIENT_IDS[adapter.id] ?? adapter.id;
    const foundState = foundPaths[adapter.id] ? await lstat(foundPaths[adapter.id]).catch(() => null) : null;
    const found = detected.some(item => item.id === adapter.id) || probes[id]?.installed === true || foundState?.isFile() === true;
    const mode = connections.clients[id]?.cli?.mode ?? (legacy?.agents.find(item => item.name === adapter.id || item.name === id)?.mode === 'auto' ? 'auto' : 'on-demand');
    let changes = 0;
    if (found) {
      const plan = await clientAssetPlan(context, adapter, mode, legacy, content, connections);
      changes = plan.items.filter(item => item.action !== 'unchanged').length + (plan.removals ?? []).length;
      const configPaths = clientConfigPaths({ client: id, homeDir: context.homeDir, env: context.env });
      const existing = {};
      for (const kind of ['mcp', 'hooks']) {
        if (!configPaths[kind]) continue;
        await assertNoLinks(configPaths[kind]);
        const state = await lstat(configPaths[kind]).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (state && (!state.isFile() || state.size > 1_000_000)) fail(422, 'invalid_path', 'The installed client configuration is unavailable.');
        existing[kind] = state ? await readFile(configPaths[kind], 'utf8') : '';
      }
      try {
        const proposed = buildClientConfig({ client: id, existing, kitPath: context.kitPath, mindPath: context.paths.mind, platform: context.paths.platform });
        changes += Object.keys(proposed).filter(kind => proposed[kind] !== existing[kind]).length;
      } catch { changes += Object.keys(existing).length || 1; }
    }
    const app = context.probeApps ? (await context.probeApps(id)) : null;
    return { id, name: id === 'copilot' ? 'GitHub Copilot' : adapter.displayName, version: probes[id]?.version ?? null, found, mode,
      cli: { state: !found ? 'missing' : changes ? 'changes-needed' : 'connected', changes },
      app: { name: app?.name ?? null, state: app?.connected === true ? 'connected' : app?.available === true ? 'available' : 'missing' } };
  }));
  const local = await (context.adapters?.lyra ?? context.settingsOwner?.adapters?.lyra)?.describe?.({ localDirectory: context.paths.localDirectory, store: context.store });
  const availability = local?.availability ?? (local?.connected ? 'granted' : 'lyra_offline');
  if (local) items.push({ id: 'lyra', name: 'Lyra', version: probes.lyra?.version ?? null, found: availability !== 'lyra_offline',
    mode: 'on-demand', availability, cli: { state: local.connected ? 'connected' : 'missing', changes: 0 },
    app: { name: 'Lyra', state: local.connected ? 'connected' : availability === 'lyra_offline' ? 'missing' : 'available' } });
  return items;
}

export async function readMachineSettings(context, machine = context.paths.machine, section = null) {
  validateMachineName(machine);
  const readOnly = !await machineOnline(context, machine);
  const report = machine === context.paths.machine ? await publishMachineSettings(context) : await readPublishedSettings(context, machine);
  const shared = await json(context, 'user/gui/settings.json') ?? { format: 'hivem1nd-settings-v1', look: 'modern', language: 'en' };
  const common = { machine, readOnly, reportedAt: report?.reportedAt ?? null };
  if (section === 'agents') return { ...common, revision: report?.agents.revision ?? null, items: report?.agents.items ?? [],
    connectedClients: report?.connectedClients ?? [], defaultRunsIn: machine === context.paths.machine ? await defaultRunsIn(context) : null };
  if (section === 'permissions') return { ...common, revision: report?.permissions.revision ?? null, unitGrants: report?.permissions.unitGrants ?? [], agentPermissions: report?.permissions.agentPermissions ?? [] };
  if (section === 'projects') return { ...common, revision: report?.projects.revision ?? null, folders: report?.projects.folders ?? [],
    clusterLinks: machine === context.paths.machine ? await clusterLinks(ownerOf(context)) : report?.clusterLinks ?? [],
    discoveryOffer: machine === context.paths.machine ? await discoveryOffer(ownerOf(context)) : report?.discoveryOffer ?? null };
  if (section) fail(422, 'invalid_body', 'The Settings section is not valid.');
  const settingsBytes = await readBytes(context.store, absolute(context, 'user/gui/settings.json'));
  return { settings: shared, revision: revisionOf(settingsBytes), selectedMachine: machine, readOnly, reportedAt: report?.reportedAt ?? null,
    service: report?.service ?? { machine, state: 'unknown', version: null, startedAt: null, startWithWindows: false, revision: null },
    locations: report?.locations ?? { mind: '', staging: '' } };
}

export async function scanAgents(context, input) {
  return mutateMachineSettings(context, 'scan', input);
}

export async function findAgent(context, input) {
  return mutateMachineSettings(context, 'find', input);
}

export function validateSettingsBody(operation, input) {
  const fields = { scan: ['machine'], find: ['machine', 'client', 'path'], preview: ['machine', 'mode', 'target', 'allowGit'], apply: ['machine', 'previewId', 'changeIds', 'expectedRevision'], disconnect: ['machine', 'confirmed', 'expectedRevision'], revoke: ['machine', 'expectedRevision'], folder: ['machine', 'path', 'environment', 'expectedRevision'], removeProject: ['machine', 'confirmed', 'expectedRevision'], service: ['machine', 'startWithWindows', 'expectedRevision'], restart: ['machine'] }[operation];
  if (!fields) fail(422, 'invalid_body', 'The Settings operation is not valid.');
  exact(input, fields); required(input, fields.filter(key => key !== 'allowGit'));
  validateMachineName(input.machine);
  if (Object.hasOwn(input, 'expectedRevision') && !byteRevision(input.expectedRevision)) fail(422, 'invalid_body', 'A byte revision is required.');
  if (['disconnect', 'revoke', 'removeProject'].includes(operation) && input.expectedRevision === null) fail(422, 'invalid_body', 'An existing byte revision is required.');
  if (Object.hasOwn(input, 'confirmed') && input.confirmed !== true) fail(422, 'invalid_body', 'Confirmation is required.');
  if (Object.hasOwn(input, 'path') && (!text(input.path) || !path.isAbsolute(input.path))) fail(422, 'invalid_path', 'An absolute installed path is required.');
  if (operation === 'find' && !text(input.client, 128)) fail(422, 'invalid_body', 'A known client is required.');
  if (operation === 'preview' && (!['auto', 'on-demand'].includes(input.mode) || !['cli', 'app'].includes(input.target) || Object.hasOwn(input, 'allowGit') && typeof input.allowGit !== 'boolean')) fail(422, 'invalid_body', 'The configuration choice is not valid.');
  if (operation === 'apply' && (!isUuid(input.previewId) || !Array.isArray(input.changeIds) || input.changeIds.length > 1024 || input.changeIds.some(id => !text(id, 256)) || new Set(input.changeIds).size !== input.changeIds.length)) fail(422, 'invalid_body', 'The selected preview changes are not valid.');
  if (operation === 'service' && typeof input.startWithWindows !== 'boolean') fail(422, 'invalid_body', 'Start with Windows must be boolean.');
  if (operation === 'folder' && input.environment !== null && !text(input.environment, 128)) fail(422, 'invalid_body', 'The environment is not valid.');
}

async function executeOwned(context, operation, input, id = null) {
  if (input.machine !== context.paths.machine || context.active === false) fail(409, 'machine_unavailable', 'The selected machine is unavailable.');
  if (['preview', 'apply', 'disconnect'].includes(operation)) {
    const adapters = await loadAdapters({ kitPath: context.kitPath });
    if (!adapters.some(adapter => (CLIENT_IDS[adapter.id] ?? adapter.id) === id)) fail(422, 'invalid_body', 'The client is not a known adapter.');
    if (!context.settingsHandlers?.[operation]) {
      if (operation === 'preview') return { status: 200, body: await previewClientConfiguration(context, id, input) };
      if (operation === 'apply') return { status: 200, body: await applyClientConfiguration(context, id, input) };
      return { status: 200, body: await disconnectClientConfiguration(context, id, input) };
    }
  }
  if (operation === 'scan' || operation === 'find') {
    if (operation === 'find') {
      const known = await loadAdapters({ kitPath: context.kitPath });
      const adapter = known.find(item => item.id === input.client || CLIENT_IDS[item.id] === input.client);
      if (!adapter) fail(422, 'invalid_body', 'The client is not a known adapter.');
      await assertNoLinks(input.path);
      const state = await lstat(input.path).catch(error => { if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) return null; throw error; });
      const base = path.basename(input.path).toLowerCase().replace(/\.(?:exe|cmd|bat|com)$/, '');
      if (!state?.isFile() || !(adapter.detect.binaries ?? []).some(name => name.toLowerCase() === base)) fail(422, 'invalid_path', 'The installed known client was not found.');
      // Finding a binary records its known directory; it never executes the submitted file.
      const file = path.join(context.paths.localDirectory, 'settings-found-agents.json');
      const saved = await readBytes(context.store, file);
      const found = saved ? JSON.parse(saved) : {};
      found[adapter.id] = input.path;
      await atomicWrite(context.store, file, bytes(found));
    }
    const { record } = await readMachineRecord(context.paths.mind, context.paths.machine);
    const report = await publishMachineSettings(context);
    const items = await agentItems(context, record);
    const { publicKey, signature, ...unsigned } = report;
    unsigned.agents = { revision: revision(items), items };
    const updated = await signed(context, unsigned);
    const file = machineSettingsPath(context.paths.mind, context.paths.machine);
    const source = await readBytes(context.store, file);
    if (!source?.equals(bytes(updated))) await commitChange({ ...context, receipt: null }, { id: randomUUID(), entries: [{ resource: `settings-report:${context.paths.machine}`, recordPath: file, beforeRevision: revisionOf(source), afterBytes: bytes(updated) }], events: [{ name: 'machine.settings.changed', data: { machine: context.paths.machine, section: 'agents', reportedAt: updated.reportedAt, revision: updated.agents.revision } }], body: null });
    return { status: 200, body: { machine: context.paths.machine, readOnly: false, reportedAt: updated.reportedAt, ...updated.agents } };
  }
  const section = ['preview', 'apply', 'disconnect'].includes(operation) ? 'agents' : operation === 'revoke' ? 'permissions' : ['folder', 'removeProject'].includes(operation) ? 'projects' : 'service';
  if (Object.hasOwn(input, 'expectedRevision')) {
    const report = await publishMachineSettings(context);
    if (report[section].revision !== input.expectedRevision) fail(409, 'revision_conflict', 'The selected machine Settings changed.');
  }
  if (operation === 'revoke') return revokeAgentPermission(context, id);
  const handler = context.settingsHandlers?.[operation];
  if (operation === 'service' && !handler) {
    await configureOwnedService({ ...context, platform: context.paths.platform, mindPath: context.paths.mind, cosmicPath: context.paths.cosmic,
      hostname: context.paths.machine, startWithWindows: input.startWithWindows, dryRun: false, configureOnly: true,
      aclRunner: context.store.aclRunner, run: context.serviceRunner, query: context.serviceQuery });
    return { status: 200, body: (await publishMachineSettings(context, 'service')).service };
  }
  if (!handler) fail(503, 'service_unavailable', operation === 'restart' ? 'Restart the service using the local host launcher.' : 'This Settings operation requires its owner configuration review.');
  const result = await handler({ context, input, id });
  await publishMachineSettings(context, section);
  return result?.body ? result : { status: operation === 'restart' ? 202 : 200, body: result };
}

function ownershipPath(context) { return path.join(context.paths.localDirectory, 'client-configuration.json'); }

async function clientOwnership(context) {
  const source = await readConfigBytes(ownershipPath(context));
  const record = source ? JSON.parse(source) : { format: 'hivem1nd-client-configuration-v1', machine: context.paths.machine, clients: {}, applied: {} };
  if (record.format !== 'hivem1nd-client-configuration-v1' || record.machine !== context.paths.machine) fail(409, 'configuration_changed', 'The local configuration ownership changed.');
  return record;
}

async function clientAssetPlan(context, adapter, mode, legacy, content, ownership) {
  const managedFiles = { ...legacy?.managedFiles };
  for (const client of Object.values(ownership.clients)) Object.assign(managedFiles, client.assetHashes);
  return prepareContentAgentAssets({ kitPath: context.kitPath, mindPath: context.paths.mind, homeDir: context.homeDir,
    env: context.env, adapters: [adapter], agents: [{ name: adapter.id, mode }], excluded: contentExclusions(content), managedFiles,
    keepExistingPreferences: content.preferences.keepExistingPreferencesFirst });
}

function assertConfigurationOwner(context, operation, input) {
  if (context.principal?.audience !== 'desktop') fail(403, 'forbidden', 'Only the desktop may review client configuration.');
  validateSettingsBody(operation, input);
  if (input.machine !== context.paths.machine || context.active === false) fail(409, 'machine_unavailable', 'Review configuration on its owning machine.');
}

export async function previewClientConfiguration(context, client, input) {
  assertConfigurationOwner(context, 'preview', input);
  const adapter = (await loadAdapters({ kitPath: context.kitPath })).find(item => (CLIENT_IDS[item.id] ?? item.id) === client);
  if (!adapter) fail(422, 'invalid_body', 'The client is not a known adapter.');
  const ownership = await clientOwnership(context);
  if (ownership.clients[client]) await restoredClientEntries(context, client, ownership.clients[client]);
  const ownerBytes = await readConfigBytes(ownershipPath(context));
  const { record: legacy } = await readMachineRecord(context.paths.mind, context.paths.machine);
  const content = await readContent(context);
  const paths = clientConfigPaths({ client, homeDir: context.homeDir, env: context.env });
  const existing = {}, snapshots = {};
  for (const kind of ['mcp', 'hooks']) if (paths[kind]) {
    snapshots[kind] = await readConfigBytes(paths[kind]);
    existing[kind] = snapshots[kind]?.toString('utf8') ?? '';
  }
  let proposed, owned;
  try {
    const options = { client, kitPath: context.kitPath, mindPath: context.paths.mind, platform: context.paths.platform };
    proposed = buildClientConfig({ ...options, existing });
    owned = buildClientConfig(options);
  } catch { fail(409, 'configuration_changed', 'The client configuration cannot be merged safely.'); }
  const changes = [];
  for (const kind of Object.keys(proposed)) {
    const after = Buffer.from(proposed[kind]);
    if (snapshots[kind]?.equals(after)) continue;
    changes.push({ id: kind, path: paths[kind], root: paths[`${kind}Root`], kind, before: snapshots[kind], after,
      description: kind === 'mcp' ? 'Add the Relay server, so sessions read and send messages' : 'Add the Relay hooks, so a session wakes when a message arrives',
      afterText: owned[kind], optional: false, selected: true });
  }
  if (input.target === 'cli') {
    const assets = await clientAssetPlan(context, adapter, input.mode, legacy, content, ownership);
    for (const item of [...assets.items.filter(item => item.action !== 'unchanged'), ...(assets.removals ?? []).map(item => ({ ...item, action: 'delete' }))]) {
      if (assets.conflicts.some(conflict => conflict.path === item.path) || item.linkComponent) fail(409, 'configuration_changed', 'An installed Content file has foreign changes; preserve it before reviewing again.');
      const before = await readConfigBytes(item.path);
      if (Object.hasOwn(item, 'currentHash') && revisionOf(before) !== item.currentHash) fail(409, 'configuration_changed', 'An installed Content file changed.');
      const after = item.action === 'delete' ? null : Buffer.from(item.content);
      changes.push({ id: `asset-${changes.length}`, path: item.path, root: item.root, kind: item.kind ?? 'asset', before, after,
        description: item.kind === 'rule' ? input.mode === 'auto' ? 'Load the M1ND rules in every session' : 'Stop loading the M1ND rules automatically' : item.action === 'delete' ? 'Remove owned Content no longer included' : 'Make included M1ND Content available on demand',
        afterText: item.kind === 'rule' && !OWNED_RULE_MODES.has(adapter.rules?.mode) ? input.mode === 'auto' ? `${autoRuleLine(context.paths.mind)}\n` : '' : after?.toString('utf8') ?? '', optional: false, selected: true });
    }
  }
  const permissionPath = path.join(context.paths.localDirectory, 'client-permissions.json');
  const permissionBytes = await readConfigBytes(permissionPath);
  const permissions = await readAgentPermissions(context);
  if (!permissions.some(item => item.client === client && item.machine === input.machine)) {
    const permission = { id: randomUUID(), machine: input.machine, client, actions: ['git.commit', 'git.push'], scope: 'hivem1nd-started-sessions', grantedAt: stamp(context), grantedBy: 'root:master' };
    changes.push({ id: 'git', path: permissionPath, root: context.paths.localDirectory, kind: 'permission', before: permissionBytes,
      after: bytes({ permissions: [...permissions, permission] }), afterText: canonicalJson(permission), description: 'Allow git commit and git push only in HIVEM1ND-started sessions on this machine', optional: true, selected: false });
  }
  const previewId = randomUUID();
  const revision = hashBytes(bytes(await agentItems(context, legacy)));
  const expiresAt = new Date(context.now() + 600000).toISOString();
  context.clientPreviews ??= new Map();
  for (const [key, preview] of context.clientPreviews) if (Date.parse(preview.expiresAt) <= context.now()) context.clientPreviews.delete(key);
  if (context.clientPreviews.size >= 64) context.clientPreviews.delete(context.clientPreviews.keys().next().value);
  const restartRequired = changes.some(change => !change.optional);
  context.clientPreviews.set(previewId, { machine: input.machine, client, mode: input.mode, target: input.target, changes, revision, expiresAt,
    ownerHash: revisionOf(ownerBytes), contentRevision: content.revision, restartRequired });
  return { previewId, revision, expiresAt, changes: changes.map(({ id, path, description, before, afterText, optional, selected }) => ({ id, path, description, beforeHash: revisionOf(before), afterText, optional, selected })), restartRequired };
}

function applicationBinding(client, input) { return canonicalJson({ client, machine: input.machine, changeIds: [...input.changeIds].sort(), expectedRevision: input.expectedRevision }); }

async function configurationWrite(context, changes) {
  return applyClientConfigChanges(changes, { protectFile: file => protectLocalFile(file, { store: context.store }), beforeWrite: context.configurationBeforeWrite });
}

export async function applyClientConfiguration(context, client, input) {
  assertConfigurationOwner(context, 'apply', input);
  const ownership = await clientOwnership(context);
  const binding = applicationBinding(client, input);
  const prior = ownership.applied[input.previewId];
  if (prior) {
    if (prior.binding !== binding) fail(409, 'configuration_changed', 'This preview was already applied with a different selection.');
    return finishClientApplication(context, client, input.previewId, ownership);
  }
  const preview = context.clientPreviews?.get(input.previewId);
  if (!preview || preview.client !== client || preview.machine !== input.machine || input.machine !== context.paths.machine || Date.parse(preview.expiresAt) <= context.now()) fail(409, 'configuration_changed', 'The configuration preview expired or belongs to another client or machine.');
  if (input.expectedRevision !== preview.revision) fail(409, 'revision_conflict', 'The selected machine Settings changed.');
  if (revisionOf(await readConfigBytes(ownershipPath(context))) !== preview.ownerHash || (await readContent(context)).revision !== preview.contentRevision) fail(409, 'configuration_changed', 'The reviewed configuration selection changed.');
  const selected = preview.changes.filter(change => input.changeIds.includes(change.id));
  if (selected.length !== input.changeIds.length) fail(422, 'invalid_body', 'A selected change does not belong to this preview.');
  for (const change of preview.changes) if (revisionOf(await readConfigBytes(change.path)) !== revisionOf(change.before)) fail(409, 'configuration_changed', 'The client configuration changed after review.');
  const { record: legacy } = await readMachineRecord(context.paths.mind, context.paths.machine);
  if (hashBytes(bytes(await agentItems(context, legacy))) !== preview.revision) fail(409, 'revision_conflict', 'The selected machine Settings changed.');
  if (selected.some(change => !change.optional)) await reloadReviewedClient(context, { client, target: preview.target, previewId: input.previewId, checkOnly: true });
  const original = await readConfigBytes(ownershipPath(context));
  const connection = ownership.clients[client] ?? { entries: [], assetHashes: {} };
  for (const change of selected) {
    connection.entries.push({ path: change.path, root: change.root, kind: change.kind, before: change.before?.toString('base64') ?? null, after: change.after?.toString('base64') ?? null });
    if (!['mcp', 'hooks', 'permission'].includes(change.kind)) {
      if (change.after === null) delete connection.assetHashes[change.path]; else connection.assetHashes[change.path] = hashBytes(change.after);
    }
  }
  if (!preview.changes.some(change => !change.optional) || selected.some(change => !change.optional)) connection[preview.target] = { mode: preview.mode, reloadRequired: preview.restartRequired };
  ownership.clients[client] = connection;
  ownership.applied[input.previewId] = { binding, target: preview.target, reloadRequired: selected.some(change => !change.optional), result: null, keptCopies: selected.length };
  await configurationWrite(context, [...selected, { path: ownershipPath(context), root: context.paths.localDirectory, before: original, after: bytes(ownership), internal: true }]);
  return finishClientApplication(context, client, input.previewId, ownership);
}

async function finishClientApplication(context, client, previewId, ownership) {
  const applied = ownership.applied[previewId];
  if (applied.result) return applied.result;
  if (applied.reloadRequired) await reloadReviewedClient(context, { client, target: applied.target, previewId, checkOnly: false });
  const report = await publishMachineSettings(context, 'agents');
  const result = { machine: context.paths.machine, client, state: 'connected', revision: report.agents.revision, keptCopies: applied.keptCopies };
  const original = await readConfigBytes(ownershipPath(context));
  applied.result = result;
  await configurationWrite(context, [{ path: ownershipPath(context), root: context.paths.localDirectory, before: original, after: bytes(ownership), internal: true }]);
  return result;
}

async function restoredClientEntries(context, client, connection) {
  const changes = new Map();
  for (const entry of [...connection.entries].reverse()) {
    const current = changes.has(entry.path) ? changes.get(entry.path).after : await readConfigBytes(entry.path);
    const decode = value => value === null ? null : Buffer.from(value, 'base64');
    let after;
    try {
      if (entry.kind === 'permission') {
        const beforePermissions = entry.before === null ? [] : JSON.parse(decode(entry.before)).permissions;
        const added = JSON.parse(decode(entry.after)).permissions.filter(item => !beforePermissions.some(previous => previous.id === item.id));
        const record = current ? JSON.parse(current) : { permissions: [] };
        for (const item of added) {
          const present = record.permissions.find(permission => permission.id === item.id);
          if (present && canonicalJson(present) !== canonicalJson(item)) fail(409, 'configuration_changed', 'An owned permission changed.');
        }
        record.permissions = record.permissions.filter(item => !added.some(permission => permission.id === item.id));
        after = entry.before === null && record.permissions.length === 0 ? null : bytes(record);
      } else after = restoreClientConfig({ client, kind: entry.kind, before: decode(entry.before), after: decode(entry.after), current });
    }
    catch { fail(409, 'configuration_changed', 'An owned configuration entry changed; Disconnect preserved the files.'); }
    const before = changes.has(entry.path) ? changes.get(entry.path).before : current;
    changes.set(entry.path, { path: entry.path, root: entry.root, before, after });
  }
  return changes;
}

export async function disconnectClientConfiguration(context, client, input) {
  assertConfigurationOwner(context, 'disconnect', input);
  const ownership = await clientOwnership(context);
  const report = await readPublishedSettings(context, input.machine);
  if (report?.agents.revision !== input.expectedRevision) fail(409, 'revision_conflict', 'The selected machine Settings changed.');
  const connection = ownership.clients[client];
  if (!connection) fail(409, 'configuration_changed', 'The client has no reviewed owned changes to restore.');
  const changes = await restoredClientEntries(context, client, connection);
  await reloadReviewedClient(context, { client, target: connection.app ? 'app' : 'cli', previewId: 'disconnect', checkOnly: true });
  const original = await readConfigBytes(ownershipPath(context));
  delete ownership.clients[client];
  await configurationWrite(context, [...changes.values(), { path: ownershipPath(context), root: context.paths.localDirectory, before: original, after: bytes(ownership), internal: true }]);
  await reloadReviewedClient(context, { client, target: connection.app ? 'app' : 'cli', previewId: 'disconnect', checkOnly: false });
  const updated = await publishMachineSettings(context, 'agents');
  return { machine: context.paths.machine, client, state: 'disconnected', revision: updated.agents.revision };
}

export async function mutateMachineSettings(context, operation, input, id = null) {
  if (context.principal?.audience !== 'desktop') fail(403, 'forbidden', 'Only the desktop may change Settings.');
  validateSettingsBody(operation, input);
  if (operation === 'preview' && !Object.hasOwn(input, 'allowGit')) input = { ...input, allowGit: false };
  if (!await machineOnline(context, input.machine)) fail(409, 'machine_unavailable', 'The selected machine is unavailable.');
  const owner = ownerOf(context);
  owner.adapters = context.adapters ?? owner.adapters;
  owner.ownedPids = context.ownedPids ?? owner.ownedPids;
  if (input.machine === context.paths.machine) return withLocks(context.store, [`settings-operation:${input.machine}`], () => executeOwned(owner, operation, input, id));
  const target = await readPublishedSettings(context, input.machine);
  if (!target) fail(409, 'machine_unavailable', 'The selected machine has no verified Settings report.');
  // Configuration text cannot travel through the shared-folder transport.
  if (operation === 'preview') fail(409, 'machine_unavailable', 'Open configuration review on the selected machine.');
  const requestId = uuidV8(['settings-request', context.paths.machine, context.receipt?.principalHash ?? 'desktop', context.receipt?.key ?? context.operationId ?? revision({ operation, input, id })]);
  const relative = `user/relay/settings-requests/${context.paths.machine}/${requestId}.json`;
  let request = await json(context, relative);
  if (!request) {
    request = await signed(owner, { format: 'hivem1nd-settings-request-v1', id: requestId, sourceMachine: context.paths.machine, targetMachine: input.machine, owner: 'root:master', operation, input, resourceId: id, createdAt: stamp(context), expiresAt: new Date(context.now() + 30000).toISOString(), targetKey: target.publicKey });
    await commitChange({ ...context, receipt: null }, { id: uuidV8(['settings-request-write', requestId]), entries: [{ resource: `settings-request:${requestId}`, recordPath: absolute(context, relative), beforeRevision: null, afterBytes: bytes(request) }], events: [], body: null });
  }
  const deadline = Date.now() + (owner.settingsTimeoutMs ?? 25000);
  do {
    const result = await json(context, `user/relay/settings-results/${input.machine}/${requestId}.json`);
    if (result) {
      if (!verifyRecord(result, target.publicKey) || result.requestHash !== revision(request) || result.targetMachine !== input.machine) fail(422, 'corrupt_resource', 'The Settings result does not match its owner request.');
      if (result.error) fail(result.status, result.error.code, result.error.message);
      return { status: result.status, body: result.body };
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  fail(409, 'machine_unavailable', 'The selected machine did not confirm the change; retry the same request.');
}

export async function processSettingsRequests(context) {
  context = ownerOf(context);
  const root = absolute(context, 'user/relay/settings-requests');
  await assertNoLinks(root, { root: context.paths.mind });
  const sources = await readdir(root, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  for (const source of sources) {
    if (!source.isDirectory() || source.isSymbolicLink()) continue;
    const names = await readdir(path.join(root, source.name));
    for (const name of names) {
      if (!name.endsWith('.json') || !isUuid(name.slice(0, -5))) continue;
      const request = await json(context, `user/relay/settings-requests/${source.name}/${name}`);
      if (request?.targetMachine !== context.paths.machine) continue;
      await withLocks(context.store, [`settings-request:${request.id}`, `settings-operation:${context.paths.machine}`], async () => {
        const sourceReport = await readPublishedSettings(context, source.name);
        const key = await ownerKey(context);
        if (!sourceReport || !verifyRecord(request, sourceReport.publicKey) || request.sourceMachine !== source.name || request.id !== name.slice(0, -5) || request.owner !== 'root:master' || request.targetKey !== key.publicKey) fail(403, 'forbidden', 'The Settings request has no authenticated owner binding.');
        const relative = `user/relay/settings-results/${context.paths.machine}/${request.id}.json`;
        const previous = await json(context, relative);
        if (previous) { if (previous.requestHash !== revision(request)) fail(409, 'revision_conflict', 'The Settings request changed.'); return; }
        let outcome;
        let error = null;
        try {
          if (!Number.isFinite(Date.parse(request.expiresAt)) || Date.parse(request.expiresAt) <= context.now() || Date.parse(request.createdAt) > context.now() + 30000) fail(409, 'machine_unavailable', 'The Settings request expired.');
          validateSettingsBody(request.operation, request.input);
          if (request.operation === 'preview') fail(409, 'machine_unavailable', 'Configuration review needs the selected local host.');
          outcome = await executeOwned(context, request.operation, request.input, request.resourceId);
        } catch (caught) {
          error = { code: caught instanceof CoreError ? caught.code : 'service_unavailable', message: 'The selected owner could not apply this Settings request.' };
          outcome = { status: caught instanceof CoreError ? caught.status : 503, body: null };
        }
        const result = await signed(context, { format: 'hivem1nd-settings-result-v1', id: request.id, targetMachine: context.paths.machine, requestHash: revision(request), status: outcome.status, body: outcome.body, error, reportedAt: stamp(context) });
        assertNoPrivateResult(result.body);
        await commitChange({ ...context, receipt: null }, { id: uuidV8(['settings-result', request.id]), entries: [{ resource: `settings-result:${request.id}`, recordPath: absolute(context, relative), beforeRevision: null, afterBytes: bytes(result) }], events: [], body: null });
      });
    }
  }
}

function assertNoPrivateResult(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:afterText|beforeText|secret|token|credential|endpoint|privateKey|clipboard|configuration|config|keptCopyBytes)$/i.test(key)) fail(422, 'invalid_pack', 'Private configuration material cannot be synchronized.');
    assertNoPrivateResult(item);
  }
}

export async function validateSettingsSyncRecord(sync, target, raw, machine, incoming = new Map()) {
  const file = target.path;
  const reportMatch = /^user\/machines\/([^/]+)\/settings\.json$/.exec(file);
  const requestMatch = /^user\/relay\/settings-requests\/([^/]+)\/([^/]+)\.json$/.exec(file);
  const resultMatch = /^user\/relay\/settings-results\/([^/]+)\/([^/]+)\.json$/.exec(file);
  if (!reportMatch && !requestMatch && !resultMatch) return;
  const owner = (reportMatch ?? requestMatch ?? resultMatch)[1];
  if (owner !== machine || !raw && !reportMatch) fail(422, 'invalid_record_owner', 'Only the owning machine may publish Settings records.');
  if (!raw) return;
  const record = JSON.parse(raw);
  if (reportMatch) { reportShape(record, owner); return; }
  const context = { ...sync, now: sync.now };
  const ownerPath = `user/machines/${owner}/settings.json`;
  const ownerReport = incoming.has(ownerPath) ? reportShape(JSON.parse(incoming.get(ownerPath)), owner) : await readPublishedSettings(context, owner);
  if (!ownerReport || !verifyRecord(record, ownerReport.publicKey)) fail(422, 'invalid_record_owner', 'The Settings record is not signed by its publishing owner.');
  if (requestMatch) {
    exact(record, ['format', 'id', 'sourceMachine', 'targetMachine', 'owner', 'operation', 'input', 'resourceId', 'createdAt', 'expiresAt', 'targetKey', 'publicKey', 'signature']);
    if (record.format !== 'hivem1nd-settings-request-v1' || record.id !== requestMatch[2] || record.sourceMachine !== owner || record.owner !== 'root:master' || record.input?.machine !== record.targetMachine) fail(422, 'invalid_record_owner', 'The Settings request binding is not valid.');
    validateSettingsBody(record.operation, record.input);
  } else {
    exact(record, ['format', 'id', 'targetMachine', 'requestHash', 'status', 'body', 'error', 'reportedAt', 'publicKey', 'signature']);
    if (record.format !== 'hivem1nd-settings-result-v1' || record.id !== resultMatch[2] || record.targetMachine !== owner || !byteRevision(record.requestHash)) fail(422, 'invalid_record_owner', 'The Settings result binding is not valid.');
    assertNoPrivateResult(record.body);
  }
}

function contentExclusions(content) {
  return [...content.features.filter(item => !item.included).map(item => item.id), ...content.knowledge.filter(item => !item.included).map(item => item.id)];
}

export async function readContent(context) {
  return withLocalChanges(context.store, () => readOwnedContent(context));
}

async function readOwnedContent(context) {
  const owner = ownerOf(context);
  const roots = [owner.kitPath ?? context.paths.mind, context.paths.mind, path.join(context.paths.mind, 'user')];
  const catalog = new Map();
  for (const root of [...new Set(roots)]) for (const item of await discoverContent(root)) catalog.set(item.id, item);
  const source = await readBytes(context.store, absolute(context, CONTENT_PATH));
  const saved = source ? JSON.parse(source) : null;
  const { record } = await readMachineRecord(context.paths.mind, context.paths.machine);
  const excluded = new Set(record?.excluded ?? []);
  const included = item => saved ? (item.type === 'feature' ? saved.includedFeatures : saved.includedKnowledge).includes(item.id) : !excluded.has(item.name) && !excluded.has(item.id) && !(item.type === 'knowledge' && excluded.has('knowledge'));
  const { readAdditionContent } = await import('./additions.mjs');
  const additions = (await readAdditionContent(context)).filter(item => item.kind !== 'repository');
  const imported = new Map(additions.map(item => [`${item.kind === 'skill' ? 'feature' : 'knowledge'}:${item.name}`, item]));
  const provenance = item => {
    const addition = imported.get(item.id);
    return { additionId: addition?.id ?? null, origin: addition?.source.display ?? null, pin: addition?.pin ?? null, scope: addition?.scope ?? null,
      unitCount: addition?.unitCount ?? 0, removable: Boolean(addition), revision: addition?.revision ?? null };
  };
  const visible = item => !imported.get(item.id)?.removed;
  return { revision: revisionOf(source),
    features: [...catalog.values()].filter(item => item.type === 'feature' && visible(item)).map(item => ({ id: item.id, title: item.name, category: ['planning', 'quality', 'continuity'].includes(item.category) ? item.category : 'other', included: included(item), ...provenance(item) })),
    knowledge: [...catalog.values()].filter(item => item.type === 'knowledge' && visible(item)).map(item => ({ id: item.id, title: item.name, included: included(item), ...provenance(item) })),
    preferences: saved?.preferences ?? { ...DEFAULT_PREFERENCES, keepExistingPreferencesFirst: record?.keepExistingPreferences !== false, updateChecks: record?.updateCheck === 'daily' ? 'daily' : 'off' } };
}

export async function writeContent(context, input) {
  if (context.principal?.audience !== 'desktop') fail(403, 'forbidden', 'Only the desktop may change Content.');
  exact(input, ['includedFeatures', 'includedKnowledge', 'preferences', 'expectedRevision']); required(input, ['includedFeatures', 'includedKnowledge', 'preferences', 'expectedRevision']);
  exact(input.preferences, Object.keys(DEFAULT_PREFERENCES)); required(input.preferences, Object.keys(DEFAULT_PREFERENCES));
  const preferences = input.preferences;
  if (!byteRevision(input.expectedRevision) || !['impersonal', 'formal', 'explanatory'].includes(preferences.addressStyle) || typeof preferences.additionalInstructions !== 'string' || preferences.additionalInstructions.length > 64000 || preferences.additionalInstructions.includes('\0') || typeof preferences.keepExistingPreferencesFirst !== 'boolean' || !['daily', 'off'].includes(preferences.updateChecks)) fail(422, 'invalid_body', 'The Content preferences are not valid.');
  return withLocks(context.store, ['settings-content-edit'], async () => {
    const content = await readContent(context);
    for (const [field, items] of [['includedFeatures', content.features], ['includedKnowledge', content.knowledge]]) {
      if (!Array.isArray(input[field]) || input[field].length > 1024 || new Set(input[field]).size !== input[field].length || input[field].some(id => !items.some(item => item.id === id))) fail(422, 'invalid_body', 'The included Content selection is not valid.');
    }
    const source = await readBytes(context.store, absolute(context, CONTENT_PATH));
    checkRevision(source, input.expectedRevision);
    const preferencePath = absolute(context, 'user/preferences.md');
    const previous = await readBytes(context.store, preferencePath);
    const saved = source ? JSON.parse(source) : null;
    let current = previous?.toString('utf8') ?? '';
    if (saved) {
      const oldBlock = preferenceBlock(saved.preferences);
      if (!current.includes(oldBlock)) fail(409, 'configuration_changed', 'The managed preference text changed.');
      const offset = saved.preferences.keepExistingPreferencesFirst ? current.lastIndexOf(oldBlock) : current.indexOf(oldBlock);
      current = current.slice(0, offset) + current.slice(offset + oldBlock.length);
    }
    const owned = preferenceBlock(preferences);
    const preferenceBytes = Buffer.from(preferences.keepExistingPreferencesFirst ? `${current}${current && !current.endsWith('\n') ? '\n' : ''}${owned}` : `${owned}${current}`);
    const record = { format: 'hivem1nd-content-settings-v1', includedFeatures: input.includedFeatures, includedKnowledge: input.includedKnowledge, preferences };
    const payload = bytes(record);
    const entries = [{ resource: 'settings-content', recordPath: absolute(context, CONTENT_PATH), beforeRevision: revisionOf(source), afterBytes: payload }, { resource: 'settings-preferences', recordPath: preferencePath, beforeRevision: revisionOf(previous), afterBytes: preferenceBytes }];
    await commitChange(context, { id: uuidV8(['settings-content', context.receipt?.key ?? stamp(context), revision(record)]), entries,
      events: [{ name: 'settings.content.changed', data: { revision: hashBytes(payload) } }], body: null });
    return readContent(context);
  });
}

function preferenceBlock(preferences) {
  return `<!-- HIVEM1ND Settings preferences -->\nAddress style: ${preferences.addressStyle}\nKeep existing preferences first: ${preferences.keepExistingPreferencesFirst ? 'yes' : 'no'}\nCheck for updates: ${preferences.updateChecks}\n\n${preferences.additionalInstructions}\n<!-- /HIVEM1ND Settings preferences -->\n`;
}

function replaceListSection(source, title, lines) {
  const pattern = new RegExp(`(^## ${title}\\r?\\n)([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm');
  if (!pattern.test(source)) return `${source}${source.endsWith('\n') || !source ? '' : '\n'}\n## ${title}\n${lines.join('\n')}\n`;
  return source.replace(pattern, (_match, header) => `${header}${lines.join('\n')}\n\n`);
}

// Plan the existing route, machine mapping and signed report together. Checkout
// bytes are owner-local and must already be verified before this plan commits.
export async function prepareAdditionProjects(context, additions, { checkOnly = false, remove = false } = {}) {
  const service = ownerOf(context), machine = context.paths.machine;
  const report = await readPublishedSettings(context, machine);
  if (!additions.length) return { entries: [], events: [], revision: report?.projects.revision ?? null };
  const routePath = absolute(context, 'user/routes.md'), routeBytes = await readBytes(context.store, routePath);
  const routes = parseRoutes(routeBytes?.toString('utf8') ?? '');
  const mappingPath = machineRecordPath(context.paths.mind, machine), mappingBytes = await readBytes(context.store, mappingPath);
  const { record: legacy } = await readMachineRecord(context.paths.mind, machine);
  const mappings = [...(legacy?.paths ?? [])], entries = [];
  for (const addition of additions) {
    const file = absolute(context, `user/projects/${addition.name}/product.json`);
    await assertNoLinks(file, { root: context.paths.mind });
    const before = await readBytes(context.store, file), product = before ? JSON.parse(before) : null;
    const owns = product?.additionId === addition.id;
    if (!owns && (before || routes.projects.some(project => project.name.toLowerCase() === addition.name.toLowerCase())
      || (context.projects ?? service.projects ?? []).some(project => project.name.toLowerCase() === addition.name.toLowerCase())
      || mappings.some(mapping => mapping.name.toLowerCase() === addition.name.toLowerCase()))) fail(409, 'name_conflict', 'The repository name already belongs to a registered project.');
    if (checkOnly) continue;
    const existing = mappings.findIndex(mapping => mapping.name === addition.name);
    if (remove) { if (existing >= 0) mappings.splice(existing, 1); }
    else {
      if (!path.isAbsolute(addition.localPath ?? '')) fail(422, 'invalid_path', 'The owned checkout has no verified local mapping.');
      await assertNoLinks(addition.localPath, { root: context.paths.localDirectory });
      const mapping = { name: addition.name, path: addition.localPath };
      if (existing >= 0) mappings[existing] = mapping; else mappings.push(mapping);
    }
    const after = bytes({ ...product, format: 'hivem1nd-product-v1', title: addition.title, additionId: addition.id, origin: addition.source.display, pin: addition.pin, removed: remove });
    entries.push({ resource: `addition-project:${addition.name}`, recordPath: file, beforeRevision: revisionOf(before), beforeBytes: before, afterBytes: after });
  }
  if (checkOnly) return { entries: [], events: [], revision: report?.projects.revision ?? null };
  const names = new Set(additions.map(item => item.name));
  const routeLines = (routeBytes?.toString('utf8').match(/^## Projects\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1] ?? '').trimEnd().split(/\r?\n/)
    .filter(line => ![...names].some(name => line.startsWith(`- ${name}`) && /^[\s(]|$/.test(line.slice(name.length + 2))));
  if (!remove) routeLines.push(...additions.map(item => `- ${item.name}`));
  const routeAfter = Buffer.from(replaceListSection(routeBytes?.toString('utf8') ?? '', 'Projects', routeLines.filter(Boolean)));
  const initialMachine = legacy ?? { machine, mind: context.paths.mind, setup: 'done', agents: [], paths: [], excluded: [] };
  const mappingAfter = Buffer.from(replaceListSection(mappingBytes?.toString('utf8') ?? serializeMachineRecord(initialMachine), 'Paths', mappings.map(item => `- ${item.name}: ${item.path}`)));
  entries.push({ resource: 'addition-project-routes', recordPath: routePath, beforeRevision: revisionOf(routeBytes), beforeBytes: routeBytes, afterBytes: routeAfter },
    { resource: `addition-project-mapping:${machine}`, recordPath: mappingPath, beforeRevision: revisionOf(mappingBytes), beforeBytes: mappingBytes, afterBytes: mappingAfter, private: true });
  const folders = (report?.projects.folders ?? []).map(folder => ({ ...folder, repositories: folder.repositories.filter(repository => !names.has(repository.id)) })).filter(folder => folder.repositories.length);
  if (!remove) {
    const folder = { id: uuidV8(['settings-folder', machine, 'Owned repositories']), path: 'Owned repositories', environment: null,
      repositories: additions.map(item => ({ id: item.name, title: item.title, path: `additions/repositories/${item.id}`, registered: true,
        additionId: item.id, origin: item.source.display, pin: item.pin })) };
    const existing = folders.find(item => item.id === folder.id);
    if (existing) existing.repositories.push(...folder.repositories); else folders.push(folder);
  }
  const clusterPlan = await prepareRepositoryClusters(context, additions.map(item => ({ ...item, additionId: item.id })), { remove });
  entries.push(...clusterPlan.entries);
  const projected = new Map((await clusterLinks(context)).map(item => [item.clusterId, { ...item, localPath: null }]));
  for (const cluster of clusterPlan.clusters) projected.set(cluster.id, { clusterId: cluster.id, title: cluster.title, kind: cluster.link.kind,
    projectId: cluster.link.projectId ?? null, localPath: null, available: true });
  for (const event of clusterPlan.events) if (event.name === 'cluster.changed' && event.data.cluster.deleted) projected.delete(event.data.cluster.id);
  const projects = { folders }, projectRevision = revision(projects);
  const base = report ? (({ publicKey, signature, ...body }) => body)(report) : {
    format: 'hivem1nd-machine-settings-v1', machine, locations: { mind: context.paths.mind, staging: context.paths.staging },
    service: { machine, state: 'running', version: '3.0.0', startedAt: stamp(context), startWithWindows: false, revision: null },
    agents: { revision: revision([]), items: [] }, permissions: { revision: revision({ unitGrants: [], agentPermissions: [] }), unitGrants: [], agentPermissions: [] } };
  const afterReport = await signed(service, { ...base, reportedAt: stamp(context), projects: { ...projects, revision: projectRevision }, clusterLinks: [...projected.values()] });
  reportShape(afterReport, machine);
  const reportPath = machineSettingsPath(context.paths.mind, machine), beforeReport = await readBytes(context.store, reportPath);
  entries.push({ resource: `settings-report:${machine}`, recordPath: reportPath, beforeRevision: revisionOf(beforeReport), beforeBytes: beforeReport, afterBytes: bytes(afterReport) });
  return { entries, clusters: clusterPlan.clusters, revision: projectRevision, events: [...clusterPlan.events, { name: 'machine.settings.changed', data: { machine, section: 'projects', reportedAt: afterReport.reportedAt, revision: projectRevision } }] };
}

export async function clusterLinks(context) {
  const mapping = await readClusterMappings(context);
  const links = [];
  for (const { cluster } of await rawClusters(context)) {
    if (cluster.deleted) continue;
    const local = mapping.record.links[mappingKey(cluster.link)];
    let available = false;
    if (local?.machine === context.paths.machine && local.localPath) {
      try { await resolveClusterLink(context, cluster.link, context.paths.machine); available = true; }
      catch (error) { if (!['cluster_changed', 'unsafe_path', 'machine_unavailable', 'ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error; }
    }
    links.push({ clusterId: cluster.id, title: cluster.title, kind: cluster.link.kind, projectId: cluster.link.projectId ?? null,
      localPath: local?.localPath ?? null, available });
  }
  return links;
}

function publicOffer(offer) {
  return offer ? { ...offer, groups: offer.groups.map(group => ({ ...group, path: null,
    repositories: group.repositories.map(repository => ({ ...repository, worktrees: repository.worktrees.map(tree => ({ ...tree, path: null })) })) })) } : null;
}
function validatePublicOffer(offer) {
  exact(offer, ['id', 'revision', 'groups', 'dismissed']);
  if (!isUuid(offer.id) || !byteRevision(offer.revision) || typeof offer.dismissed !== 'boolean' || !Array.isArray(offer.groups)) fail(422, 'corrupt_resource', 'The discovery report is not valid.');
  for (const group of offer.groups) {
    exact(group, ['id', 'title', 'path', 'repositories']);
    if (!text(group.id, 128) || !text(group.title, 240) || group.path !== null || !Array.isArray(group.repositories)) fail(422, 'corrupt_resource', 'A shared discovery folder contains a private path.');
    for (const repository of group.repositories) {
      exact(repository, ['id', 'name', 'projectId', 'remote', 'worktrees']);
      if (!text(repository.id, 128) || !text(repository.name, 240) || repository.remote !== null || repository.projectId !== null || !Array.isArray(repository.worktrees)) fail(422, 'corrupt_resource', 'A discovery repository is not valid.');
      for (const tree of repository.worktrees) {
        exact(tree, ['id', 'path', 'branch']);
        if (!isUuid(tree.id) || tree.path !== null || tree.branch !== null && !text(tree.branch, 512)) fail(422, 'corrupt_resource', 'A shared discovery worktree contains a private path.');
      }
    }
  }
}

async function offerRecord(context) {
  const file = path.join(context.paths.localDirectory, 'discovery-offer.json');
  await assertNoLinks(file, { root: context.paths.localDirectory });
  const source = await readBytes(context.store, file);
  return { file, bytes: source, record: source ? JSON.parse(source) : null };
}
function offerView(record) {
  const { repositories, format, machine, ...offer } = record;
  return { ...offer, revision: revision(record) };
}
export async function discoveryOffer(context) {
  return withLocalChanges(context.store, async () => {
    const saved = await offerRecord(context);
    if (saved.record) {
      if (saved.record.format !== 'hivem1nd-discovery-offer-v1' || saved.record.machine !== context.paths.machine) fail(409, 'cluster_changed', 'The discovery owner changed.');
      return offerView(saved.record);
    }
    const owner = ownerOf(context);
    const candidates = owner.discoveryRoots ?? [owner.homeDir ?? owner.home ?? os.homedir()];
    const roots = [];
    for (const candidate of candidates) {
      if (context.store.confineRoot) {
        const relative = path.relative(context.store.confineRoot, path.resolve(candidate));
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
      }
      const state = await lstat(candidate).catch(error => { if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) return null; throw error; });
      if (state?.isDirectory() && !state.isSymbolicLink()) roots.push(candidate);
    }
    const found = await discoverProjects(roots, { gitRunner: owner.gitRunner,
      skip: name => name.startsWith('.') || ['AppData', 'Library'].includes(name) });
    const accepted = (await readClusterMappings(context)).record.links;
    const groups = new Map(), repositories = [];
    for (const project of found) {
      if (Object.values(accepted).some(link => link.repositoryId === project.repositoryId || link.localPath && pathKey(link.localPath) === pathKey(project.path))
        || (context.projects ?? []).some(item => item.localPath && project.worktrees.some(tree => pathKey(tree.path) === pathKey(item.localPath)))) continue;
      const folder = path.dirname(project.path), id = uuidV8(['discovery-folder', pathKey(folder)]);
      if (!groups.has(id)) groups.set(id, { id, title: path.basename(folder), path: folder, repositories: [] });
      groups.get(id).repositories.push({ id: project.repositoryId, name: project.name, projectId: null, remote: null, worktrees: project.worktrees });
      repositories.push(project);
    }
    const record = { format: 'hivem1nd-discovery-offer-v1', machine: context.paths.machine, id: randomUUID(), groups: [...groups.values()], repositories, dismissed: false };
    await commitChange({ ...context, receipt: null }, { id: randomUUID(), entries: [{ resource: 'discovery-offer', recordPath: saved.file, beforeRevision: null, afterBytes: bytes(record), private: true }], events: [], response: { status: 200, body: null } });
    return offerView(record);
  });
}

export async function answerDiscoveryOffer(context, offerId, input) {
  clusterOwner(context, input?.machine, { write: true });
  exact(input, ['machine', 'repositoryIds', 'confirmed', 'expectedRevision']); required(input, ['machine', 'repositoryIds', 'confirmed', 'expectedRevision']);
  if (typeof input.confirmed !== 'boolean' || !Array.isArray(input.repositoryIds) || new Set(input.repositoryIds).size !== input.repositoryIds.length) fail(422, 'invalid_body', 'Select distinct canonical repositories.');
  return withLocalChanges(context.store, async () => {
    const saved = await offerRecord(context), record = saved.record;
    if (!record || record.id !== offerId) fail(404, 'discovery_not_found', 'The discovery offer does not exist.');
    if (record.dismissed || offerView(record).revision !== input.expectedRevision) fail(409, 'revision_conflict', 'The discovery offer changed.');
    if (input.repositoryIds.some(id => !record.repositories.some(project => project.repositoryId === id))) fail(422, 'invalid_body', 'Worktrees cannot be imported as repositories.');
    const selected = input.confirmed ? record.repositories.filter(project => input.repositoryIds.includes(project.repositoryId)) : [];
    const projects = [], used = new Set((context.projects ?? []).map(project => project.name.toLowerCase()));
    for (const project of selected) {
      const identity = await readRepositoryIdentity(project.path, ownerOf(context));
      if (identity.id !== project.repositoryId) fail(409, 'cluster_changed', 'A discovered repository changed before acceptance.');
      let name = project.name.replace(/[^A-Za-z0-9._-]/g, '-');
      if (!/^[A-Za-z0-9]/.test(name)) name = `repo-${name}`;
      name = name.slice(0, 80);
      if (used.has(name.toLowerCase())) name = `${name.slice(0, 64)}-${identity.id.slice(0, 8)}`;
      used.add(name.toLowerCase()); projects.push({ name, title: project.name, localPath: identity.path });
    }
    const prepared = await prepareRepositoryClusters(context, projects);
    const result = { clusters: prepared.clusters, dismissed: true };
    await commitChange(context, { id: randomUUID(), entries: [...prepared.entries, { resource: 'discovery-offer', recordPath: saved.file,
      beforeRevision: revisionOf(saved.bytes), beforeBytes: saved.bytes, afterBytes: bytes({ ...record, dismissed: true }), private: true }],
      events: prepared.events, response: { status: 200, body: result } });
    await refreshClusterProjects(context);
    return result;
  });
}

export async function refreshClusterProjects(context) {
  const owner = ownerOf(context), mapping = await readClusterMappings(context), records = await rawClusters(context);
  const active = new Set(records.filter(item => !item.cluster.deleted && item.cluster.link.kind === 'repository').map(item => item.cluster.link.projectId));
  const current = context.projects ?? owner.projects ?? [];
  const projects = [...current.filter(project => !project.clusterMapped || active.has(project.name))];
  for (const name of active) {
    const link = mapping.record.links[`repository:${name}`];
    if (!link?.localPath || link.machine !== context.paths.machine || projects.some(project => project.name === name)) continue;
    projects.push({ name, localPath: link.localPath, eligible: true, clusterMapped: true });
  }
  for (const target of new Set([context.projects, owner.projects, context.sync?.projects, owner.sync?.projects].filter(Array.isArray))) target.splice(0, target.length, ...projects);
  context.projects ??= projects; owner.projects ??= context.projects;
  bindProjects(context.store, context.projects);
}

export async function createClusterLink(context, input) {
  clusterOwner(context, input?.machine, { write: true });
  exact(input, ['machine', 'kind', 'path', 'expectedReportRevision']); required(input, ['machine', 'kind', 'path', 'expectedReportRevision']);
  if (!['repository', 'folder'].includes(input.kind) || !text(input.path) || !path.isAbsolute(input.path)) fail(422, 'invalid_link', 'Choose an absolute repository or folder.');
  return withLocalChanges(context.store, async () => {
    const report = await readPublishedSettings(context, input.machine);
    if (report?.projects.revision !== input.expectedReportRevision) fail(409, 'revision_conflict', 'The cluster links report changed.');
    await assertNoLinks(input.path);
    if (!(await lstat(input.path).catch(() => null))?.isDirectory()) fail(422, 'invalid_link', 'The linked folder does not exist.');
    const localPath = await realpath(input.path), mapping = await readClusterMappings(context);
    const identity = input.kind === 'repository' ? await readRepositoryIdentity(localPath, ownerOf(context)) : null;
    if (Object.values(mapping.record.links).some(link => identity ? link.repositoryId === identity.id : link.kind === 'folder' && link.localPath && pathKey(link.localPath) === pathKey(localPath))) fail(409, 'cluster_changed', 'The directory already has a canonical mapping.');
    const link = identity ? { kind: 'repository', projectId: `repo-${identity.id.slice(0, 8)}` } : { kind: 'folder', folderId: randomUUID() };
    mapping.record.links[mappingKey(link)] = { ...link, machine: input.machine, localPath, identity: await directoryIdentity(localPath), repositoryId: identity?.id ?? null, worktrees: identity?.worktrees ?? [] };
    const after = bytes(mapping.record), result = { link, revision: revisionOf(after) };
    await commitChange(context, { id: randomUUID(), entries: [{ resource: 'cluster-mappings', recordPath: mapping.file, beforeRevision: revisionOf(mapping.bytes), beforeBytes: mapping.bytes, afterBytes: after, private: true }], events: [], response: { status: 201, body: result } });
    return result;
  });
}

export async function removeClusterLink(context, clusterId, input) {
  clusterOwner(context, input?.machine, { write: true });
  exact(input, ['machine', 'confirmed', 'expectedRevision']); required(input, ['machine', 'confirmed', 'expectedRevision']);
  if (input.confirmed !== true) fail(422, 'confirmation_required', 'Removing a cluster link requires confirmation.');
  return withLocalChanges(context.store, async () => {
    const current = (await rawClusters(context)).find(item => item.cluster.id === clusterId && !item.cluster.deleted);
    if (!current) fail(404, 'cluster_not_found', 'The cluster does not exist.');
    checkRevision(current.bytes, input.expectedRevision);
    const view = await readProjection(context);
    if (view.sessions.some(session => current.cluster.members.includes(session.unitId) && session.state !== 'stopped')) fail(409, 'stop_unavailable', 'Stop the owned sessions before removing this link.');
    const after = bytes({ ...current.record, link: { kind: 'none' } }), cluster = { ...current.cluster, link: { kind: 'none' }, revision: revisionOf(after) };
    const entries = [clusterEntry(context, current.relative, current.bytes, after)], id = randomUUID();
    const undo = await prepareChangeUndo(context, { id, permission: 'settings.write', resourceIds: [clusterId], entries, events: clusterEvents(current.cluster) });
    const result = { clusterId, changeId: id, undoUntil: undo.undoUntil };
    await commitChange(context, { id, entries: [...entries, undo.entry], events: clusterEvents(cluster), response: { status: 200, body: result } });
    await refreshClusterProjects(context);
    return result;
  });
}
