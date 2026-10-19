import './relay-local-state.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { lastRegistration, sessionTranscript } from '../engine/relay/carry-over.mjs';
import { runRelayHook } from '../engine/relay/hooks.mjs';
import { serveRelayMcp } from '../engine/relay/mcp.mjs';
import { createRelay } from '../engine/relay/store.mjs';
import { makeRelayMind } from './relay-test-fixture.mjs';

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-carry-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const mindPath = await makeRelayMind(path.join(root, 'mind'));
  const config = path.join(root, 'claude');
  await mkdir(path.join(config, 'projects', 'C--work'), { recursive: true });
  return { mindPath, config };
}

const registerLine = (unit, nativeSessionId) => JSON.stringify({
  type: 'assistant', sessionId: 'whatever',
  message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__hivem1nd-relay__register', input: { unit, nativeSessionId, client: 'claude' } }] },
});
const textLine = (text) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });

async function transcript(config, nativeSessionId, lines) {
  const file = path.join(config, 'projects', 'C--work', `${nativeSessionId}.jsonl`);
  await writeFile(file, `${lines.join('\n')}\n`);
  return file;
}

async function hook({ mindPath, config, nativeSessionId, transcriptPath, event = 'UserPromptSubmit', spawns = [] }) {
  const stdin = new PassThrough();
  stdin.end(JSON.stringify({ session_id: nativeSessionId, hook_event_name: event, transcript_path: transcriptPath }));
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const chunks = [];
  stdout.on('data', (chunk) => chunks.push(chunk));
  await runRelayHook({
    client: 'claude', event, mindPath, stdin, stdout, stderr, platform: 'win32',
    env: { CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_SESSION_ID: nativeSessionId, CLAUDE_CODE_MESSAGING_SOCKET: '\\\\.\\pipe\\carry', CLAUDE_CODE_MESSAGING_TOKEN: 'ephemeral' },
    wakeWorkerSpawner(options) { spawns.push(options.binding); return { ready: Promise.resolve({ state: 'running' }) }; },
  });
  const value = Buffer.concat(chunks).toString('utf8').trim();
  return value ? JSON.parse(value) : null;
}

test('the last registration of a transcript is its last register call, not a mention of it', () => {
  const text = [
    registerLine('overseer', 'first'),
    textLine('The tool mcp__hivem1nd-relay__register" is mentioned here.'),
    registerLine('overmind-kit', 'second'),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'mcp__hivem1nd-relay__register" result' }] } }),
  ].join('\n');
  assert.deepEqual(lastRegistration(text), { unit: 'overmind-kit', nativeSessionId: 'second' });
  assert.equal(lastRegistration(textLine('nothing here')), null);
});

test('only the transcript of this exact session inside the Claude projects folder is read', async (context) => {
  const { config } = await fixture(context);
  const own = await transcript(config, 'session-b', [registerLine('overseer', 'session-a')]);
  const env = { CLAUDE_CONFIG_DIR: config };
  assert.equal(await sessionTranscript(own, 'session-b', env), own);
  assert.equal(await sessionTranscript(own, 'session-c', env), null);
  const outside = path.join(path.dirname(config), 'session-b.jsonl');
  await writeFile(outside, registerLine('overseer', 'session-a'));
  assert.equal(await sessionTranscript(outside, 'session-b', env), null);
});

