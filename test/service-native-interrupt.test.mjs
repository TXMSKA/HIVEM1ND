import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createNativeAdapter } from '../engine/service/adapters.mjs';
import { MODEL, choice, claudeNative, codexNative, cursorNative, fakeOwner, nativeFor, report, until } from './native-fakes.mjs';

// One real-protocol adapter per client over a fake transport. Codex is confined by its own sandbox; the others are supervised.
async function session(t, client, timeoutMs = 2000) {
  const natives = [], handles = [];
  const adapter = createNativeAdapter(client, { command: `${client}-fake`, timeoutMs, interruptTimeoutMs: 80,
    describe: async () => report(client, client === 'codex' ? 'confined' : 'supervised'),
    spawn: (command, args) => { const native = nativeFor[client](8000 + natives.length); native.nativeId = args[args.indexOf('--session-id') + 1]; natives.push(native); return native; },
    ownProcess: fakeOwner(handles) });
  t.after(() => adapter.close());
  const runsIn = choice(client);
  const created = await adapter.create({ unitId: 'root:worker', cwd: process.cwd(), model: MODEL, effort: 'high', runsIn, launchScope: { id: randomUUID(), writeRoots: [] } });
  return { adapter, native: natives[0], handles, nativeSessionId: created.nativeSessionId, created };
}

test('Codex interrupts the current turn with its thread and turn id, answers idle between turns and never claims a silent client', async t => {
  const { adapter, native, nativeSessionId } = await session(t, 'codex');
  const interrupts = () => native.writes.filter(message => message.method === 'turn/interrupt');
  assert.deepEqual(await adapter.interruptTurn({ nativeSessionId }), { acknowledged: true, idle: true });
  assert.equal(interrupts().length, 0, 'no turn is running, so nothing is sent');
  assert.equal((await adapter.send({ nativeSessionId, text: 'Work on the task' })).submitted, true);
  assert.deepEqual(await adapter.interruptTurn({ nativeSessionId }), { acknowledged: true });
  assert.deepEqual(interrupts().map(message => message.params), [{ threadId: 'owned', turnId: 'turn-1' }]);
  assert.deepEqual(await until(async () => { const answer = await adapter.interruptTurn({ nativeSessionId }); return answer.idle ? answer : null; }), { acknowledged: true, idle: true },
    'the interrupted turn completed, so the session is idle and stays open');
  assert.equal(native.killed, undefined, 'only the step stops; the session stays');
  native.ignoreInterrupt = true;
  assert.equal((await adapter.send({ nativeSessionId, text: 'Work again' })).submitted, true);
  assert.deepEqual(await adapter.interruptTurn({ nativeSessionId }), { acknowledged: false, code: 'stop_unavailable' });
  assert.deepEqual(await adapter.interruptTurn({ nativeSessionId: 'foreign' }), { acknowledged: false, code: 'stop_unavailable' });
  assert.deepEqual(await adapter.interruptTurn({ nativeSessionId, unitId: 'root:other' }), { acknowledged: false, code: 'stop_unavailable' });
});

test('Claude Code interrupts with a stream-json control request and waits for the matching control response', async t => {
  const { adapter, native, nativeSessionId, handles } = await session(t, 'claude');
  const interrupts = () => native.writes.filter(message => message.type === 'control_request' && message.request?.subtype === 'interrupt');
  // The startup message opened the first turn, which has not produced its result yet.
  assert.deepEqual(await adapter.interruptTurn({ nativeSessionId }), { acknowledged: true });
  assert.equal(interrupts().length, 1);
  assert.equal(typeof interrupts()[0].request_id, 'string');
  native.finishTurn();
  assert.deepEqual(await until(async () => { const answer = await adapter.interruptTurn({ nativeSessionId }); return answer.idle ? answer : null; }), { acknowledged: true, idle: true });
  const sent = interrupts().length;
  assert.deepEqual(await adapter.interruptTurn({ nativeSessionId }), { acknowledged: true, idle: true });
  assert.equal(interrupts().length, sent, 'an idle session is not interrupted');
  const submitted = adapter.send({ nativeSessionId, text: 'Next step' });
  await until(() => native.writes.some(message => message.type === 'user' && message.message.content === 'Next step'));
  native.answerInterrupt = false;
  assert.deepEqual(await adapter.interruptTurn({ nativeSessionId }), { acknowledged: false, code: 'stop_unavailable' }, 'no control response within the limit');
  native.answerInterrupt = true;
  assert.deepEqual(await handles[0].handle.stopStep(), { acknowledged: true }, 'the owned handle stops the step through the same interruption');
  native.finishTurn();
  await submitted;
  assert.equal(native.killed, undefined);
});

test('Cursor cancels the pending prompt with session/cancel and waits until it resolves cancelled', async t => {
  const { adapter, native, nativeSessionId, handles } = await session(t, 'cursor');
  const cancels = () => native.writes.filter(message => message.method === 'session/cancel');
  assert.deepEqual(await adapter.interruptTurn({ nativeSessionId }), { acknowledged: true, idle: true });
  assert.equal(cancels().length, 0);
  const submitted = adapter.send({ nativeSessionId, text: 'Work on the task' });
  await until(() => native.finishPrompt);
  assert.deepEqual(await adapter.interruptTurn({ nativeSessionId }), { acknowledged: true });
  assert.deepEqual(cancels().map(message => message.params), [{ sessionId: 'owned' }]);
  assert.equal((await submitted).submitted, true, 'the prompt resolved with its cancelled stop reason');
  assert.deepEqual(await adapter.interruptTurn({ nativeSessionId }), { acknowledged: true, idle: true });
  native.ignoreCancel = true;
  const again = adapter.send({ nativeSessionId, text: 'Work again' });
  await until(() => native.finishPrompt);
  assert.deepEqual(await adapter.interruptTurn({ nativeSessionId }), { acknowledged: false, code: 'stop_unavailable' }, 'the prompt never resolved');
  native.ignoreCancel = false;
  assert.deepEqual(await handles[0].handle.stopStep(), { acknowledged: true });
  assert.equal((await again).submitted, true);
});

test('a Cursor turn longer than the send limit is still known to be running, so Stop the step reaches it', async t => {
  const { adapter, native, nativeSessionId } = await session(t, 'cursor', 120);
  const submitted = await adapter.send({ nativeSessionId, text: 'A long task' });
  assert.deepEqual(submitted, { submitted: false, ambiguous: true }, 'the send gave up waiting after its limit');
  assert.equal(typeof native.finishPrompt, 'function', 'the agent is still working on the prompt');
  assert.deepEqual(await adapter.interruptTurn({ nativeSessionId }), { acknowledged: true });
  assert.equal(native.finishPrompt, null);
});

test('fixture sessions answer idle and an unknown or stopped session is refused', async t => {
  const adapter = createNativeAdapter('codex', { fixture: true, models: [MODEL], transcript: ['{"id":1,"result":{"thread":{"id":"owned-thread"}}}'] });
  t.after(() => adapter.close());
  await adapter.create({ unitId: 'root:worker' });
  assert.deepEqual(await adapter.interruptTurn({ nativeSessionId: 'owned-thread' }), { acknowledged: true, idle: true });
  assert.deepEqual(await adapter.interruptTurn({ nativeSessionId: 'missing' }), { acknowledged: false, code: 'stop_unavailable' });
  const live = await session(t, 'claude');
  live.native.kill();
  assert.deepEqual(await live.adapter.interruptTurn({ nativeSessionId: live.nativeSessionId }), { acknowledged: false, code: 'stop_unavailable' });
});
