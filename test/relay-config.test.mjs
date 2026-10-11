import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
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

test('Copilot paths follow COPILOT_HOME, an explicit home stays isolated, and no hooks file is targeted', () => {
  const home = path.join(os.tmpdir(), 'relay-home');
  const custom = clientConfigPaths({ client: 'copilot', env: { COPILOT_HOME: 'C:/copilot-custom' } });
  assert.equal(custom.mcp, path.resolve('C:/copilot-custom/mcp-config.json'));
  assert.equal(custom.hooks, undefined);
  const isolated = clientConfigPaths({ client: 'copilot', homeDir: home, env: { COPILOT_HOME: 'C:/must-not-use' } });
  assert.equal(isolated.mcp, path.join(home, '.copilot', 'mcp-config.json'));
  assert.equal(clientConfigPaths({ client: 'copilot', homeDir: home, env: {} }).mcp, isolated.mcp);
});

test('Copilot mcp-config.json merge keeps other servers, is idempotent and removes only its entry', async (context) => {
  const root = await temp(context);
  const opts = { client: 'copilot', homeDir: root, kitPath: path.join(root, 'kit'), mindPath: path.join(root, 'mind') };
  const file = path.join(root, '.copilot', 'mcp-config.json');
  await mkdir(path.dirname(file), { recursive: true });
  const other = { type: 'http', url: 'https://example.invalid/mcp', tools: ['*'] };
  await writeFile(file, JSON.stringify({ mcpServers: { other } }));
  const installed = await configureRelayClient(opts);
  assert.deepEqual(installed.changed, [file]); assert.deepEqual(installed.paths, [file]);
  assert.deepEqual(installed.backups, [file + '.relay-backup']);
  const document = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(document.mcpServers.other, other);
  const entry = document.mcpServers['hivem1nd-relay'];
  assert.equal(entry.type, 'local'); assert.equal(entry.command, process.execPath); assert.deepEqual(entry.tools, ['*']);
  assert.deepEqual(entry.args.slice(0, 6), [path.join(opts.kitPath, 'cli', 'index.mjs'), 'relay', 'mcp', '--mind-path', path.resolve(opts.mindPath), '--client']);
  assert.equal(entry.args[6], 'copilot');
  assert.equal(entry.env, undefined);
  assert.deepEqual((await configureRelayClient(opts)).changed, []);
  await writeFile(file, '{ broken');
  await assert.rejects(configureRelayClient(opts), { code: 'RELAY_CONFIG_INVALID' });
  assert.equal(await readFile(file, 'utf8'), '{ broken');
  await writeFile(file, JSON.stringify(document));
  assert.deepEqual((await unconfigureRelayClient(opts)).changed, [file]);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { mcpServers: { other } });
  const manual = JSON.stringify({ mcpServers: { 'hivem1nd-relay': { type: 'local', command: 'manual-server', args: [] } } });
  await writeFile(file, manual);
  await assert.rejects(configureRelayClient(opts), { code: 'RELAY_CONFIG_CONFLICT' });
  assert.deepEqual((await unconfigureRelayClient(opts)).changed, []);
  assert.equal(await readFile(file, 'utf8'), manual);
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

test('Claude and Cursor config schemas keep their native structure and Windows hook commands are quoted safely', { skip: process.platform !== 'win32' && 'asserts Windows paths, which the host path module only produces on Windows' }, () => {
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
  assert.equal(claudeHooks.PreToolUse[0].hooks[0].async, undefined);
  assert.ok(claudeHooks.PreToolUse[0].hooks[0].timeout >= 120);
  const cursor = buildClientConfig({ client: 'cursor', existing: { mcp: '{"version":1,"mcpServers":{"other":{}}}', hooks: '{"version":1,"hooks":{"beforeSubmitPrompt":[{"command":"echo keep"}]}}' }, kitPath: 'C:/kit', mindPath: 'C:/mind', platform: 'win32' });
  assert.equal(JSON.parse(cursor.mcp).mcpServers.other !== undefined, true);
  assert.equal(JSON.parse(cursor.hooks).hooks.beforeSubmitPrompt[0].command, 'echo keep');
  const cursorCommand = JSON.parse(cursor.hooks).hooks.sessionStart[0].command;
  assert.doesNotMatch(cursorCommand, /powershell|EncodedCommand|ExecutionPolicy/i);
  assert.match(cursorCommand, /"relay" "hook" "--client" "cursor" "--event" "sessionStart"/);
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
  await writeFile(path.join(bin, 'copilot.cmd'), 'shim');
  const found = await diagnoseRelayClients({ env: { PATH: bin, PATHEXT: '.CMD;.EXE' }, platform: 'win32' });
  assert.equal(found.claude.available, true);
  assert.equal(found.opencode.available, true);
  assert.equal(found.copilot.available, true);
  assert.equal(found.copilot.configPaths.mcp.endsWith('mcp-config.json'), true);
  assert.equal(found.codex.available, false);
  assert.equal(found.cursor.available, false);
});

// Antigravity documents regex rules as one anchored regular expression per whitespace-separated token.
function ruleAllows(rule, line) {
  const match = /^command\(regex:(.+)\)$/.exec(rule);
  if (!match) return false;
  const tokens = match[1].split(' '), words = line.split(' ');
  return words.length >= tokens.length && tokens.every((token, index) => new RegExp(`^(?:${token})$`).test(words[index]));
}

// A line it cannot split into commands is matched against the whole rule as one anchored expression.
function ruleAllowsFullLine(rule, line) {
  const match = /^command\(regex:(.+)\)$/.exec(rule);
  return match !== null && new RegExp(`^(?:${match[1]})$`).test(line);
}

const ANTIGRAVITY_ARGS_TOKEN = '[^;&|<>()$`{}\\r\\n]*';
const antigravityRulesFor = (kitPath, mindPath) => JSON.parse(buildClientConfig({ client: 'antigravity', kitPath, mindPath }).mcp).permissions.allow;
const legacyAntigravityRule = (rule) => rule.replace(ANTIGRAVITY_ARGS_TOKEN, '.*');

test('Antigravity configure adds only the kit relay read and send allow rules and unconfigure restores the file', async (context) => {
  const root = await temp(context);
  const opts = { client: 'antigravity', homeDir: root, kitPath: path.join(root, 'kit'), mindPath: path.join(root, 'mind') };
  const file = path.join(root, '.gemini', 'antigravity-cli', 'settings.json');
  assert.equal(clientConfigPaths({ client: 'antigravity', homeDir: root }).mcp, file);
  await mkdir(path.dirname(file), { recursive: true });
  const original = `${JSON.stringify({ colorScheme: 'tokyo night', permissions: { allow: ['command(git)'], deny: ['command(sudo)'] } }, null, 2)}\n`;
  await writeFile(file, original);
  const cli = path.join(root, 'kit', 'cli', 'index.mjs'), mind = path.join(root, 'mind');
  const line = (action, extra = '', kit = cli, where = mind) => `node ${kit} relay ${action} --mind-path ${where}${extra}`;
  const result = await configureRelayClient(opts);
  assert.deepEqual(result.changed, [file]);
  const settings = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(settings.colorScheme, 'tokyo night'); assert.deepEqual(settings.permissions.deny, ['command(sudo)']);
  const [git, ...rules] = settings.permissions.allow;
  assert.equal(git, 'command(git)'); assert.equal(rules.length, 2);
  const allowed = (text) => rules.some((rule) => ruleAllows(rule, text));
  assert.ok(allowed(line('read', ' --session-id fixture-instance'))); assert.ok(allowed(line('send', ' --to peer --body hello')));
  for (const text of [line('hook'), line('wake'), line('configure'), line('read', '', cli, path.join(root, 'other-mind')),
    line('read', '', path.join(root, 'other-kit', 'cli', 'index.mjs')), `node ${cli} relay read --mind-path ${mind}2`, `node ${cli} send`]) {
    assert.equal(allowed(text), false, text);
  }
  // The same rules keep matching after Antigravity normalizes the Windows path to forward slashes.
  assert.ok(allowed(line('read', ' --session-id x', cli.replaceAll(path.sep, '/'), mind.replaceAll(path.sep, '/'))));
  assert.equal(await readFile(`${file}.relay-backup`, 'utf8'), original);
  const configured = await readFile(file, 'utf8');
  assert.deepEqual((await configureRelayClient(opts)).changed, []);
  assert.equal(await readFile(file, 'utf8'), configured);
  await unconfigureRelayClient({ client: 'antigravity', homeDir: root, mindPath: path.join(root, 'other-mind') });
  assert.equal(await readFile(file, 'utf8'), configured);
  assert.deepEqual((await unconfigureRelayClient({ client: 'antigravity', homeDir: root, mindPath: mind })).changed, [file]);
  assert.equal(await readFile(file, 'utf8'), original);
});

test('Antigravity unconfigure restores a file that had no permissions, keeps foreign rules and preserves JSONC comments', async (context) => {
  const root = await temp(context);
  const opts = { client: 'antigravity', homeDir: root, kitPath: path.join(root, 'kit'), mindPath: path.join(root, 'mind') };
  const file = path.join(root, '.gemini', 'antigravity-cli', 'settings.json');
  await mkdir(path.dirname(file), { recursive: true });
  const original = '{\n  // keep this comment\n  "colorScheme": "tokyo night",\n  "trustedWorkspaces": [\n    "/home/fixture"\n  ]\n}\n';
  await writeFile(file, original);
  await configureRelayClient(opts);
  assert.match(await readFile(file, 'utf8'), /keep this comment/);
  await unconfigureRelayClient({ client: 'antigravity', homeDir: root });
  assert.equal(await readFile(file, 'utf8'), original);
  const foreign = `command(node ${path.join(root, 'elsewhere', 'tool.mjs')} relay read --mind-path ${path.join(root, 'mind')})`;
  await writeFile(file, JSON.stringify({ permissions: { allow: [foreign] } }));
  await configureRelayClient(opts);
  await unconfigureRelayClient({ client: 'antigravity', homeDir: root, mindPath: opts.mindPath });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { permissions: { allow: [foreign] } });
});