test('a conversation under a new native session keeps its unit and its wake, and says so once', async (context) => {
  const { mindPath, config } = await fixture(context);
  const machine = os.hostname();
  const relay = await createRelay({ mindPath, hostname: machine, sessionId: 'old-mcp', client: 'claude' });
  await relay.register({ unit: 'overseer', nativeSessionId: 'session-a', client: 'claude' });
  const { createRelayWakeController } = await import('../engine/relay/wake.mjs');
  const controller = await createRelayWakeController({ mindPath, hostname: machine, sink: async () => ({ status: 'submitted' }) });
  const old = { unit: 'overseer', nativeSessionId: 'session-a', client: 'claude', machine };
  await controller.enable({ ...old, windowHours: 6 });
  const transcriptPath = await transcript(config, 'session-b', [registerLine('overseer', 'session-a'), textLine('work goes on')]);

  const spawns = [];
  const response = await hook({ mindPath, config, nativeSessionId: 'session-b', transcriptPath, spawns });
  assert.match(response.hookSpecificOutput.additionalContext, /registration as overseer from native session session-a to this one, with its wake/);
  const now = await createRelay({ mindPath, hostname: machine, sessionId: 'probe', client: 'claude' });
  assert.equal((await now.reminder({ nativeSessionId: 'session-b', client: 'claude' })).unit, 'overseer');
  const moved = { unit: 'overseer', nativeSessionId: 'session-b', client: 'claude', machine };
  const status = await controller.status(moved);
  assert.equal(status.enabled, true);
  assert.equal(status.durationHours, 6);
  assert.equal((await controller.status(old)).enabled, false);
  assert.deepEqual(spawns, [moved]);

  // The next turn finds the session registered and carries nothing again.
  const again = await hook({ mindPath, config, nativeSessionId: 'session-b', transcriptPath, spawns });
  assert.equal(again, null);
  assert.equal(spawns.length, 1);
});

test('nothing is carried when the old session now speaks for another unit, or the transcript names no registration', async (context) => {
  const { mindPath, config } = await fixture(context);
  await writeFile(path.join(mindPath, 'user', 'state', 'successor.md'), 'unit: successor\nstate: in\nmachine: RELAYTEST\ndate: 2026-10-05 10:00\n\nTesting Relay.\n');
  const relay = await createRelay({ mindPath, hostname: os.hostname(), sessionId: 'old-mcp', client: 'claude' });
  await relay.register({ unit: 'overseer', nativeSessionId: 'session-a', client: 'claude' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await relay.register({ unit: 'successor', nativeSessionId: 'session-a', client: 'claude' });
  const changed = await transcript(config, 'session-b', [registerLine('overseer', 'session-a')]);
  const response = await hook({ mindPath, config, nativeSessionId: 'session-b', transcriptPath: changed });
  assert.match(response.hookSpecificOutput.additionalContext, /not registered/);
  const silent = await transcript(config, 'session-c', [textLine('no registration')]);
  const other = await hook({ mindPath, config, nativeSessionId: 'session-c', transcriptPath: silent });
  assert.match(other.hookSpecificOutput.additionalContext, /not registered/);
});

test('a new MCP process of a carried session adopts its registration instead of failing', async (context) => {
  const { mindPath } = await fixture(context);
  const relay = await createRelay({ mindPath, hostname: 'RELAYTEST', sessionId: 'hook', client: 'claude' });
  await relay.register({ unit: 'overseer', nativeSessionId: 'session-b', client: 'claude' });
  const run = async (env) => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const chunks = [];
    stdout.on('data', (chunk) => chunks.push(chunk));
    const server = serveRelayMcp({ mindPath, hostname: 'RELAYTEST', client: 'claude', sessionId: `mcp-${Math.random()}`, stdin, stdout, stderr: new PassThrough(), env });
    stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_inbox', arguments: {} } })}\n`);
    await server;
    return JSON.parse(Buffer.concat(chunks).toString('utf8').trim()).result;
  };
  const adopted = await run({ CLAUDE_CODE_SESSION_ID: 'session-b' });
  assert.notEqual(adopted.isError, true);
  assert.equal(adopted.structuredContent.unit, 'overseer');
  const unknown = await run({ CLAUDE_CODE_SESSION_ID: 'session-z' });
  assert.equal(unknown.isError, true);
  assert.equal(unknown.structuredContent.code, 'NOT_REGISTERED');
});

async function mcpCall(mindPath, env, request) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const chunks = [];
  stdout.on('data', (chunk) => chunks.push(chunk));
  const server = serveRelayMcp({ mindPath, hostname: 'RELAYTEST', client: 'claude', sessionId: `mcp-${Math.random()}`, stdin, stdout, stderr: new PassThrough(), env });
  stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: request })}\n`);
  await server;
  return JSON.parse(Buffer.concat(chunks).toString('utf8').trim()).result;
}

test('a restarted MCP server of the same native session reads the inbox its earlier process registered', async (context) => {
  const { mindPath, config } = await fixture(context);
  const env = { CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_SESSION_ID: 'session-a' };
  const registered = await mcpCall(mindPath, env, { name: 'register', arguments: { unit: 'overseer', nativeSessionId: 'session-a', client: 'claude', activity: 'active' } });
  assert.notEqual(registered.isError, true);
  const read = await mcpCall(mindPath, env, { name: 'read_inbox', arguments: { limit: 10 } });
  assert.notEqual(read.isError, true, JSON.stringify(read.structuredContent));
  assert.deepEqual(read.structuredContent.messages, []);
  const sent = await mcpCall(mindPath, env, { name: 'send_message', arguments: { to: 'overseer', subject: 'Self', body: 'note' } });
  assert.equal(sent.structuredContent.from, 'overseer');
});

test('an MCP server started for an explicit native session keeps its unit across a restart for any client', async (context) => {
  const { mindPath } = await fixture(context);
  const serve = async (request) => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const chunks = [];
    stdout.on('data', (chunk) => chunks.push(chunk));
    const server = serveRelayMcp({ mindPath, hostname: 'RELAYTEST', client: 'codex', sessionId: `mcp-${Math.random()}`, nativeSessionId: 'codex-native', stdin, stdout, stderr: new PassThrough(), env: {} });
    stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: request })}\n`);
    await server;
    return JSON.parse(Buffer.concat(chunks).toString('utf8').trim()).result;
  };
  await serve({ name: 'register', arguments: { unit: 'overseer', nativeSessionId: 'codex-native', client: 'codex' } });
  const inbox = await serve({ name: 'list_inbox', arguments: {} });
  assert.notEqual(inbox.isError, true);
  assert.equal(inbox.structuredContent.unit, 'overseer');
});

