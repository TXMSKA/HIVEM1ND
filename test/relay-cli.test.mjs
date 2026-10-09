import './relay-local-state.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { parseArgs, runCli } from '../cli/index.mjs';
import { makeRelayMind } from './relay-test-fixture.mjs';
import { createRelay } from '../engine/relay/store.mjs';
import { createRelayWakeController } from '../engine/relay/wake.mjs';

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-cli-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return { root, mind: await makeRelayMind(root) };
}

async function cli(argv, dependencies = {}) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const out = [];
  const err = [];
  stdout.on('data', (chunk) => out.push(chunk));
  stderr.on('data', (chunk) => err.push(chunk));
  const code = await runCli(argv, { ...dependencies, stdout, stderr });
  return { code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') };
}

test('CLI binds separate instance and native IDs, then resolves a reminder without an explicit unit', async (context) => {
  const { mind } = await fixture(context);
  const common = ['--mind-path', mind, '--session-id', 'instance-1', '--native-session-id', 'native-1', '--client', 'codex'];
  const registered = await cli(['relay', 'register', ...common, '--unit', 'overseer']);
  assert.equal(registered.code, 0, registered.stderr);
  assert.equal(JSON.parse(registered.stdout).nativeSessionId, 'native-1');
  const reminder = await cli(['relay', 'reminder', ...common]);
  assert.deepEqual(JSON.parse(reminder.stdout), { unit: 'overseer', unread: 0, from: [], text: '', registered: true });
});

test('CLI preserves clear usage errors and bounded stdin message delivery', async (context) => {
  const { mind } = await fixture(context);
  const missing = await cli(['relay', 'register', '--mind-path', mind, '--session-id', 'instance']);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /explicit --unit/);
  const noIdentity = await cli(['relay', 'send', '--mind-path', mind, '--to', 'overseer', '--subject', 'hello', '--body', 'test']);
  assert.equal(noIdentity.code, 2);
  assert.match(noIdentity.stderr, /--session-id/);
  const parsed = await cli(['relay', '--help']);
  assert.equal(parsed.code, 0);
  assert.match(parsed.stdout, /relay <[^\n]*mcp/);
});

test('CLI status and events pass only the fields their store methods accept', async (context) => {
  const { mind } = await fixture(context);
  const common = ['--mind-path', mind, '--session-id', 'instance-1', '--native-session-id', 'native-1', '--client', 'codex'];
  assert.equal((await cli(['relay', 'register', ...common, '--unit', 'overseer'])).code, 0);
  const status = await cli(['relay', 'status', ...common, '--unit', 'overseer']);
  assert.equal(status.code, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).units[0].unit, 'overseer');
  const events = await cli(['relay', 'events', ...common, '--limit', '5']);
  assert.equal(events.code, 0, events.stderr);
  const misplaced = await cli(['relay', 'events', ...common, '--unit', 'overseer']);
  assert.equal(misplaced.code, 1);
  assert.match(misplaced.stderr, /events does not accept the field unit/);
});

test('CLI refuses --thread-id on read with a usage error and keeps it for history', async (context) => {
  const { mind } = await fixture(context);
  const common = ['--mind-path', mind, '--session-id', 'instance-1', '--native-session-id', 'native-1', '--client', 'codex'];
  assert.equal((await cli(['relay', 'register', ...common, '--unit', 'overseer'])).code, 0);
  const read = await cli(['relay', 'read', ...common, '--thread-id', 'thread-1']);
  assert.equal(read.code, 2);
  assert.match(read.stderr, /relay read does not accept --thread-id/);
  const history = await cli(['relay', 'history', ...common, '--thread-id', 'thread-1']);
  assert.equal(history.code, 0, history.stderr);
});

test('CLI refuses --limit on status with a usage error', async (context) => {
  const { mind } = await fixture(context);
  const common = ['--mind-path', mind, '--session-id', 'instance-1', '--native-session-id', 'native-1', '--client', 'codex'];
  assert.equal((await cli(['relay', 'register', ...common, '--unit', 'overseer'])).code, 0);
  const status = await cli(['relay', 'status', ...common, '--limit', '5']);
  assert.equal(status.code, 2);
  assert.match(status.stderr, /relay status does not accept --limit/);
});

