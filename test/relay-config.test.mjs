import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildClientConfig, clientConfigPaths, configureRelayClient, diagnoseRelayClients, unconfigureRelayClient } from '../engine/relay/config.mjs';

async function temp(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-config-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function options(root, extra = {}) {
  return { client: 'codex', homeDir: root, kitPath: path.join(root, 'kit'), mindPath: path.join(root, 'mind'), ...extra };
}

test('client paths honor client environment overrides, while explicit home stays isolated', () => {
  const home = path.join(os.tmpdir(), 'relay-home');
  const codex = clientConfigPaths({ client: 'codex', env: { CODEX_HOME: 'C:/codex-custom' } });
  assert.equal(codex.mcp, path.resolve('C:/codex-custom/config.toml'));
  const claude = clientConfigPaths({ client: 'claude', env: { CLAUDE_CONFIG_DIR: 'C:/claude-custom' } });
  assert.equal(claude.hooks, path.resolve('C:/claude-custom/settings.json'));
  assert.equal(claude.mcp, path.resolve('C:/claude-custom/.claude.json'));
  const isolatedClaude = clientConfigPaths({ client: 'claude', homeDir: home, env: { CLAUDE_CONFIG_DIR: 'C:/must-not-use' } });
  assert.equal(isolatedClaude.mcp, path.join(home, '.claude.json'));
  assert.equal(isolatedClaude.hooks, path.join(home, '.claude', 'settings.json'));
  const isolated = clientConfigPaths({ client: 'codex', homeDir: home, env: { CODEX_HOME: 'C:/must-not-use' } });
  assert.equal(isolated.mcp, path.join(home, '.codex', 'config.toml'));
  const opencodeCustom = clientConfigPaths({ client: 'opencode', env: { OPENCODE_CONFIG: 'C:/opencode/custom.jsonc' } });
  assert.equal(opencodeCustom.mcp, path.resolve('C:/opencode/custom.jsonc'));
  const opencodeIsolated = clientConfigPaths({ client: 'opencode', homeDir: home, env: { OPENCODE_CONFIG: 'C:/must-not-use.json' } });
  assert.equal(opencodeIsolated.mcp, path.join(home, '.config', 'opencode', 'opencode.jsonc'));
});

test('OpenCode detects its active JSONC config before JSON', async (context) => {
  const root = await temp(context);
  const dir = path.join(root, '.config', 'opencode');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'opencode.json'), '{}');
  await writeFile(path.join(dir, 'opencode.jsonc'), '{ // active native config\n}\n');
  assert.equal(clientConfigPaths({ client: 'opencode', homeDir: root }).mcp, path.join(dir, 'opencode.jsonc'));
});

test('OpenCode configure targets OPENCODE_CONFIG directly and an explicit home overrides it', async (context) => {
  const root = await temp(context);
  const custom = path.join(root, 'custom', 'relay.jsonc');
  const env = { OPENCODE_CONFIG: custom };
  const configured = await configureRelayClient({ client: 'opencode', env, kitPath: path.join(root, 'kit'), mindPath: path.join(root, 'mind') });
  assert.deepEqual(configured.paths, [custom]);
  assert.match(await readFile(custom, 'utf8'), /hivem1nd-relay/);
  const isolated = path.join(root, 'isolated');
  const paths = clientConfigPaths({ client: 'opencode', homeDir: isolated, env });
  assert.equal(paths.mcp, path.join(isolated, '.config', 'opencode', 'opencode.jsonc'));
});

