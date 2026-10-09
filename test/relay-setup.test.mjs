import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildClientConfig, diagnoseRelayClients, ensureRelayClients, relayEntryPresent } from '../engine/relay/config.mjs';
import { evolve } from '../engine/lifecycle.mjs';
import { createSetupSession } from '../engine/setup.mjs';
import { uninstall } from '../engine/uninstall.mjs';

const KIT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function fixture(context, executables) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-setup-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const homeDir = path.join(root, 'home');
  const mindPath = path.join(root, 'mind');
  await mkdir(bin, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  await mkdir(path.join(mindPath, 'user'), { recursive: true });
  for (const name of executables) await writeFile(path.join(bin, name), 'shim');
  return { root, homeDir, mindPath, env: { PATH: bin } };
}

const exists = (filePath) => access(filePath).then(() => true, () => false);
const statuses = (results) => Object.fromEntries(results.map((item) => [item.client, item.status]));

test('install configures each available client without a Relay entry, once, and reports every client', async (context) => {
  const { homeDir, mindPath, env } = await fixture(context, ['claude', 'codex']);
  const options = { homeDir, env, kitPath: mindPath, mindPath };

  const first = await ensureRelayClients(options);
  assert.deepEqual(statuses(first), {
    claude: 'configured', codex: 'configured', cursor: 'not-available', opencode: 'not-available', copilot: 'not-available', antigravity: 'not-available',
  });
  assert.deepEqual(first.filter((item) => item.restart).map((item) => item.client), ['claude', 'codex']);
  const claude = JSON.parse(await readFile(path.join(homeDir, '.claude.json'), 'utf8'));
  assert.deepEqual(claude.mcpServers['hivem1nd-relay'].args.slice(0, 5), [path.join(mindPath, 'cli', 'index.mjs'), 'relay', 'mcp', '--mind-path', mindPath]);
  assert.match(await readFile(path.join(homeDir, '.codex', 'config.toml'), 'utf8'), /\[mcp_servers\.hivem1nd-relay\]/);
  assert.equal(await exists(path.join(homeDir, '.cursor')), false);

  const before = await readFile(path.join(homeDir, '.claude', 'settings.json'), 'utf8');
  const second = await ensureRelayClients(options);
  assert.equal(statuses(second).claude, 'already-configured');
  assert.equal(statuses(second).codex, 'already-configured');
  assert.equal(second.some((item) => item.restart), false);
  assert.equal(await readFile(path.join(homeDir, '.claude', 'settings.json'), 'utf8'), before);
});

const cursorMcp = `${JSON.stringify({ mcpServers: { 'hivem1nd-relay': { type: 'stdio', command: 'node', args: ['C:/mind/cli/index.mjs', 'relay', 'mcp', '--mind-path', 'C:/mind', '--client', 'cursor'] } } }, null, 2)}\n`;

async function cursorFiles(homeDir, hooks) {
  const cursor = path.join(homeDir, '.cursor');
  await mkdir(cursor, { recursive: true });
  await writeFile(path.join(cursor, 'mcp.json'), cursorMcp);
  if (hooks !== undefined) await writeFile(path.join(cursor, 'hooks.json'), hooks);
  return { mcpFile: path.join(cursor, 'mcp.json'), hooksFile: path.join(cursor, 'hooks.json') };
}

