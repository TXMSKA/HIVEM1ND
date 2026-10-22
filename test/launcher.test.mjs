import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { LaunchError, appWindowCommand, launchApp, serviceState, spawnDetachedService } from '../engine/launcher.mjs';
import { runCli } from '../cli/index.mjs';

const TOKEN_URL = 'http://127.0.0.1:4310/gui/viewer#session=SECRET-TOKEN';

function fakeDeps(states, extra = {}) {
  const calls = { spawn: 0, opened: [], sleeps: 0 };
  let clock = 0;
  const queue = [...states];
  return {
    calls,
    deps: {
      state: async () => (queue.length > 1 ? queue.shift() : queue[0]),
      spawnService: async () => { calls.spawn += 1; },
      viewerUrl: async () => TOKEN_URL,
      openUrl: async url => { calls.opened.push(url); },
      sleep: async () => { calls.sleeps += 1; clock += 300; },
      now: () => clock,
      ...extra,
    },
  };
}

test('a stopped service is started once, detached, and the viewer opens when it answers', async () => {
  const { calls, deps } = fakeDeps(['absent', 'starting', 'starting', 'running']);
  const result = await launchApp({}, deps);
  assert.deepEqual(result, { started: true });
  assert.equal(calls.spawn, 1);
  assert.deepEqual(calls.opened, [TOKEN_URL]);
  assert.equal(calls.sleeps, 3);
});

test('a service that already runs is reused: no second service, one more viewer', async () => {
  const { calls, deps } = fakeDeps(['running']);
  assert.deepEqual(await launchApp({}, deps), { started: false });
  assert.equal(calls.spawn, 0);
  assert.equal(calls.opened.length, 1);
});

test('a service that is still starting is waited for, never started a second time', async () => {
  const { calls, deps } = fakeDeps(['starting', 'starting', 'running']);
  await launchApp({}, deps);
  assert.equal(calls.spawn, 0);
  assert.equal(calls.opened.length, 1);
});

test('another M1ND holding the service, and a service that never answers, stop the launch without opening anything', async () => {
  const conflict = fakeDeps(['conflict']);
  await assert.rejects(launchApp({}, conflict.deps), (error) => error instanceof LaunchError && error.code === 'service_mind_conflict');
  assert.equal(conflict.calls.spawn + conflict.calls.opened.length, 0);
  const never = fakeDeps(['absent', 'starting'], { timeoutMs: 1000 });
  await assert.rejects(launchApp({}, never.deps), (error) => error.code === 'service_start_timeout');
  assert.equal(never.calls.spawn, 1);
  assert.equal(never.calls.opened.length, 0);
  const lost = fakeDeps(['starting', 'conflict']);
  await assert.rejects(launchApp({}, lost.deps), (error) => error.code === 'service_mind_conflict');
});

test('the service state tells absent, starting, running and a service of another M1ND apart', async () => {
  const runtime = reply => ({ readOwnedServiceBridge: async () => { if (reply instanceof Error) throw reply; return reply; } });
  assert.equal(await serviceState({}, runtime({ absent: true })), 'absent');
  assert.equal(await serviceState({}, runtime({ descriptor: { machine: 'A' } })), 'running');
  assert.equal(await serviceState({}, runtime({ unrelated: true })), 'conflict');
  assert.equal(await serviceState({}, runtime(Object.assign(new Error('x'), { code: 'service_unavailable' }))), 'starting');
  assert.equal(await serviceState({}, runtime(Object.assign(new Error('x'), { code: 'service_mind_conflict' }))), 'conflict');
});

test('the service is spawned detached with no window and no streams', async () => {
  let seen;
  let unreffed = false;
  const child = { once(event, handler) { if (event === 'spawn') queueMicrotask(handler); }, unref() { unreffed = true; } };
  await spawnDetachedService({ nodePath: 'node.exe', cliPath: 'C:/kit/cli/index.mjs', mindPath: 'C:/mind', cosmicPath: 'C:/cosmic', hostname: 'BOX', env: { A: '1' },
    spawnProcess: (file, args, options) => { seen = { file, args, options }; return child; } });
  assert.equal(seen.file, 'node.exe');
  assert.deepEqual(seen.args, ['C:/kit/cli/index.mjs', 'service', 'run', '--mind-path', 'C:/mind', '--cosmic-path', 'C:/cosmic', '--hostname', 'BOX']);
  assert.deepEqual({ detached: seen.options.detached, stdio: seen.options.stdio, windowsHide: seen.options.windowsHide }, { detached: true, stdio: 'ignore', windowsHide: true });
  assert.equal(unreffed, true);
});

test('service launch prints nothing, opens the browser with the session address and never shows it', async () => {
  const written = [];
  const stream = { write(value) { written.push(String(value)); } };
  const opened = [];
  const dependencies = {
    stdout: stream, stderr: stream, env: {}, platform: 'win32',
    openUrl: async url => { opened.push(url); },
    serviceRuntime: { async readOwnedServiceBridge() { return { descriptor: { machine: 'BOX' } }; },
      async runConfiguredService() { return { attached: true, bootstrap: { origin: 'http://127.0.0.1:4310', secret: 'x'.repeat(43) } }; } },
    serviceInstall: { async startConfiguredViewer(config, options) { await options.start(config); return { viewerUrl: TOKEN_URL }; } },
  };
  assert.equal(await runCli(['service', 'launch', '--mind-path', 'C:/mind', '--hostname', 'BOX'], dependencies), 0);
  assert.deepEqual(written, [], 'nothing is printed');
  assert.deepEqual(opened, [TOKEN_URL]);
});

test('service launch reports a failure in one line without the session address', async () => {
  const written = [];
  const stream = { write(value) { written.push(String(value)); } };
  const dependencies = { stdout: stream, stderr: stream, env: {}, platform: 'win32', openUrl: async () => assert.fail('no browser'),
    launcher: { launchApp: async () => { throw new LaunchError('service_start_timeout', 'The service did not become ready.'); },
      serviceState: async () => 'absent', spawnDetachedService: async () => {} },
    serviceRuntime: {}, serviceInstall: {} };
  assert.equal(await runCli(['service', 'launch', '--mind-path', 'C:/mind'], dependencies), 1);
  assert.equal(written.join(''), 'service_start_timeout: The service did not become ready.\n');
  assert.doesNotMatch(written.join(''), /SECRET|session=/);
});

test('the hidden launcher runs the CLI with no window, waits for it, and shows only the sentence it was given', async () => {
  const script = await readFile(new URL('../gui/launch.vbs', import.meta.url), 'utf8');
  assert.match(script, /shell\.Run\(command, 0, True\)/);
  assert.match(script, /service launch --mind-path/);
  assert.match(script, /If code <> 0 Then MsgBox WScript\.Arguments\(3\)/);
  assert.doesNotMatch(script, /StdOut|Echo|viewerUrl|session/i);
});

test('the app opens in a window of its own with Edge, then Chrome, and in the default browser otherwise', () => {
  const env = { 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' };
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  assert.deepEqual(appWindowCommand(TOKEN_URL, { platform: 'win32', env, exists: file => file === edge || file === chrome }), { command: edge, args: [`--app=${TOKEN_URL}`] });
  assert.deepEqual(appWindowCommand(TOKEN_URL, { platform: 'win32', env, exists: file => file === chrome }), { command: chrome, args: [`--app=${TOKEN_URL}`] });
  assert.equal(appWindowCommand(TOKEN_URL, { platform: 'win32', env, exists: () => false }), null);
  assert.equal(appWindowCommand(TOKEN_URL, { platform: 'linux', env, exists: () => true }), null);
});