test('relay configure defaults the kit path to the running kit and requires --mind-path', async (context) => {
  const { root, mind } = await fixture(context);
  const home = path.join(root, 'home');
  const missing = await cli(['relay', 'configure', '--client', 'copilot', '--home-dir', home]);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /relay configure requires --mind-path/);
  const configured = await cli(['relay', 'configure', '--client', 'copilot', '--home-dir', home, '--mind-path', mind]);
  assert.equal(configured.code, 0, configured.stderr);
  const { mcpServers } = JSON.parse(await readFile(path.join(home, '.copilot', 'mcp-config.json'), 'utf8'));
  assert.equal(mcpServers['hivem1nd-relay'].args[0], fileURLToPath(new URL('../cli/index.mjs', import.meta.url)));
});

test('wake command parser requires explicit units and distinguishes bounded extension from unlimited consent', () => {
  const attach = parseArgs(['relay', 'wake', 'attach', '--mind-path', 'C:/mind', '--unit', 'overseer']);
  assert.equal(attach.options.action, 'wake');
  assert.equal(attach.options.wakeAction, 'attach');
  assert.equal(attach.options.hours, undefined);
  assert.deepEqual(parseArgs(['relay', 'wake', 'enable', '--mind-path', 'C:/mind', '--unit', 'overseer', '--native-session-id', 'native', '--hours', '4']).options, {
    action: 'wake', attachments: [], ids: [], wakeAction: 'enable', mindPath: 'C:/mind', unit: 'overseer', nativeSessionId: 'native', hours: '4',
  });
  assert.throws(() => parseArgs(['relay', 'wake', 'attach', '--unit', 'overseer', '--hours', '2']), /4 through 8/);
  assert.throws(() => parseArgs(['relay', 'wake', 'attach', '--unit', 'overseer', '--hours', '12']), /--extended/);
  assert.throws(() => parseArgs(['relay', 'wake', 'attach', '--unit', 'overseer', '--unlimited']), /--manual-consent/);
  assert.throws(() => parseArgs(['relay', 'wake', 'attach', '--unit', 'overseer', '--unlimited', '--manual-consent', '--hours', '4']), /cannot be combined/);
  const codexAttach = parseArgs(['relay', 'wake', 'attach', '--client', 'codex', '--unit', 'relay-test-codex', '--native-session-id', '01a10cc9-6c04-7cd2-86b8-411e66cecdb0']).options;
  assert.equal(codexAttach.client, 'codex');
  assert.equal(codexAttach.nativeSessionId, '01a10cc9-6c04-7cd2-86b8-411e66cecdb0');
});

test('Codex attach binds the explicitly selected target, leaves activity unknown, and reports only watcher readiness', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-codex-attach-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const mind = await makeRelayMind(root);
  const serverPath = path.join(root, 'plugins', 'cache', 'openai-bundled', 'codex-app-tools', '0.1.5', 'server.mjs');
  await mkdir(path.dirname(serverPath), { recursive: true });
  await writeFile(serverPath, 'export {};', 'utf8');
  const callerId = '8d1e501b-66ac-4c67-9aa5-72d19c0fc71e';
  const targetId = '01a10cc9-6c04-7cd2-86b8-411e66cecdb0';
  const env = {
    CODEX_HOME: root,
    CODEX_THREAD_ID: callerId,
    CODEX_APP_TOOLS_PIPE_PATH: '\\\\.\\pipe\\temporary-fixture-endpoint',
  };
  const calls = [];
  const controller = {
    async enable(binding) { calls.push(['enable', binding]); return { enabled: true, wakeBudget: 20 }; },
    async observeActivity(binding, activity) { calls.push(['activity', binding, activity]); },
    async disable(binding) { calls.push(['disable', binding]); },
  };
  const result = await cli([
    'relay', 'wake', 'attach', '--client', 'codex', '--unit', 'relay-test-codex',
    '--native-session-id', targetId, '--mind-path', mind,
  ], {
    env, platform: 'win32',
    createRelayWakeController: async () => controller,
    createRelay: async (options) => ({
      async reminder(query) {
        calls.push(['reminder', options, query]);
        return { registered: true, unit: 'relay-test-codex', unread: 0, from: [], text: '' };
      },
      async register() { throw new Error('Codex attach must not create a target registration.'); },
    }),
    spawnCodexWakeWorker(options) {
      calls.push(['spawn', options.binding, options.env]);
      return { ready: Promise.resolve({ state: 'running', ownsLease: true }) };
    },
  });
  assert.equal(result.code, 0, result.stderr);
  const targetBinding = { unit: 'relay-test-codex', nativeSessionId: targetId, client: 'codex', machine: os.hostname() };
  assert.deepEqual(calls.find(([kind]) => kind === 'reminder').slice(1), [
    { mindPath: mind, hostname: os.hostname(), sessionId: callerId, client: 'codex' },
    { nativeSessionId: targetId, client: 'codex' },
  ]);
  assert.deepEqual(calls.find(([kind]) => kind === 'enable')[1], targetBinding);
  assert.equal(calls.some(([kind]) => kind === 'activity'), false);
  assert.deepEqual(calls.find(([kind]) => kind === 'spawn')[1], targetBinding);
  assert.equal(calls.find(([kind]) => kind === 'spawn')[2].CODEX_THREAD_ID, callerId);
  assert.match(result.stdout, /"worker": "running"/);
  assert.match(result.stdout, /"delivery": "not claimed"/);
  assert.doesNotMatch(result.stdout + result.stderr, /temporary-fixture-endpoint/);
});