test('a client that already has the Relay entry gets its stale Relay hooks updated in place and nothing else touched', async (context) => {
  const { homeDir, mindPath, env } = await fixture(context, ['cursor']);
  const foreign = { command: 'echo keep', timeout: 3 };
  const gate = { beforeShellExecution: [{ command: './scripts/check', timeout: 9 }] };
  const stale = { version: 1, hooks: { ...gate, stop: [foreign, { command: 'node C:/mind/cli/index.mjs relay hook --client cursor --event stop --mind-path C:/mind', timeout: 5 }] } };
  const { mcpFile, hooksFile } = await cursorFiles(homeDir, `${JSON.stringify(stale)}\n`);
  const intended = JSON.parse(buildClientConfig({ client: 'cursor', kitPath: mindPath, mindPath }).hooks).hooks;

  const results = await ensureRelayClients({ homeDir, env, kitPath: mindPath, mindPath });
  assert.equal(statuses(results).cursor, 'refreshed'); assert.equal(results.find((item) => item.client === 'cursor').restart, true);
  const hooks = JSON.parse(await readFile(hooksFile, 'utf8')).hooks;
  assert.deepEqual(hooks.stop[0], foreign); assert.deepEqual(hooks.beforeShellExecution, gate.beforeShellExecution);
  assert.deepEqual(hooks.stop[1], { command: intended.stop[0].command, timeout: 30, loop_limit: 5 });
  assert.deepEqual(Object.keys(hooks).sort(), ['beforeShellExecution', 'stop'], 'an event with no Relay entry gets none');
  assert.equal(await readFile(mcpFile, 'utf8'), cursorMcp);

  const refreshed = await readFile(hooksFile, 'utf8');
  assert.equal(statuses(await ensureRelayClients({ homeDir, env, kitPath: mindPath, mindPath })).cursor, 'already-configured');
  assert.equal(await readFile(hooksFile, 'utf8'), refreshed);
});

test('Relay hooks that are already current are left byte for byte, however they are formatted, and a missing hooks file is not created', async (context) => {
  const { homeDir, mindPath, env } = await fixture(context, ['cursor']);
  const current = buildClientConfig({ client: 'cursor', kitPath: mindPath, mindPath }).hooks;
  const reformatted = `${JSON.stringify(JSON.parse(current), null, 4)}\n`;
  const { hooksFile } = await cursorFiles(homeDir, reformatted);
  assert.equal(statuses(await ensureRelayClients({ homeDir, env, kitPath: mindPath, mindPath })).cursor, 'already-configured');
  assert.equal(await readFile(hooksFile, 'utf8'), reformatted);

  await rm(hooksFile);
  assert.equal(statuses(await ensureRelayClients({ homeDir, env, kitPath: mindPath, mindPath })).cursor, 'already-configured');
  assert.equal(await exists(hooksFile), false);
});

test('stale Relay hooks of Claude Code and Codex are updated in place, and their foreign hooks stay', async (context) => {
  const { homeDir, mindPath, env } = await fixture(context, ['claude', 'codex']);
  const options = { homeDir, env, kitPath: mindPath, mindPath };
  await ensureRelayClients(options);
  const claudeFile = path.join(homeDir, '.claude', 'settings.json'), codexFile = path.join(homeDir, '.codex', 'hooks.json');
  const foreign = { type: 'command', command: 'echo keep', timeout: 3 };
  // Hooks that run an earlier kit, with a hook of the person's own beside them.
  const earlier = (client) => {
    const document = JSON.parse(buildClientConfig({ client, kitPath: path.join(homeDir, 'old-kit'), mindPath }).hooks);
    document.hooks.SessionStart.push({ hooks: [foreign] });
    return `${JSON.stringify(document, null, 2)}\n`;
  };
  await writeFile(claudeFile, earlier('claude')); await writeFile(codexFile, earlier('codex'));

  const results = await ensureRelayClients(options);
  assert.equal(statuses(results).claude, 'refreshed'); assert.equal(statuses(results).codex, 'refreshed');
  for (const [client, file] of [['claude', claudeFile], ['codex', codexFile]]) {
    const document = JSON.parse(await readFile(file, 'utf8'));
    const current = JSON.parse(buildClientConfig({ client, kitPath: mindPath, mindPath }).hooks);
    assert.deepEqual(document.hooks.SessionStart[0], current.hooks.SessionStart[0], client);
    assert.deepEqual(document.hooks.SessionStart[1], { hooks: [foreign] }, client);
  }
  assert.equal(statuses(await ensureRelayClients(options)).claude, 'already-configured');
});