test('Antigravity rules end in a token that refuses shell control characters', () => {
  const rules = antigravityRulesFor(path.join(os.tmpdir(), 'kit'), path.join(os.tmpdir(), 'mind'));
  assert.equal(rules.length, 2);
  for (const rule of rules) {
    assert.ok(rule.endsWith(` ${ANTIGRAVITY_ARGS_TOKEN})`), rule);
    assert.ok(!rule.includes('.*'), rule);
  }
});

test('Antigravity rule text for a Windows kit path', { skip: process.platform !== 'win32' && 'asserts Windows paths, which the host path module only produces on Windows' }, () => {
  const [read, send] = antigravityRulesFor('C:\\kit', 'C:\\mind');
  const head = (action) => String.raw`command(regex:node (?:C:)?[\\/]kit[\\/]cli[\\/]index\.mjs relay ${action} --mind-path (?:C:)?[\\/]mind `;
  assert.equal(read, `${head('read')}${ANTIGRAVITY_ARGS_TOKEN})`);
  assert.equal(send, `${head('send')}${ANTIGRAVITY_ARGS_TOKEN})`);
});

test('Antigravity rules allow plain arguments and refuse chained, substituted or redirected lines in both matching modes', () => {
  const kitPath = path.join(os.tmpdir(), 'kit'), mind = path.join(os.tmpdir(), 'mind');
  const kit = path.join(kitPath, 'cli', 'index.mjs');
  const rules = antigravityRulesFor(kitPath, mind);
  const toForward = (text) => text.replaceAll(path.sep, '/');
  for (const [cli, where] of [[kit, mind], [toForward(kit), toForward(mind)]]) {
    const read = `node ${cli} relay read --mind-path ${where} --unit u`;
    const send = `node ${cli} relay send --mind-path ${where} --to overseer --subject "Reply" --body "Read, done."`;
    for (const text of [read, send]) {
      assert.ok(rules.some((rule) => ruleAllows(rule, text)), `per token: ${text}`);
      assert.ok(rules.some((rule) => ruleAllowsFullLine(rule, text)), `full line: ${text}`);
    }
    for (const base of [read, send]) {
      for (const suffix of ['; Remove-Item x', ' ; Remove-Item x', ' && calc', ' & calc', ' || calc', ' | Out-File x', ' > x', ' >> x', ' < x', ' $(whoami)',
        ' `whoami`', ' (Get-Item x)', ' { x }', '\ncalc', '\r\ncalc', ' $env:USERPROFILE']) {
        assert.equal(rules.some((rule) => ruleAllowsFullLine(rule, `${base}${suffix}`)), false, JSON.stringify(`${base}${suffix}`));
      }
    }
    assert.equal(rules.some((rule) => ruleAllows(rule, `node ${cli} relay read --mind-path ${where} $(whoami)`)), false);
  }
});