test('Codex attach refuses a missing or differently routed target registration without writing one', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-codex-attach-refuse-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const mind = await makeRelayMind(root);
  const serverPath = path.join(root, 'plugins', 'cache', 'openai-bundled', 'codex-app-tools', '0.1.5', 'server.mjs');
  await mkdir(path.dirname(serverPath), { recursive: true });
  await writeFile(serverPath, 'export {};', 'utf8');
  const env = {
    CODEX_HOME: root,
    CODEX_THREAD_ID: '8d1e501b-66ac-4c67-9aa5-72d19c0fc71e',
    CODEX_APP_TOOLS_PIPE_PATH: '\\\\.\\pipe\\temporary-fixture-endpoint',
  };
  let enabled = false;
  let registered = false;
  const result = await cli([
    'relay', 'wake', 'attach', '--client', 'codex', '--unit', 'relay-test-codex',
    '--native-session-id', '01a10cc9-6c04-7cd2-86b8-411e66cecdb0', '--mind-path', mind,
  ], {
    env, platform: 'win32',
    createRelayWakeController: async () => ({
      async enable() { enabled = true; return {}; },
      async disable() {},
    }),
    createRelay: async () => ({
      async reminder() { return { registered: true, unit: 'overseer', unread: 0, from: [], text: '' }; },
      async register() { registered = true; },
    }),
    spawnCodexWakeWorker() { throw new Error('must not spawn'); },
  });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /existing exact registration/);
  assert.equal(enabled, false);
  assert.equal(registered, false);
});

test('wake attach reports success only after worker readiness and rolls back on startup failure', async (context) => {
  const nativeSessionId = 'native-attach-session';
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'relay-claude-hooks-'));
  context.after(() => rm(configDir, { recursive: true, force: true }));
  await writeFile(path.join(configDir, 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node',
    args: ['C:/kit/cli/index.mjs', 'relay', 'hook', '--client', 'claude', '--event', 'Stop', '--mind-path', 'C:/mind'] }] }] } }));
  const env = {
    CLAUDE_CONFIG_DIR: configDir,
    CLAUDE_CODE_SESSION_ID: nativeSessionId,
    CLAUDE_CODE_MESSAGING_SOCKET: '\\\\.\\pipe\\attach-test',
    CLAUDE_CODE_MESSAGING_TOKEN: 'ephemeral-secret',
  };
  const binding = { unit: 'overseer', nativeSessionId, client: 'claude', machine: os.hostname() };
  const policy = { enabled: true, deadlineAt: 'bounded', maxHandoffs: 20 };
  let resolveReady;
  let signalSpawned;
  const spawned = new Promise((resolve) => { signalSpawned = resolve; });
  const workerReady = new Promise((resolve) => { resolveReady = resolve; });
  const calls = [];
  const controller = {
    async enable(value) { calls.push(['enable', value]); return policy; },
    async observeActivity(value, activity) { calls.push(['activity', value, activity]); },
    async disable(value) { calls.push(['disable', value]); },
  };
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const output = [];
  const errors = [];
  stdout.on('data', (chunk) => output.push(chunk));
  stderr.on('data', (chunk) => errors.push(chunk));
  const run = runCli(['relay', 'wake', 'attach', '--mind-path', 'C:/isolated-mind', '--unit', 'overseer'], {
    stdout, stderr, env, platform: 'win32', createRelayWakeController: async () => controller,
    createRelay: async (options) => ({
      async register(input) { calls.push(['register', options.sessionId, input]); },
    }),
    spawnClaudeWakeWorker(options) { calls.push(['spawn', options.binding, options.env]); signalSpawned(); return { ready: workerReady }; },
  });
  await spawned;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(Buffer.concat(output).toString('utf8'), '');
  assert.equal(calls[0][0], 'register');
  assert.equal(calls[0][1], nativeSessionId);
  assert.deepEqual(calls[0][2], { unit: 'overseer', nativeSessionId, client: 'claude' });
  assert.deepEqual(calls.find(([kind]) => kind === 'enable')[1], binding);
  assert.equal(calls.find(([kind]) => kind === 'enable')[1].maxHandoffs, undefined);
  assert.deepEqual(calls.find(([kind]) => kind === 'activity')[2], { activity: 'busy' });
  assert.deepEqual(calls.find(([kind]) => kind === 'spawn')[1], binding);
  assert.deepEqual(calls.find(([kind]) => kind === 'spawn')[2], env);
  resolveReady({ state: 'running', ownsLease: true });
  assert.equal(await run, 0);
  assert.match(Buffer.concat(output).toString('utf8'), /"worker": "running"/);
  assert.doesNotMatch(Buffer.concat(output).toString('utf8'), /ephemeral-secret|attach-test/);
  assert.equal(Buffer.concat(errors).toString('utf8'), '');

  let disabled = 0;
  const failureOutput = new PassThrough();
  const failureError = new PassThrough();
  const failureErrors = [];
  failureError.on('data', (chunk) => failureErrors.push(chunk));
  const failCode = await runCli(['relay', 'wake', 'attach', '--mind-path', 'C:/isolated-mind', '--unit', 'overseer'], {
    stdout: failureOutput, stderr: failureError, env, platform: 'win32',
    createRelayWakeController: async () => ({
      async enable() { return policy; }, async observeActivity() {}, async disable() { disabled += 1; },
    }),
    createRelay: async () => ({ async register() {} }),
    spawnClaudeWakeWorker: () => ({ ready: Promise.reject(new Error('startup failed')) }),
  });
  assert.equal(failCode, 2);
  assert.equal(disabled, 1);
  assert.match(Buffer.concat(failureErrors).toString('utf8'), /could not start/);
  assert.doesNotMatch(Buffer.concat(failureErrors).toString('utf8'), /ephemeral-secret|attach-test/);
});