test('diagnose lists the shell and tool hooks Cursor did not get from Relay and warns about a plugin that is not supported here', async (context) => {
  const { homeDir, env } = await fixture(context, ['cursor']);
  const cursor = path.join(homeDir, '.cursor');
  const plugin = async (name, description, hooks) => {
    const root = path.join(cursor, 'plugins', 'cache', 'market', name, 'abc123');
    await mkdir(path.join(root, 'hooks'), { recursive: true }); await mkdir(path.join(root, '.cursor-plugin'), { recursive: true });
    await writeFile(path.join(root, 'hooks', 'hooks.json'), JSON.stringify({ version: 1, hooks }));
    await writeFile(path.join(root, '.cursor-plugin', 'plugin.json'), JSON.stringify({ name, description }));
    return path.join(root, 'hooks', 'hooks.json');
  };
  const secrets = await plugin('secrets', 'Checks env files. Not supported on Windows.', { beforeShellExecution: [{ command: './check' }] });
  await plugin('portable', 'Works everywhere.', { preToolUse: [{ command: './audit' }] });
  await plugin('quiet', 'Not supported on Windows.', { sessionStart: [{ command: './hello' }] });
  await plugin('linux-only', 'Not supported on macOS.', { beforeShellExecution: [{ command: './mac' }] });
  await cursorFiles(homeDir, JSON.stringify({ version: 1, hooks: { preToolUse: [{ command: './own-gate' }], stop: [{ command: 'node cli/index.mjs relay hook --client cursor --event stop' }] } }));

  const found = (await diagnoseRelayClients({ homeDir, env, platform: 'win32' })).cursor;
  assert.deepEqual(found.foreignHooks.map((hook) => [hook.source, hook.plugin ?? null, hook.event, hook.command]).sort(), [
    ['plugin', 'linux-only', 'beforeShellExecution', './mac'], ['plugin', 'portable', 'preToolUse', './audit'],
    ['plugin', 'secrets', 'beforeShellExecution', './check'], ['user', null, 'preToolUse', './own-gate'],
  ]);
  assert.equal(found.foreignHooks.find((hook) => hook.plugin === 'secrets').file, secrets);
  assert.equal(found.warnings.length, 1); assert.match(found.warnings[0], /secrets.*not supported on Windows.*beforeShellExecution/);
  assert.equal((await diagnoseRelayClients({ homeDir, env, platform: 'darwin' })).cursor.warnings.length, 1, 'macOS is named by the other plugin');
  assert.equal((await diagnoseRelayClients({ homeDir, env, platform: 'linux' })).cursor.warnings.length, 0);
  assert.equal(Object.hasOwn((await diagnoseRelayClients({ homeDir, env })).claude, 'foreignHooks'), false);
});

test('a client whose config cannot be read is reported as failed and left untouched', async (context) => {
  const { homeDir, mindPath, env } = await fixture(context, ['claude', 'codex']);
  await writeFile(path.join(homeDir, '.claude.json'), '{ not json');
  await mkdir(path.join(homeDir, '.codex'), { recursive: true });
  await writeFile(path.join(homeDir, '.codex', 'config.toml'), 'model = [unclosed\n');

  const results = await ensureRelayClients({ homeDir, env, kitPath: mindPath, mindPath });
  assert.deepEqual(statuses(results).claude, 'failed');
  assert.deepEqual(statuses(results).codex, 'failed');
  assert.match(results.find((item) => item.client === 'claude').reason, /invalid JSON/);
  assert.equal(await readFile(path.join(homeDir, '.claude.json'), 'utf8'), '{ not json');
  assert.equal(await readFile(path.join(homeDir, '.codex', 'config.toml'), 'utf8'), 'model = [unclosed\n');
});

test('Antigravity counts as configured only for rules that name this mind', async (context) => {
  const { homeDir, mindPath, env } = await fixture(context, ['agy']);
  const otherMind = path.join(path.dirname(mindPath), 'other-mind');
  await ensureRelayClients({ homeDir, env, kitPath: otherMind, mindPath: otherMind });
  assert.equal(await relayEntryPresent({ client: 'antigravity', homeDir, mindPath: otherMind }), true);
  assert.equal(await relayEntryPresent({ client: 'antigravity', homeDir, mindPath }), false);

  const results = await ensureRelayClients({ homeDir, env, kitPath: mindPath, mindPath });
  assert.equal(statuses(results).antigravity, 'configured');
  assert.equal(await relayEntryPresent({ client: 'antigravity', homeDir, mindPath }), true);
  assert.equal(statuses(await ensureRelayClients({ homeDir, env, kitPath: mindPath, mindPath })).antigravity, 'already-configured');
});