test('the MCP server of a new session of the same host conversation takes the unit and the wake back before any call', async (context) => {
  const { mindPath, config } = await fixture(context);
  const relay = await createRelay({ mindPath, hostname: 'RELAYTEST', sessionId: 'old-mcp', client: 'claude' });
  await relay.register({ unit: 'overseer', nativeSessionId: 'session-a', client: 'claude', hostSessionId: 'local_host-1' });
  const { createRelayWakeController } = await import('../engine/relay/wake.mjs');
  const controller = await createRelayWakeController({ mindPath, hostname: 'RELAYTEST', sink: async () => ({ status: 'submitted' }) });
  const old = { unit: 'overseer', nativeSessionId: 'session-a', client: 'claude', machine: 'RELAYTEST' };
  await controller.enable({ ...old, windowHours: 8 });

  const env = { CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_SESSION_ID: 'session-b', CLAUDE_CODE_HOST_SESSION_ID: 'local_host-1' };
  const inbox = await mcpCall(mindPath, env, { name: 'list_inbox', arguments: {} });
  assert.notEqual(inbox.isError, true);
  assert.equal(inbox.structuredContent.unit, 'overseer');
  const moved = { ...old, nativeSessionId: 'session-b' };
  assert.equal((await controller.status(moved)).enabled, true);
  assert.equal((await controller.status(moved)).durationHours, 8);
  assert.equal((await controller.status(old)).enabled, false);
  const probe = await createRelay({ mindPath, hostname: 'RELAYTEST', sessionId: 'probe', client: 'claude' });
  assert.equal((await probe.hostRegistration({ hostSessionId: 'local_host-1', client: 'claude' })).nativeSessionId, 'session-b');
});