test('real CLI attach stays alive through worker readiness and always disables its disposable worker', { skip: process.platform !== 'win32' && 'Claude wake attach needs a Windows named pipe' }, async (context) => {
  const { root, mind } = await fixture(context);
  const nativeSessionId = `native-cli-${Date.now()}`;
  const binding = { unit: 'overseer', nativeSessionId, client: 'claude', machine: os.hostname() };
  const token = `ephemeral-${Date.now()}`;
  const socketPath = `\\\\.\\pipe\\relay-cli-${Date.now()}`;
  const childEnv = {
    ...process.env,
    CLAUDE_CODE_SESSION_ID: nativeSessionId,
    CLAUDE_CODE_MESSAGING_SOCKET: socketPath,
    CLAUDE_CODE_MESSAGING_TOKEN: token,
  };
  const cliPath = fileURLToPath(new URL('../cli/index.mjs', import.meta.url));
  const stdoutChunks = [];
  const stderrChunks = [];
  let child;
  let exitResult;
  let workerStopped = false;
  const cleanupController = await createRelayWakeController({ mindPath: mind, hostname: os.hostname(), sink: async () => ({ status: 'submitted' }) });
  try {
    child = spawn(process.execPath, [cliPath, 'relay', 'wake', 'attach', '--mind-path', mind, '--unit', 'overseer'], {
      env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
    exitResult = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve({ code: null, timedOut: true });
      }, 8_000);
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal, timedOut: false });
      });
    });
    assert.equal(exitResult.timedOut, false, Buffer.concat(stderrChunks).toString('utf8'));
    assert.equal(exitResult.code, 0, Buffer.concat(stderrChunks).toString('utf8'));
    const stdoutText = Buffer.concat(stdoutChunks).toString('utf8');
    const result = JSON.parse(stdoutText);
    assert.equal(result.worker, 'running');
    assert.equal(result.ownsLease, true);
    assert.equal(result.binding.nativeSessionId, nativeSessionId);
    assert.equal(result.policy.enabled, true);
    assert.equal(result.policy.wakeBudget, 20);
    assert.equal(result.delivery, 'not claimed');
    assert.doesNotMatch(stdoutText + Buffer.concat(stderrChunks).toString('utf8'), new RegExp(token));
    assert.doesNotMatch(stdoutText + Buffer.concat(stderrChunks).toString('utf8'), new RegExp(socketPath.replaceAll('\\', '\\\\')));

    const registered = await createRelay({ mindPath: mind, hostname: os.hostname(), sessionId: nativeSessionId, client: 'claude' });
    assert.equal((await registered.reminder({ nativeSessionId, client: 'claude' })).registered, true);
  } finally {
    child?.kill();
    await cleanupController.disable(binding).catch(() => {});
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const status = await cleanupController.status(binding).catch(() => null);
      if (!status || status.worker.state !== 'running') { workerStopped = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal(workerStopped, true, 'disposable wake worker did not stop after policy revocation');
  }
  assert.ok(root);
});