test('diagnose says whether each client already holds the Relay entry', async (context) => {
  const { homeDir, mindPath, env } = await fixture(context, ['claude', 'codex']);
  await writeFile(path.join(homeDir, '.claude.json'), '{ not json');
  await ensureRelayClients({ homeDir, env, kitPath: mindPath, mindPath });
  const found = await diagnoseRelayClients({ homeDir, env });
  assert.equal(found.claude.configured, null);
  assert.equal(found.codex.configured, true);
  assert.equal(found.cursor.configured, false);
});

async function simpleInstall(context, executables, extra = {}) {
  const base = await fixture(context, executables);
  await mkdir(path.join(base.homeDir, '.codex'), { recursive: true });
  const options = { kitPath: KIT_PATH, mindPath: base.mindPath, homeDir: base.homeDir, hostname: 'TESTBOX', language: 'en', env: base.env };
  const session = await createSetupSession({ ...options, ...extra });
  await session.answer({ installMode: 'simple' });
  await session.answer({ confirm: true });
  return { ...base, options, result: await session.install() };
}

test('setup joins the available clients to Relay through the mind copy of the CLI', async (context) => {
  const { homeDir, mindPath, result } = await simpleInstall(context, ['claude', 'codex'], { relaySetup: true });
  assert.deepEqual(statuses(result.relay), {
    claude: 'configured', codex: 'configured', cursor: 'not-available', opencode: 'not-available', copilot: 'not-available', antigravity: 'not-available',
  });
  assert.ok(result.notices.includes('claude: Relay configured now. Restart it to load Relay.'));
  assert.ok(result.notices.includes('cursor: not available on this machine.'));
  const claude = JSON.parse(await readFile(path.join(homeDir, '.claude.json'), 'utf8'));
  assert.equal(claude.mcpServers['hivem1nd-relay'].args[0], path.join(mindPath, 'cli', 'index.mjs'));
});

test('setup leaves every client alone unless Relay setup is asked for', async (context) => {
  const { homeDir, result } = await simpleInstall(context, ['claude', 'codex']);
  assert.deepEqual(result.relay, []);
  assert.equal(await exists(path.join(homeDir, '.claude.json')), false);
  assert.equal(await exists(path.join(homeDir, '.codex', 'config.toml')), false);
});

test('evolve configures a client that gained no entry yet, then only reports it', async (context) => {
  const { homeDir, mindPath, options } = await simpleInstall(context, ['claude']);
  const evolveOptions = { ...options, pull: false, relaySetup: true };
  const first = await evolve(evolveOptions);
  assert.equal(first.completed, true);
  assert.equal(statuses(first.relay).claude, 'configured');
  assert.equal(first.relay.find((item) => item.client === 'claude').restart, true);
  const file = path.join(homeDir, '.claude.json');
  const configured = await readFile(file, 'utf8');
  assert.equal(JSON.parse(configured).mcpServers['hivem1nd-relay'].args[0], path.join(mindPath, 'cli', 'index.mjs'));

  const second = await evolve(evolveOptions);
  assert.equal(statuses(second.relay).claude, 'already-configured');
  assert.equal(await readFile(file, 'utf8'), configured);
  assert.deepEqual((await evolve({ ...options, pull: false })).relay, []);
});

const uninstallOptions = ({ mindPath, homeDir, env }, extra = {}) => ({ mindPath, homeDir, hostname: 'TESTBOX', env, ...extra });

