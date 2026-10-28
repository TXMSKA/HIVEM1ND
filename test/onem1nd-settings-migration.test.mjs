import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse as parseToml } from 'smol-toml';
import { migrate } from '../migrations/3.0.0-onem1nd.mjs';
import { buildClientConfig, clientConfigPaths } from '../engine/relay/config.mjs';
import { hashContent, writeMachineRecord } from '../engine/records.mjs';
import { servicePaths, mindKeyFor } from '../engine/service/paths.mjs';
import { createStore } from '../engine/service/store.mjs';
import { createEventBus } from '../engine/service/events.mjs';
import { stubAclRunner } from '../engine/service/security.mjs';
import { createSettingsOwner, disconnectClientConfiguration, publishMachineSettings } from '../engine/service/settings.mjs';

const LEGACY = 'hivem1nd'; // Compatibility: representative Settings receipts and opaque user data from 3.0.0.
const encode = value => value === null ? null : Buffer.from(value).toString('base64');
const serverName = `${LEGACY}-relay`;

async function put(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, value);
}

function legacyMcp(client, source, secret) {
  if (client === 'codex') return `${source.replace('# ONEM1ND Relay managed server', `# ${LEGACY.toUpperCase()} Relay managed server`).replaceAll('[mcp_servers.onem1nd-relay]', `[mcp_servers.${serverName}]`)}\n[mcp_servers."${serverName}".env]\nAPI_TOKEN = ${JSON.stringify(secret)}\n`;
  const value = JSON.parse(source);
  value.mcpServers[serverName] = { ...value.mcpServers['onem1nd-relay'], env: { API_TOKEN: secret }, opaqueId: secret };
  delete value.mcpServers['onem1nd-relay'];
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function fixture(t) {
  const workspace = path.resolve('.work', 'settings-migration-tests');
  await mkdir(workspace, { recursive: true });
  const root = await mkdtemp(path.join(workspace, 'case-'));
  t.after(async () => {
    const relative = path.relative(workspace, root);
    assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    await rm(root, { recursive: true, force: true });
  });
  const cosmicPath = path.join(root, 'Cosmic'), homeDir = path.join(root, 'home');
  const source = path.join(cosmicPath, LEGACY), destination = path.join(cosmicPath, 'onem1nd');
  const machine = 'SETTINGS', platform = process.platform, oldLocal = path.join(cosmicPath, `${LEGACY}-service`, mindKeyFor(source, platform), machine);
  const kitPath = path.join(root, 'kit'), env = { PATH: '', HOME: homeDir, USERPROFILE: homeDir, LOCALAPPDATA: path.join(root, 'local'), APPDATA: path.join(root, 'roaming') };
  await put(path.join(source, 'user', 'VERSION'), '3.0.0\n');
  await put(path.join(source, 'cli', 'index.mjs'), 'export {};\n');
  await put(path.join(kitPath, 'package.json'), JSON.stringify({ name: 'fixture-kit', version: '3.0.0', files: ['engine/'] }));
  await put(path.join(kitPath, 'cli', 'index.mjs'), 'export {};\n');
  for (const adapter of ['claude-code', 'codex']) await put(path.join(kitPath, 'engine', 'adapters', `${adapter}.json`), await readFile(path.resolve('engine', 'adapters', `${adapter}.json`)));
  await writeMachineRecord(source, machine, { machine, mind: source, language: 'en', setup: 'done', agents: [{ name: 'claude-code', mode: 'auto' }, { name: 'codex', mode: 'auto' }], excluded: [], paths: [], managedFiles: {} });
  await put(path.join(oldLocal, 'config.json'), JSON.stringify({ format: `${LEGACY}-service-config-v1`, machine, mindPath: source, origin: { kind: 'folder', path: path.join(root, 'origin') }, stagingPath: path.join(oldLocal, 'staging'), startWithWindows: false }));
  const opaque = `opaque-${LEGACY}-${randomUUID()}`;
  const applied = { [`preview-${LEGACY}`]: { binding: `binding-${opaque}`, target: 'cli', reloadRequired: false, result: { state: 'connected', opaqueId: opaque } } };
  const ownership = { format: `${LEGACY}-client-configuration-v1`, machine, clients: {}, applied };
  const clients = [];
  for (const client of ['claude', 'codex']) {
    const paths = clientConfigPaths({ client, homeDir, env });
    const originalMcp = client === 'codex'
      ? `# Personal ${opaque}\nmodel = "personal"\n\n[mcp_servers.handwritten]\ncommand = "personal-server"\nargs = [${JSON.stringify(opaque)}]\n`
      : `${JSON.stringify({ note: opaque, mcpServers: { handwritten: { command: 'personal-server', env: { API_TOKEN: opaque } } } }, null, 2)}\n`;
    const event = client === 'claude' ? 'Stop' : 'SessionStart';
    const originalHooks = `${JSON.stringify({ note: opaque, hooks: { [event]: [{ hooks: [{ type: 'command', command: `echo ${opaque}` }] }] } }, null, 2)}\n`;
    const generated = buildClientConfig({ client, existing: { mcp: originalMcp, hooks: originalHooks }, mindPath: source, kitPath: source,
      nodePath: process.execPath, unit: `unit-${opaque}`, sessionId: `session-${opaque}`, platform });
    const oldMcp = legacyMcp(client, generated.mcp, opaque);
    const rules = path.join(homeDir, client === 'claude' ? '.claude' : '.codex', client === 'claude' ? 'CLAUDE.md' : 'AGENTS.md');
    const personalRule = `# Personal ${LEGACY.toUpperCase()} instructions ${opaque}\n`;
    const autoRule = `${LEGACY.toUpperCase()}: the mind is at ${source}. Read ${path.join(source, 'rules.md')} first, then the role or command asked for.\n`;
    const ownedRule = personalRule + autoRule, laterRule = `Keep later personal note ${opaque}.\n`;
    const skill = path.join(homeDir, '.agents', 'skills', `${client}-generated`, 'SKILL.md');
    const skillBytes = `---\nname: ${client}-generated\n---\n# ${LEGACY.toUpperCase()}\nRead ${source}/rules.md.\n`;
    const binary = path.join(homeDir, '.agents', 'skills', `${client}-generated`, 'asset.bin'), binaryBytes = Buffer.from([255, 0, 72, 73, 86, 69, 128]);
    const entry = (file, rootPath, kind, before, after) => ({ path: file, root: rootPath, kind, before: encode(before), after: encode(after) });
    ownership.clients[client] = { cli: { mode: 'auto', reloadRequired: false }, opaqueId: opaque, entries: [
      entry(paths.mcp, paths.mcpRoot, 'mcp', originalMcp, oldMcp),
      entry(paths.hooks, paths.hooksRoot, 'hooks', originalHooks, generated.hooks),
      entry(rules, path.dirname(rules), 'rule', personalRule, ownedRule),
      entry(skill, homeDir, 'feature', null, skillBytes),
      entry(binary, homeDir, 'feature', null, binaryBytes),
    ], assetHashes: { [rules]: hashContent(ownedRule), [skill]: hashContent(skillBytes), [binary]: hashContent(binaryBytes) } };
    for (const [file, content] of [[paths.mcp, oldMcp], [paths.hooks, generated.hooks], [rules, ownedRule + laterRule], [skill, skillBytes], [binary, binaryBytes]]) await put(file, content);
    clients.push({ client, paths, originalMcp, originalHooks, rules, expectedRules: personalRule + laterRule, skill, binary, binaryBytes });
  }
  const handwritten = path.join(homeDir, '.agents', 'skills', 'handwritten', 'SKILL.md');
  await put(handwritten, `# Personal ${LEGACY.toUpperCase()} skill ${opaque}\n`);
  await put(path.join(oldLocal, 'client-configuration.json'), `${JSON.stringify(ownership)}\n`);
  const options = { cosmicPath, homeDir, hostname: machine, platform, env, kitPath, shimDirectories: [], protectFile: async () => {}, stopService: async () => ({ stopped: true }), run: async () => assert.fail('No operating system registration should run for this fixture.') };
  const paths = servicePaths({ platform, env, home: homeDir, mindPath: destination, machine, cosmicPath });
  return { root, source, destination, homeDir, kitPath, env, machine, options, paths, clients, opaque, applied, handwritten };
}

async function assertMigrated(f) {
  const file = path.join(f.paths.localDirectory, 'client-configuration.json'), owner = JSON.parse(await readFile(file));
  assert.deepEqual(owner.applied, f.applied, 'stored preview IDs and bindings must retain their identity');
  for (const item of f.clients) {
    const config = item.client === 'codex' ? parseToml(await readFile(item.paths.mcp, 'utf8')).mcp_servers : JSON.parse(await readFile(item.paths.mcp)).mcpServers;
    assert.equal(config[serverName], undefined, 'the old generated server and every nested table must be removed');
    assert.ok(config['onem1nd-relay']);
    assert.equal(config['onem1nd-relay'].env.API_TOKEN, f.opaque, 'opaque credentials must never be rebranded');
    if (item.client === 'claude') assert.equal(config['onem1nd-relay'].opaqueId, f.opaque);
    assert.ok(config['onem1nd-relay'].args.includes(`unit-${f.opaque}`));
    assert.ok(config['onem1nd-relay'].args.includes(`session-${f.opaque}`));
    assert.ok(config['onem1nd-relay'].args.includes(f.destination));
    assert.ok(config['onem1nd-relay'].args.includes(path.join(f.kitPath, 'cli', 'index.mjs')));
    assert.ok(config.handwritten);
    assert.equal(owner.clients[item.client].opaqueId, f.opaque);
    assert.match(await readFile(item.rules, 'utf8'), /\nONEM1ND: the mind is at /);
    assert.ok((await readFile(item.rules, 'utf8')).startsWith(`# Personal ${LEGACY.toUpperCase()} instructions ${f.opaque}\n`));
    assert.equal(owner.clients[item.client].assetHashes[item.skill], hashContent(await readFile(item.skill)));
    assert.deepEqual(await readFile(item.binary), item.binaryBytes);
    assert.match(await readFile(item.skill, 'utf8'), /# ONEM1ND/);
  }
  return { file, owner };
}

test('3.0 Settings receipts migrate Claude and Codex twice and Disconnect restores personal files', async t => {
  const f = await fixture(t);
  assert.equal((await migrate(f.options)).migrated, true);
  const { file } = await assertMigrated(f), first = await readFile(file);
  assert.equal((await migrate(f.options)).migrated, false);
  assert.deepEqual(await readFile(file), first, 'a repeated upgrade must not duplicate ownership entries');
  const store = createStore({ root: f.root, confineRoot: f.root, mindPath: f.destination, localDirectory: f.paths.localDirectory, now: Date.now });
  store.aclRunner = stubAclRunner();
  const owner = createSettingsOwner({ store, paths: f.paths, homeDir: f.homeDir, kitPath: f.kitPath, env: f.env, now: Date.now,
    bus: createEventBus({ machine: f.machine, now: Date.now }), projects: [], probeAgents: async () => ({}) });
  const context = { ...owner, settingsOwner: owner };
  for (const item of f.clients) {
    const report = await publishMachineSettings(owner, 'agents');
    const result = await disconnectClientConfiguration(context, item.client, { machine: f.machine, confirmed: true, expectedRevision: report.agents.revision });
    assert.equal(result.state, 'disconnected');
    assert.equal(await readFile(item.paths.mcp, 'utf8'), item.originalMcp);
    assert.equal(await readFile(item.paths.hooks, 'utf8'), item.originalHooks);
    assert.equal(await readFile(item.rules, 'utf8'), item.expectedRules);
    await assert.rejects(readFile(item.skill), { code: 'ENOENT' });
    await assert.rejects(readFile(item.binary), { code: 'ENOENT' });
  }
  assert.deepEqual(JSON.parse(await readFile(file)).clients, {});
  assert.equal(await readFile(f.handwritten, 'utf8'), `# Personal ${LEGACY.toUpperCase()} skill ${f.opaque}\n`);
});

test('an interruption after Settings ownership is written resumes its original receipts once', async t => {
  const f = await fixture(t);
  let interrupted = false;
  await assert.rejects(migrate({ ...f.options, afterWrite: async file => {
    if (!interrupted && path.basename(file) === 'client-configuration.json') { interrupted = true; throw new Error('Settings ownership interruption'); }
  } }), /Settings ownership interruption/);
  assert.equal(await readFile(path.join(f.source, 'user', 'VERSION'), 'utf8'), '3.0.0\n');
  await migrate(f.options);
  const { file, owner } = await assertMigrated(f), first = await readFile(file);
  await migrate(f.options);
  assert.deepEqual(await readFile(file), first);
  for (const client of ['claude', 'codex']) assert.equal(owner.clients[client].entries.length, 5);
});