test('Claude wake attach without Relay hooks leaves activity unknown and says how to add them', async (context) => {
  const nativeSessionId = 'native-no-hooks';
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'relay-claude-nohooks-'));
  context.after(() => rm(configDir, { recursive: true, force: true }));
  await writeFile(path.join(configDir, 'settings.json'), JSON.stringify({ permissions: { allow: [] } }));
  const env = { CLAUDE_CONFIG_DIR: configDir, CLAUDE_CODE_SESSION_ID: nativeSessionId,
    CLAUDE_CODE_MESSAGING_SOCKET: '\\\\.\\pipe\\no-hooks', CLAUDE_CODE_MESSAGING_TOKEN: 'ephemeral-secret' };
  const calls = [];
  const stderr = new PassThrough();
  const errors = [];
  stderr.on('data', (chunk) => errors.push(chunk));
  const code = await runCli(['relay', 'wake', 'attach', '--mind-path', 'C:/isolated-mind', '--unit', 'overseer'], {
    stdout: new PassThrough(), stderr, env, platform: 'win32',
    createRelayWakeController: async () => ({
      async enable() { return { enabled: true, deadlineAt: 'bounded', maxHandoffs: 20 }; },
      async observeActivity(value, activity) { calls.push(activity); }, async disable() {},
    }),
    createRelay: async () => ({ async register() {} }),
    spawnClaudeWakeWorker: () => ({ ready: Promise.resolve({ state: 'running', ownsLease: true }) }),
  });
  assert.equal(code, 0, Buffer.concat(errors).toString('utf8'));
  assert.deepEqual(calls, []);
  assert.match(Buffer.concat(errors).toString('utf8'), /relay configure --client claude/);
});

test('relay delivery reports the stage of messages the registered unit sent and refuses a call that names none', async (context) => {
  const { mind } = await fixture(context);
  const common = ['--mind-path', mind, '--session-id', 'instance-1', '--native-session-id', 'native-1', '--client', 'codex'];
  assert.equal((await cli(['relay', 'register', ...common, '--unit', 'overseer'])).code, 0);
  const sent = JSON.parse((await cli(['relay', 'send', ...common, '--to', 'overseer', '--subject', 'Ping', '--body', 'hello'])).stdout);
  const shown = await cli(['relay', 'delivery', ...common, '--id', sent.id, '--id', 'missing-id']);
  assert.equal(shown.code, 0, shown.stderr);
  const result = JSON.parse(shown.stdout);
  assert.equal(result.deliveries[0].id, sent.id);
  assert.equal(result.deliveries[0].stage, 'published');
  assert.deepEqual(result.unknown, ['missing-id']);

  const none = await cli(['relay', 'delivery', ...common]);
  assert.equal(none.code, 2);
  assert.match(none.stderr, /at least one --id/);
  const withUnit = await cli(['relay', 'delivery', ...common, '--id', sent.id, '--unit', 'overseer']);
  assert.equal(withUnit.code, 2);
  assert.match(withUnit.stderr, /registered unit/);
  const anonymous = await cli(['relay', 'delivery', '--mind-path', mind, '--id', sent.id]);
  assert.equal(anonymous.code, 2);
  assert.match(anonymous.stderr, /--session-id/);
});

test('relay wake status reads a binding of another machine only when --machine names it', async () => {
  const seen = [];
  const dependencies = { createRelayWakeController: async () => ({ status: async (binding) => { seen.push(binding); return { binding }; } }) };
  const base = ['relay', 'wake', 'status', '--mind-path', 'C:/isolated-mind', '--unit', 'overseer', '--native-session-id', 'native-1', '--client', 'claude', '--hostname', 'HERE'];
  assert.equal((await cli([...base, '--machine', 'THERE'], dependencies)).code, 0);
  assert.equal((await cli(base, dependencies)).code, 0);
  assert.deepEqual(seen.map((binding) => binding.machine), ['THERE', 'HERE']);
  for (const argv of [['relay', 'wake', 'disable', ...base.slice(3), '--machine', 'THERE'], ['relay', 'status', '--mind-path', 'C:/isolated-mind', '--machine', 'THERE']]) {
    const refused = await cli(argv, dependencies);
    assert.equal(refused.code, 2, argv.join(' '));
    assert.match(refused.stderr, /--machine is only valid with relay wake status/);
  }
});