test('uninstall removes the Relay entries that run this mind and keeps every foreign entry', async (context) => {
  const installed = await simpleInstall(context, ['claude', 'codex'], { relaySetup: true });
  const { homeDir } = installed;
  const claudeFile = path.join(homeDir, '.claude.json');
  const settingsFile = path.join(homeDir, '.claude', 'settings.json');
  const claude = JSON.parse(await readFile(claudeFile, 'utf8'));
  claude.mcpServers.other = { command: 'other-server' };
  claude.theme = 'dark';
  await writeFile(claudeFile, JSON.stringify(claude, null, 2));
  const settings = JSON.parse(await readFile(settingsFile, 'utf8'));
  settings.hooks.SessionStart.push({ hooks: [{ type: 'command', command: 'echo foreign' }] });
  await writeFile(settingsFile, JSON.stringify(settings, null, 2));

  const result = await uninstall(uninstallOptions(installed));
  assert.deepEqual(statuses(result.relay), {
    claude: 'removed', codex: 'removed', cursor: 'none', opencode: 'none', copilot: 'none', antigravity: 'none',
  });
  const after = JSON.parse(await readFile(claudeFile, 'utf8'));
  assert.deepEqual(after.mcpServers, { other: { command: 'other-server' } });
  assert.equal(after.theme, 'dark');
  const hooks = JSON.parse(await readFile(settingsFile, 'utf8')).hooks;
  assert.deepEqual(hooks.SessionStart, [{ hooks: [{ type: 'command', command: 'echo foreign' }] }]);
  assert.doesNotMatch(await readFile(path.join(homeDir, '.codex', 'config.toml'), 'utf8'), /hivem1nd-relay/);
});

test('uninstall leaves a Relay entry that runs another kit', async (context) => {
  const installed = await simpleInstall(context, ['claude', 'codex']);
  const { homeDir, env } = installed;
  await ensureRelayClients({ homeDir, env, kitPath: path.join(installed.root, 'other-kit'), mindPath: path.join(installed.root, 'other-mind') });
  const claudeFile = path.join(homeDir, '.claude.json');
  const before = await readFile(claudeFile, 'utf8');

  const result = await uninstall(uninstallOptions(installed));
  assert.equal(statuses(result.relay).claude, 'elsewhere');
  assert.equal(statuses(result.relay).codex, 'elsewhere');
  assert.equal(await readFile(claudeFile, 'utf8'), before);
  assert.match(await readFile(path.join(homeDir, '.codex', 'config.toml'), 'utf8'), /hivem1nd-relay/);
});

test('uninstall dry run reports the Relay entries it would remove and writes nothing', async (context) => {
  const installed = await simpleInstall(context, ['claude'], { relaySetup: true });
  const claudeFile = path.join(installed.homeDir, '.claude.json');
  const before = await readFile(claudeFile, 'utf8');
  const result = await uninstall(uninstallOptions(installed, { dryRun: true }));
  assert.equal(statuses(result.relay).claude, 'removed');
  assert.equal(await readFile(claudeFile, 'utf8'), before);
});

test('uninstall removes the Antigravity rules of this mind and keeps those of another mind', async (context) => {
  const installed = await simpleInstall(context, ['agy'], { relaySetup: true });
  const { homeDir, mindPath, env, root } = installed;
  const otherMind = path.join(root, 'other-mind');
  await ensureRelayClients({ homeDir, env, kitPath: otherMind, mindPath: otherMind });
  assert.equal(await relayEntryPresent({ client: 'antigravity', homeDir, mindPath }), true);

  const result = await uninstall(uninstallOptions(installed));
  assert.equal(statuses(result.relay).antigravity, 'removed');
  assert.equal(await relayEntryPresent({ client: 'antigravity', homeDir, mindPath }), false);
  assert.equal(await relayEntryPresent({ client: 'antigravity', homeDir, mindPath: otherMind }), true);
});

test('uninstall reports a client whose config cannot be read and removes nothing from it', async (context) => {
  const installed = await simpleInstall(context, ['claude'], { relaySetup: true });
  const claudeFile = path.join(installed.homeDir, '.claude.json');
  await writeFile(claudeFile, '{ not json');
  const result = await uninstall(uninstallOptions(installed));
  assert.equal(statuses(result.relay).claude, 'failed');
  assert.match(result.relay.find((item) => item.client === 'claude').reason, /invalid JSON/);
  assert.equal(await readFile(claudeFile, 'utf8'), '{ not json');
});
