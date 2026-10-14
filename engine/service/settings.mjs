import { generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverAgents, discoverContent, loadAdapters } from '../discovery.mjs';
import { planAgentAssets } from '../install.mjs';
import { machineSettingsPath, readMachineRecord } from '../records.mjs';
import { CoreError, canonicalJson, hashBytes, isUuid, uuidV8, validateMachineName } from './identity.mjs';
import { answersFor, readProjection } from './projection.mjs';
import { assertNoLinks } from './paths.mjs';
import { atomicWrite, checkRevision, commitChange, readBytes, revisionOf, withLocks } from './store.mjs';
import { EVENT_NAMES, publishDomainEvents } from './events.mjs';
import { protectLocalFile } from './security.mjs';
import { probeClients } from './adapters.mjs';
import { configureOwnedService } from './install.mjs';
import { buildClientConfig, clientConfigPaths } from '../relay/config.mjs';

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
  exact(record, ['format', 'machine', 'reportedAt', 'service', 'locations', 'agents', 'permissions', 'projects', 'publicKey', 'signature']);
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
    exact(item, ['id', 'name', 'version', 'found', 'mode', 'cli', 'app']);
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
    exact(permission, ['id', 'machine', 'client', 'actions', 'scope', 'grantedAt', 'grantedBy']);
    if (!isUuid(permission.id) || permission.machine !== machine || !text(permission.client, 128) || canonicalJson(permission.actions) !== canonicalJson(['git.commit', 'git.push'])
      || permission.scope !== 'hivem1nd-started-sessions' || !time(permission.grantedAt) || permission.grantedBy !== 'root:master') fail(422, 'corrupt_resource', 'An agent permission report is not valid.');
  }
  for (const folder of record.projects.folders) {
    exact(folder, ['id', 'path', 'environment', 'repositories']);
    if (!isUuid(folder.id) || !text(folder.path) || folder.environment !== null && !text(folder.environment, 128) || !Array.isArray(folder.repositories)) fail(422, 'corrupt_resource', 'A project folder is not valid.');
    for (const project of folder.repositories) {
      exact(project, ['id', 'title', 'path', 'registered']);
      if (!text(project.id, 128) || !text(project.title, 240) || !text(project.path) || typeof project.registered !== 'boolean') fail(422, 'corrupt_resource', 'A registered project is not valid.');
    }
  }
  // Grant payloads are projected by the approvals owner; reject local transport/configuration material at every depth.
  const forbidden = /^(?:secret|secrets|token|credential|credentials|authorization|endpoint|nativeSessionId|pid|pipe|beforeText|afterText|keptCopies|config|configuration|clipboard|privateKey)$/i;
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) { if (forbidden.test(key)) fail(422, 'corrupt_resource', 'A machine report contains private material.'); visit(item); }
  };
  visit(record.permissions);
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
    const parent = path.dirname(project.localPath);
    if (!folders.has(parent)) folders.set(parent, { id: uuidV8(['settings-folder', machine, parent]), path: parent, environment: project.environment ?? null, repositories: [] });
    folders.get(parent).repositories.push({ id: project.name, title: project.title ?? project.name, path: project.localPath, registered: true });
  }
  const view = await readProjection(context);
  const unitGrants = view.units.filter(unit => unit.machine === machine).flatMap(unit => (unit.approvalGrants ?? []).map(grant => ({ unitId: unit.id, grant })));
  const permissions = { unitGrants, agentPermissions: existing?.permissions.agentPermissions ?? [] };
  const projects = { folders: [...folders.values()] };
  const contentRevision = revisionOf(await readBytes(context.store, absolute(context, CONTENT_PATH)));
  const refreshAgents = !existing || section === 'agents' || context.contentRevision !== contentRevision;
  context.contentRevision = contentRevision;
  const report = await signed(context, {
    format: 'hivem1nd-machine-settings-v1', machine, reportedAt: stamp(context),
    locations: { mind: context.paths.mind, staging: context.paths.staging },
    service: { machine, state: context.active === false ? 'stopped' : 'running', version: '3.0.0', startedAt: context.startedAt ?? stamp(context), startWithWindows: config.startWithWindows === true, revision: revisionOf(configSource) },
    agents: refreshAgents ? { revision: null, items: await agentItems(context, legacy) } : existing.agents,
    permissions: { ...permissions, revision: revision(permissions) }, projects: { ...projects, revision: revision(projects) },
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
  const probes = context.probeAgents ? await context.probeAgents() : await probeClients({ env: context.env, platform: context.paths.platform, spawnVersion: true, timeoutMs: 1500 });
  const content = await readContent(context);
  const excluded = contentExclusions(content);
  const foundSource = await readBytes(context.store, path.join(context.paths.localDirectory, 'settings-found-agents.json'));
  const foundPaths = foundSource ? JSON.parse(foundSource) : {};
  return Promise.all(adapters.map(async adapter => {
    const id = CLIENT_IDS[adapter.id] ?? adapter.id;
    const foundState = foundPaths[adapter.id] ? await lstat(foundPaths[adapter.id]).catch(() => null) : null;
    const found = detected.some(item => item.id === adapter.id) || probes[id]?.installed === true || foundState?.isFile() === true;
    const mode = legacy?.agents.find(item => item.name === adapter.id || item.name === id)?.mode === 'auto' ? 'auto' : 'on-demand';
    let changes = 0;
    if (found) {
      const plan = await planAgentAssets({ kitPath: context.kitPath, mindPath: context.paths.mind, homeDir: context.homeDir, env: context.env, adapters: [adapter], agents: [{ name: adapter.id, mode }], excluded, managedFiles: legacy?.managedFiles ?? {}, keepExistingPreferences: content.preferences.keepExistingPreferencesFirst });
      changes = plan.items.filter(item => item.action !== 'unchanged').length;
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
}

export async function readMachineSettings(context, machine = context.paths.machine, section = null) {
  validateMachineName(machine);
  const readOnly = !await machineOnline(context, machine);
  const report = machine === context.paths.machine ? await publishMachineSettings(context) : await readPublishedSettings(context, machine);
  const shared = await json(context, 'user/gui/settings.json') ?? { format: 'hivem1nd-settings-v1', look: 'modern', language: 'en' };
  const common = { machine, readOnly, reportedAt: report?.reportedAt ?? null };
  if (section === 'agents') return { ...common, revision: report?.agents.revision ?? null, items: report?.agents.items ?? [] };
  if (section === 'permissions') return { ...common, revision: report?.permissions.revision ?? null, unitGrants: report?.permissions.unitGrants ?? [], agentPermissions: report?.permissions.agentPermissions ?? [] };
  if (section === 'projects') return { ...common, revision: report?.projects.revision ?? null, folders: report?.projects.folders ?? [] };
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

export async function mutateMachineSettings(context, operation, input, id = null) {
  if (context.principal?.audience !== 'desktop') fail(403, 'forbidden', 'Only the desktop may change Settings.');
  validateSettingsBody(operation, input);
  if (operation === 'preview' && !Object.hasOwn(input, 'allowGit')) input = { ...input, allowGit: false };
  if (!await machineOnline(context, input.machine)) fail(409, 'machine_unavailable', 'The selected machine is unavailable.');
  const owner = ownerOf(context);
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
  if (owner !== machine || !raw) fail(422, 'invalid_record_owner', 'Only the owning machine may publish Settings records.');
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
  const owner = ownerOf(context);
  const roots = [owner.kitPath ?? context.paths.mind, context.paths.mind, path.join(context.paths.mind, 'user')];
  const catalog = new Map();
  for (const root of [...new Set(roots)]) for (const item of await discoverContent(root)) catalog.set(item.id, item);
  const source = await readBytes(context.store, absolute(context, CONTENT_PATH));
  const saved = source ? JSON.parse(source) : null;
  const { record } = await readMachineRecord(context.paths.mind, context.paths.machine);
  const excluded = new Set(record?.excluded ?? []);
  const included = item => saved ? (item.type === 'feature' ? saved.includedFeatures : saved.includedKnowledge).includes(item.id) : !excluded.has(item.name) && !excluded.has(item.id) && !(item.type === 'knowledge' && excluded.has('knowledge'));
  return { revision: revisionOf(source),
    features: [...catalog.values()].filter(item => item.type === 'feature').map(item => ({ id: item.id, title: item.name, category: ['planning', 'quality', 'continuity'].includes(item.category) ? item.category : 'other', included: included(item) })),
    knowledge: [...catalog.values()].filter(item => item.type === 'knowledge').map(item => ({ id: item.id, title: item.name, included: included(item) })),
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