test('Antigravity configure replaces the earlier wildcard rules and keeps other rules and comments', async (context) => {
  const root = await temp(context);
  const opts = { client: 'antigravity', homeDir: root, kitPath: path.join(root, 'kit'), mindPath: path.join(root, 'mind') };
  const file = path.join(root, '.gemini', 'antigravity-cli', 'settings.json');
  await mkdir(path.dirname(file), { recursive: true });
  const current = antigravityRulesFor(opts.kitPath, opts.mindPath);
  const otherMind = antigravityRulesFor(opts.kitPath, path.join(root, 'other-mind')).map(legacyAntigravityRule);
  const allow = ['command(git)', ...current.map(legacyAntigravityRule), ...otherMind];
  await writeFile(file, `{\n  // keep this comment\n  "colorScheme": "tokyo night",\n  "permissions": ${JSON.stringify({ allow })}\n}\n`);
  assert.deepEqual((await configureRelayClient(opts)).changed, [file]);
  const configured = await readFile(file, 'utf8');
  assert.match(configured, /keep this comment/);
  const { parse } = await import('jsonc-parser');
  const settings = parse(configured);
  assert.equal(settings.colorScheme, 'tokyo night');
  assert.deepEqual(settings.permissions.allow, ['command(git)', ...otherMind, ...current]);
  assert.deepEqual((await configureRelayClient(opts)).changed, []);
  assert.equal(await readFile(file, 'utf8'), configured);
  assert.deepEqual((await unconfigureRelayClient({ client: 'antigravity', homeDir: root, mindPath: opts.mindPath })).changed, [file]);
  assert.deepEqual(parse(await readFile(file, 'utf8')).permissions.allow, ['command(git)', ...otherMind]);
});

