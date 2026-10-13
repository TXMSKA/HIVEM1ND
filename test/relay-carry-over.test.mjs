import './relay-local-state.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