test('a register call through the MCP server records its host conversation, and another conversation carries nothing', async (context) => {
  const { mindPath, config } = await fixture(context);
  const env = { CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_SESSION_ID: 'session-a', CLAUDE_CODE_HOST_SESSION_ID: 'local_host-2' };
  const registered = await mcpCall(mindPath, env, { name: 'register', arguments: { unit: 'overseer', nativeSessionId: 'session-a', client: 'claude' } });
  assert.equal(registered.structuredContent.hostSessionId, 'local_host-2');
  const other = await mcpCall(mindPath, { ...env, CLAUDE_CODE_SESSION_ID: 'session-x', CLAUDE_CODE_HOST_SESSION_ID: 'local_host-3' }, { name: 'list_inbox', arguments: {} });
  assert.equal(other.isError, true);
  assert.equal(other.structuredContent.code, 'NOT_REGISTERED');
});

test('a registration made before host conversations were recorded is carried from the session transcript by the MCP server', async (context) => {
  const { mindPath, config } = await fixture(context);
  const relay = await createRelay({ mindPath, hostname: 'RELAYTEST', sessionId: 'old-mcp', client: 'claude' });
  await relay.register({ unit: 'overseer', nativeSessionId: 'session-a', client: 'claude' });
  await transcript(config, 'session-b', [registerLine('overseer', 'session-a'), textLine('work goes on')]);
  const env = { CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_SESSION_ID: 'session-b', CLAUDE_CODE_HOST_SESSION_ID: 'local_host-9' };
  const inbox = await mcpCall(mindPath, env, { name: 'list_inbox', arguments: {} });
  assert.notEqual(inbox.isError, true);
  assert.equal(inbox.structuredContent.unit, 'overseer');
  const probe = await createRelay({ mindPath, hostname: 'RELAYTEST', sessionId: 'probe', client: 'claude' });
  assert.equal((await probe.hostRegistration({ hostSessionId: 'local_host-9', client: 'claude' })).nativeSessionId, 'session-b');
});

