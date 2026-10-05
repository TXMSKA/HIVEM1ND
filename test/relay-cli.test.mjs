import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  const registered = await cli(['relay', 'register', ...common, '--unit', 'manager']);
  assert.equal(registered.code, 0, registered.stderr);
  assert.equal(JSON.parse(registered.stdout).nativeSessionId, 'native-1');
  const reminder = await cli(['relay', 'reminder', ...common]);
  assert.deepEqual(JSON.parse(reminder.stdout), { unit: 'manager', unread: 0, from: [], text: '', registered: true });
});

test('CLI preserves clear usage errors and bounded stdin message delivery', async (context) => {
  const { mind } = await fixture(context);
  const missing = await cli(['relay', 'register', '--mind-path', mind, '--session-id', 'instance']);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /explicit --unit/);
  const noIdentity = await cli(['relay', 'send', '--mind-path', mind, '--to', 'manager', '--subject', 'hello', '--body', 'test']);
  assert.equal(noIdentity.code, 2);
  assert.match(noIdentity.stderr, /--session-id/);
  const parsed = await cli(['relay', '--help']);
  assert.equal(parsed.code, 0);
  assert.match(parsed.stdout, /relay <[^\n]*mcp/);
});

test('wake command parser requires explicit units and distinguishes bounded extension from unlimited consent', () => {
  const attach = parseArgs(['relay', 'wake', 'attach', '--mind-path', 'C:/mind', '--unit', 'manager']);
  assert.equal(attach.options.action, 'wake');
  assert.equal(attach.options.wakeAction, 'attach');
  assert.equal(attach.options.hours, undefined);
  assert.deepEqual(parseArgs(['relay', 'wake', 'enable', '--mind-path', 'C:/mind', '--unit', 'manager', '--native-session-id', 'native', '--hours', '4']).options, {
    action: 'wake', attachments: [], ids: [], wakeAction: 'enable', mindPath: 'C:/mind', unit: 'manager', nativeSessionId: 'native', hours: '4',
  });
  assert.throws(() => parseArgs(['relay', 'wake', 'attach', '--unit', 'manager', '--hours', '2']), /4 through 8/);
  assert.throws(() => parseArgs(['relay', 'wake', 'attach', '--unit', 'manager', '--hours', '12']), /--extended/);
  assert.throws(() => parseArgs(['relay', 'wake', 'attach', '--unit', 'manager', '--unlimited']), /--manual-consent/);
  assert.throws(() => parseArgs(['relay', 'wake', 'attach', '--unit', 'manager', '--unlimited', '--manual-consent', '--hours', '4']), /cannot be combined/);
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
      async reminder() { return { registered: true, unit: 'manager', unread: 0, from: [], text: '' }; },
      async register() { registered = true; },
    }),
    spawnCodexWakeWorker() { throw new Error('must not spawn'); },
  });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /existing exact registration/);
  assert.equal(enabled, false);
  assert.equal(registered, false);
});

test('wake attach reports success only after worker readiness and rolls back on startup failure', async () => {
  const nativeSessionId = 'native-attach-session';
  const env = {
    CLAUDE_CODE_SESSION_ID: nativeSessionId,
    CLAUDE_CODE_MESSAGING_SOCKET: '\\\\.\\pipe\\attach-test',
    CLAUDE_CODE_MESSAGING_TOKEN: 'ephemeral-secret',
  };
  const binding = { unit: 'manager', nativeSessionId, client: 'claude', machine: os.hostname() };
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
  const run = runCli(['relay', 'wake', 'attach', '--mind-path', 'C:/isolated-mind', '--unit', 'manager'], {
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
  assert.deepEqual(calls[0][2], { unit: 'manager', nativeSessionId, client: 'claude' });
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
  const failCode = await runCli(['relay', 'wake', 'attach', '--mind-path', 'C:/isolated-mind', '--unit', 'manager'], {
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

test('real CLI attach stays alive through worker readiness and always disables its disposable worker', async (context) => {
  const { root, mind } = await fixture(context);
  const nativeSessionId = `native-cli-${Date.now()}`;
  const binding = { unit: 'manager', nativeSessionId, client: 'claude', machine: os.hostname() };
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
    child = spawn(process.execPath, [cliPath, 'relay', 'wake', 'attach', '--mind-path', mind, '--unit', 'manager'], {
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