test('OpenCode config edits JSONC losslessly, is idempotent and removes only its entry', async (context) => {
  const root = await temp(context);
  const options = { client: 'opencode', homeDir: root, kitPath: path.join(root, 'kit'), mindPath: path.join(root, 'mind') };
  const configFile = path.join(root, '.config', 'opencode', 'opencode.jsonc');
  await mkdir(path.dirname(configFile), { recursive: true });
  const original = "{\n  // Keep the user's provider settings.\n  \"model\": \"openai/gpt-6-luna\",\n  \"mcp\": {\n    \"other\": { \"type\": \"local\", \"command\": [\"other-tool\"], },\n  },\n}\n";
  await writeFile(configFile, original);
  const installed = await configureRelayClient(options);
  assert.deepEqual(installed.changed, [configFile]);
  const merged = await readFile(configFile, 'utf8');
  assert.match(merged, /\/\/ Keep the user's provider settings\./);
  const { parse } = await import('jsonc-parser');
  const parsed = parse(merged);
  assert.deepEqual(parsed.mcp.other, { type: 'local', command: ['other-tool'] });
  const relay = parsed.mcp['hivem1nd-relay'];
  assert.equal(relay.type, 'local');
  const clientIndex = relay.command.indexOf('--client');
  assert.deepEqual(relay.command.slice(clientIndex, clientIndex + 2), ['--client', 'opencode']);
  assert.ok(relay.command.includes(path.join(options.kitPath, 'cli', 'index.mjs')));
  assert.equal(relay.enabled, true);
  assert.deepEqual((await configureRelayClient(options)).changed, []);
  await writeFile(configFile, '{ /* broken */ "mcp": [ }');
  await assert.rejects(configureRelayClient(options), { code: 'RELAY_CONFIG_INVALID' });
  assert.equal(await readFile(configFile, 'utf8'), '{ /* broken */ "mcp": [ }');
  await writeFile(configFile, merged);
  const removed = await unconfigureRelayClient(options);
  assert.deepEqual(removed.changed, [configFile]);
  const after = await readFile(configFile, 'utf8');
  assert.match(after, /\/\/ Keep the user's provider settings\./);
  const removedConfig = parse(after);
  assert.deepEqual(removedConfig.mcp.other, { type: 'local', command: ['other-tool'] });
  assert.equal(removedConfig.mcp['hivem1nd-relay'], undefined);
  const manual = '{\n  "mcp": { "hivem1nd-relay": { "type": "local", "command": ["manual-server"] } }\n}\n';
  await writeFile(configFile, manual);
  await assert.rejects(configureRelayClient(options), { code: 'RELAY_CONFIG_CONFLICT' });
  assert.deepEqual((await unconfigureRelayClient(options)).changed, []);
  assert.equal(await readFile(configFile, 'utf8'), manual);
});

test('Codex config merge validates TOML and preserves unrelated entries byte-for-byte', () => {
  const original = '# keep this comment\nmodel = "gpt-6-luna"\n\n[mcp_servers.other]\ncommand = "other"\nargs = []\n';
  const merged = buildClientConfig({ ...options('C:/kit-home'), existing: { mcp: original, hooks: '{"other":true}' } });
  assert.ok(merged.mcp.startsWith(original));
  assert.match(merged.mcp, /\[mcp_servers\.hivem1nd-relay\]/);
  assert.deepEqual(JSON.parse(merged.hooks).other, true);
  assert.throws(() => buildClientConfig({ ...options('C:/kit-home'), existing: { mcp: 'bad = [', hooks: '{}' } }), { code: 'RELAY_CONFIG_INVALID' });
  assert.throws(() => buildClientConfig({ ...options('C:/kit-home'), existing: { mcp: '[mcp_servers."hivem1nd-relay"]\ncommand="manual"\n', hooks: '{}' } }), { code: 'RELAY_CONFIG_CONFLICT' });
});

test('isolated install is idempotent, migrates a changed kit path, and uninstalls only owned entries', async (context) => {
  const root = await temp(context);
  const opts = options(root);
  const configFile = path.join(root, '.codex', 'config.toml');
  const hooksFile = path.join(root, '.codex', 'hooks.json');
  await mkdir(path.dirname(configFile), { recursive: true });
  const unrelated = '# keep\nmodel = "gpt-6-luna"\n';
  await writeFile(configFile, unrelated);
  await writeFile(hooksFile, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo unrelated' }] }] }, extra: 'keep' }, null, 2));
  const initialHooks = await readFile(hooksFile, 'utf8');
  const installed = await configureRelayClient(opts);
  assert.equal(installed.changed.length, 2);
  assert.equal((await readFile(configFile, 'utf8')).startsWith(unrelated), true);
  await writeFile(configFile, `${await readFile(configFile, 'utf8')}\n[profiles.other]\nmodel = "keep-this-table"\n`);
  const once = await readFile(configFile, 'utf8');
  assert.deepEqual((await configureRelayClient(opts)).changed, []);
  assert.equal(await readFile(configFile, 'utf8'), once);
  const migrated = await configureRelayClient({ ...opts, kitPath: path.join(root, 'new-kit') });
  assert.equal(migrated.changed.length, 2);
  assert.equal((await readFile(configFile, 'utf8')).match(/\[mcp_servers\.hivem1nd-relay\]/g).length, 1);
  const removed = await unconfigureRelayClient(opts);
  assert.equal(removed.changed.length, 2);
  assert.equal(await readFile(configFile, 'utf8'), `${unrelated}\n[profiles.other]\nmodel = "keep-this-table"\n`);
  const hooks = JSON.parse(await readFile(hooksFile, 'utf8'));
  assert.equal(hooks.extra, 'keep');
  assert.equal(hooks.hooks.UserPromptSubmit.length, 1);
  assert.equal(hooks.hooks.UserPromptSubmit[0].hooks[0].command, 'echo unrelated');
  assert.ok(initialHooks.includes('echo unrelated'));
});

test('Claude and Cursor config schemas keep their native structure and Windows hook commands are quoted safely', () => {
  const claude = buildClientConfig({ client: 'claude', existing: { mcp: '{"other":{}}', hooks: '{"permissions":{"allow":[]}}' }, kitPath: 'C:/kit', mindPath: 'C:/mind', platform: 'win32', nodePath: 'C:/Program Files/nodejs/node.exe' });
  const claudeMcp = JSON.parse(claude.mcp);
  assert.ok(claudeMcp.mcpServers['hivem1nd-relay']);
  assert.deepEqual(JSON.parse(claude.hooks).permissions, { allow: [] });
  const claudeHandler = JSON.parse(claude.hooks).hooks.SessionStart[0].hooks[0];
  assert.equal(claudeHandler.command, 'C:\\Program Files\\nodejs\\node.exe');
  assert.deepEqual(claudeHandler.args.slice(1, 5), ['relay', 'hook', '--client', 'claude']);
  const claudeHooks = JSON.parse(claude.hooks).hooks;
  for (const event of ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PreToolUse', 'Stop', 'SessionEnd']) {
    assert.ok(claudeHooks[event], `Claude hook ${event} is configured`);
    assert.ok(!claudeHooks[event][0].hooks[0].args.includes('--unit'), 'global Claude hooks never fix a role for every chat');
  }
  assert.equal(claudeHooks.PreToolUse[0].hooks[0].async, true);
  const cursor = buildClientConfig({ client: 'cursor', existing: { mcp: '{"version":1,"mcpServers":{"other":{}}}', hooks: '{"version":1,"hooks":{"beforeSubmitPrompt":[{"command":"echo keep"}]}}' }, kitPath: 'C:/kit', mindPath: 'C:/mind', platform: 'win32' });
  assert.equal(JSON.parse(cursor.mcp).mcpServers.other !== undefined, true);
  assert.equal(JSON.parse(cursor.hooks).hooks.beforeSubmitPrompt[0].command, 'echo keep');
  const cursorCommand = JSON.parse(cursor.hooks).hooks.sessionStart[0].command;
  assert.match(cursorCommand, /^powershell\.exe -NoProfile -NonInteractive -EncodedCommand /);
  const encoded = cursorCommand.split(' ').at(-1);
  const cursorScript = Buffer.from(encoded, 'base64').toString('utf16le');
  assert.match(cursorScript, /'relay' 'hook' '--client' 'cursor' '--event' 'sessionStart'/);
  assert.doesNotMatch(cursorCommand, /ExecutionPolicy/);
});

test('malformed config prevents partial install and preserves both files', async (context) => {
  const root = await temp(context);
  const opts = options(root);
  const dir = path.join(root, '.codex');
  await mkdir(dir, { recursive: true });
  const mcp = 'model = "keep"\n';
  const hooks = '{not-json';
  await writeFile(path.join(dir, 'config.toml'), mcp);
  await writeFile(path.join(dir, 'hooks.json'), hooks);
  await assert.rejects(configureRelayClient(opts), { code: 'RELAY_CONFIG_INVALID' });
  assert.equal(await readFile(path.join(dir, 'config.toml'), 'utf8'), mcp);
  assert.equal(await readFile(path.join(dir, 'hooks.json'), 'utf8'), hooks);
});

test('configure honors active CODEX_HOME but explicit home-dir overrides it', async (context) => {
  const root = await temp(context);
  const envRoot = path.join(root, 'codex-env');
  await configureRelayClient({ client: 'codex', env: { CODEX_HOME: envRoot }, kitPath: path.join(root, 'kit'), mindPath: path.join(root, 'mind') });
  assert.ok((await readFile(path.join(envRoot, 'config.toml'), 'utf8')).includes('hivem1nd-relay'));
  const isolated = path.join(root, 'isolated');
  await configureRelayClient({ client: 'codex', homeDir: isolated, env: { CODEX_HOME: envRoot }, kitPath: path.join(root, 'kit'), mindPath: path.join(root, 'mind') });
  assert.ok((await readFile(path.join(isolated, '.codex', 'config.toml'), 'utf8')).includes('hivem1nd-relay'));
});

test('client diagnostics honor the supplied environment and Windows command shims', async (context) => {
  const root = await temp(context);
  const bin = path.join(root, 'bin');
  await mkdir(bin);
  await writeFile(path.join(bin, 'claude.cmd'), 'shim');
  await writeFile(path.join(bin, 'opencode.cmd'), 'shim');
  const found = await diagnoseRelayClients({ env: { PATH: bin, PATHEXT: '.CMD;.EXE' }, platform: 'win32' });
  assert.equal(found.claude.available, true);
  assert.equal(found.opencode.available, true);
  assert.equal(found.codex.available, false);
  assert.equal(found.cursor.available, false);
});