test('registering by hand in the same host conversation takes the wake the earlier session still holds', async (context) => {
  const { mindPath, config } = await fixture(context);
  const relay = await createRelay({ mindPath, hostname: 'RELAYTEST', sessionId: 'old-mcp', client: 'claude' });
  await relay.register({ unit: 'overseer', nativeSessionId: 'session-a', client: 'claude', hostSessionId: 'local_host-4' });
  const { createRelayWakeController } = await import('../engine/relay/wake.mjs');
  const controller = await createRelayWakeController({ mindPath, hostname: 'RELAYTEST', sink: async () => ({ status: 'submitted' }) });
  const old = { unit: 'overseer', nativeSessionId: 'session-a', client: 'claude', machine: 'RELAYTEST' };
  await controller.enable({ ...old, windowHours: 4 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await relay.register({ unit: 'overseer', nativeSessionId: 'session-b', client: 'claude', hostSessionId: 'local_host-4' });
  const env = { CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_SESSION_ID: 'session-b', CLAUDE_CODE_HOST_SESSION_ID: 'local_host-4' };
  const again = await mcpCall(mindPath, env, { name: 'register', arguments: { unit: 'overseer', nativeSessionId: 'session-b', client: 'claude' } });
  assert.notEqual(again.isError, true);
  assert.equal((await controller.status({ ...old, nativeSessionId: 'session-b' })).enabled, true);
  assert.equal((await controller.status(old)).enabled, false);
});

async function serveOnce(mindPath, env, request, spawns) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const chunks = [];
  stdout.on('data', (chunk) => chunks.push(chunk));
  const server = serveRelayMcp({ mindPath, hostname: 'RELAYTEST', client: 'claude', sessionId: `mcp-${Math.random()}`, stdin, stdout, stderr: new PassThrough(), env, platform: 'win32',
    wakeWorkerSpawner(options) { spawns.push(options.binding); return { ready: Promise.resolve({ state: 'running' }) }; } });
  stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: request })}\n`);
  await server;
  return JSON.parse(Buffer.concat(chunks).toString('utf8').trim()).result;
}

const pipeEnv = (config, nativeSessionId) => ({ CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_SESSION_ID: nativeSessionId,
  CLAUDE_CODE_MESSAGING_SOCKET: '\\\\.\\pipe\\carry', CLAUDE_CODE_MESSAGING_TOKEN: 'ephemeral' });

test('a chat that registers a unit takes the consent an earlier session of the unit holds, and starts its worker', async (context) => {
  const { mindPath, config } = await fixture(context);
  const relay = await createRelay({ mindPath, hostname: 'RELAYTEST', sessionId: 'old-mcp', client: 'claude' });
  await relay.register({ unit: 'overseer', nativeSessionId: 'session-a', client: 'claude' });
  const { createRelayWakeController } = await import('../engine/relay/wake.mjs');
  const controller = await createRelayWakeController({ mindPath, hostname: 'RELAYTEST', sink: async () => ({ status: 'submitted' }) });
  const old = { unit: 'overseer', nativeSessionId: 'session-a', client: 'claude', machine: 'RELAYTEST' };
  await controller.enable({ ...old, windowHours: 5 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const spawns = [];
  const registered = await serveOnce(mindPath, pipeEnv(config, 'session-z'),
    { name: 'register', arguments: { unit: 'overseer', nativeSessionId: 'session-z', client: 'claude', activity: 'active' } }, spawns);
  assert.notEqual(registered.isError, true);
  const moved = { ...old, nativeSessionId: 'session-z' };
  assert.equal((await controller.status(moved)).enabled, true);
  assert.equal((await controller.status(moved)).durationHours, 5);
  assert.equal((await controller.status(old)).enabled, false);
  assert.deepEqual(spawns, [moved]);
});

test('a session whose process starts again under the same ID gets its wake back from the new process, also after the old pipe paused it', async (context) => {
  const { mindPath, config } = await fixture(context);
  const relay = await createRelay({ mindPath, hostname: 'RELAYTEST', sessionId: 'old-mcp', client: 'claude' });
  await relay.register({ unit: 'overseer', nativeSessionId: 'session-a', client: 'claude', activity: 'active' });
  const { createRelayWakeController } = await import('../engine/relay/wake.mjs');
  const controller = await createRelayWakeController({ mindPath, hostname: 'RELAYTEST', sink: async () => ({ status: 'submitted' }) });
  const binding = { unit: 'overseer', nativeSessionId: 'session-a', client: 'claude', machine: 'RELAYTEST' };
  await controller.enable({ ...binding, windowHours: 7 });
  // The worker of the earlier process could not reach the session through its gone pipe and stopped after five errors.
  const policies = path.join(mindPath, 'user', 'relay', 'wake', 'policies');
  const [file] = await readdir(policies);
  const policy = JSON.parse(await readFile(path.join(policies, file), 'utf8'));
  await writeFile(path.join(policies, file), JSON.stringify({ ...policy, pausedReason: 'error-budget-exhausted', consecutiveErrors: 5,
    lastError: { code: 'SINK_NOT_SUBMITTED', at: new Date().toISOString() } }));
  assert.equal((await controller.status(binding)).enabled, false);

  const spawns = [];
  const inbox = await serveOnce(mindPath, pipeEnv(config, 'session-a'), { name: 'list_inbox', arguments: {} }, spawns);
  assert.equal(inbox.structuredContent.unit, 'overseer');
  const status = await controller.status(binding);
  assert.equal(status.enabled, true);
  assert.equal(status.pausedReason, null);
  assert.equal(status.durationHours, 7);
  assert.deepEqual(spawns, [binding]);

  await controller.disable(binding);
  await serveOnce(mindPath, pipeEnv(config, 'session-a'), { name: 'list_inbox', arguments: {} }, spawns);
  assert.equal(spawns.length, 1, 'a consent the person ended is not started again');
  assert.equal((await controller.status(binding)).enabled, false);
});