test('Antigravity unconfigure removes the earlier wildcard rules and the current rules, with and without a mind path', async (context) => {
  const root = await temp(context);
  const kitPath = path.join(root, 'kit'), mindA = path.join(root, 'mind-a'), mindB = path.join(root, 'mind-b');
  const file = path.join(root, '.gemini', 'antigravity-cli', 'settings.json');
  await mkdir(path.dirname(file), { recursive: true });
  const legacyA = antigravityRulesFor(kitPath, mindA).map(legacyAntigravityRule), currentB = antigravityRulesFor(kitPath, mindB);
  const original = `${JSON.stringify({ colorScheme: 'tokyo night' }, null, 2)}\n`;
  const write = (allow) => writeFile(file, `${JSON.stringify({ colorScheme: 'tokyo night', permissions: { allow } }, null, 2)}\n`);
  await write([...legacyA, 'command(git)', ...currentB]);
  assert.deepEqual((await unconfigureRelayClient({ client: 'antigravity', homeDir: root, mindPath: mindA })).changed, [file]);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).permissions.allow, ['command(git)', ...currentB]);
  await write([...legacyA, ...currentB]);
  assert.deepEqual((await unconfigureRelayClient({ client: 'antigravity', homeDir: root })).changed, [file]);
  assert.equal(await readFile(file, 'utf8'), original);
  await write([...legacyA, 'command(git)', ...currentB]);
  await unconfigureRelayClient({ client: 'antigravity', homeDir: root });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).permissions.allow, ['command(git)']);
});

test('Antigravity configure blocks invalid or unsafe settings and paths without writing', async (context) => {
  const root = await temp(context);
  const opts = { client: 'antigravity', homeDir: root, kitPath: path.join(root, 'kit'), mindPath: path.join(root, 'mind') };
  const file = path.join(root, '.gemini', 'antigravity-cli', 'settings.json');
  await mkdir(path.dirname(file), { recursive: true });
  for (const bad of ['{ broken', '[]', '{"permissions": []}', '{"permissions": {"allow": "command(git)"}}']) {
    await writeFile(file, bad);
    await assert.rejects(configureRelayClient(opts), /Antigravity|invalid/);
    await assert.rejects(unconfigureRelayClient({ client: 'antigravity', homeDir: root }), /Antigravity|invalid/);
    assert.equal(await readFile(file, 'utf8'), bad);
  }
  await writeFile(file, '{}');
  await assert.rejects(configureRelayClient({ ...opts, mindPath: path.join(root, 'my mind') }), /without whitespace/);
  assert.equal(await readFile(file, 'utf8'), '{}');
});

test('the Windows hook command hands a payload with a byte order mark and accents to node intact', { skip: process.platform !== 'win32' && 'runs the Windows hook command' }, async (context) => {
  const mind = await mkdtemp(path.join(os.tmpdir(), 'relay-hook-encoding-'));
  context.after(() => rm(mind, { recursive: true, force: true }));
  const kitPath = path.resolve(import.meta.dirname, '..');
  const cursor = buildClientConfig({ client: 'cursor', existing: {}, kitPath, mindPath: mind, platform: 'win32', nodePath: process.execPath });
  const command = JSON.parse(cursor.hooks).hooks.stop[0].command;
  const payload = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify({ conversation_id: 'acción-1', hook_event_name: 'stop', status: 'completed', loop_count: 0 }), 'utf8')]);
  const result = spawnSync(command, { shell: true, input: payload, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /input unavailable/);
});
