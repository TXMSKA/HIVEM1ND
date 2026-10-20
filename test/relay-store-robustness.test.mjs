import './relay-local-state.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import fsPromises, { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as store from '../engine/relay/store.mjs';
import { createRelay, relayLocalStatePath } from '../engine/relay/store.mjs';
import { RELAY_TOOLS, serveRelayMcp, validateToolArguments } from '../engine/relay/mcp.mjs';
import { PassThrough } from 'node:stream';
import { createPersonRelay } from '../engine/relay/person.mjs';

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-relay-robust-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const mind = path.join(root, 'mind');
  await mkdir(path.join(mind, 'user', 'state'), { recursive: true });
  await mkdir(path.join(mind, 'user', 'projects', 'alpha', 'state'), { recursive: true });
  await mkdir(path.join(mind, 'user', 'projects', 'beta', 'state'), { recursive: true });
  await writeFile(path.join(mind, 'user', 'routes.md'), '## Environments\n- web: alpha, beta\n\n## Projects\n- alpha (web)\n- beta (web)\n');
  await writeFile(path.join(mind, 'user', 'projects', 'alpha', 'state', 'executor-alpha.md'), 'unit: executor-alpha\nstate: in\nmachine: TESTBOX\ndate: 2026-10-05 10:00\n\nWorking on alpha.\n');
  await writeFile(path.join(mind, 'user', 'projects', 'beta', 'state', 'executor-beta.md'), 'unit: executor-beta\nstate: in\nmachine: TESTBOX\ndate: 2026-10-05 10:00\n\nWorking on beta.\n');
  await writeFile(path.join(mind, 'user', 'state', 'overseer.md'), 'unit: overseer\nstate: in\nmachine: TESTBOX\ndate: 2026-10-05 10:00\n\nManaging work.\n');
  return { root, mind };
}

async function bind(mind, unit, sessionId, client = 'codex', nativeSessionId = `${sessionId}-native`) {
  const relay = await createRelay({ mindPath: mind, hostname: 'TESTBOX', sessionId, client });
  await relay.register({ unit, nativeSessionId });
  return relay;
}

async function interceptFs(method, intercept) {
  const original = fsPromises[method];
  fsPromises[method] = (...args) => intercept(original, args);
  syncBuiltinESMExports();
  return () => {
    fsPromises[method] = original;
    syncBuiltinESMExports();
  };
}

function busy(code = 'EBUSY') {
  return Object.assign(new Error(`${code}: resource busy or locked`), { code });
}

const betaInbox = (mind) => path.join(mind, 'user', 'projects', 'beta', 'inbox', 'executor-beta');
const betaArchive = (mind) => path.join(mind, 'user', 'relay', 'archive', 'executor-beta');
const sessionsOf = (mind) => path.join(mind, 'user', 'relay', 'sessions');
const policiesOf = (mind) => path.join(mind, 'user', 'relay', 'wake', 'policies');
const names = async (directory) => (await readdir(directory).catch(() => [])).filter((name) => name.endsWith('.md') || name.endsWith('.json')).sort();

test('R-01: a message whose bytes are still arriving is neither listed nor archived', async (context) => {
  const { mind } = await fixture(context);
  const alice = await bind(mind, 'executor-alpha', 'chat-alpha');
  const bob = await bind(mind, 'executor-beta', 'chat-beta');
  await alice.send({ to: 'executor-beta', subject: 'Long', body: 'x'.repeat(2000) });
  const [name] = await names(betaInbox(mind));
  const file = path.join(betaInbox(mind), name);
  const complete = await readFile(file);
  const cut = complete.indexOf('\n\n') + 2 + 500;
  await writeFile(file, complete.subarray(0, cut));
  // The rest of the file lands right after the reader found the end of what was there.
  let arrived = false;
  const restore = await interceptFs('open', async (original, args) => {
    const handle = await original(...args);
    if (arrived || typeof args[1] !== 'number' || path.resolve(String(args[0])) !== file) return handle;
    const read = handle.read.bind(handle);
    handle.read = async (...rest) => {
      const result = await read(...rest);
      if (result.bytesRead === 0 && !arrived) { arrived = true; appendFileSync(file, complete.subarray(cut)); }
      return result;
    };
    return handle;
  });
  let first;
  try { first = await bob.read(); } finally { restore(); }
  assert.equal(arrived, true);
  assert.equal(first.messages.length, 0, 'a file that grew while it was read is not delivered');
  assert.deepEqual(await names(betaArchive(mind)), [], 'and not archived');
  assert.equal((await bob.inbox()).unread, 1, 'it is listed once its bytes stopped moving');
  const second = await bob.read();
  assert.equal(second.messages.length, 1);
  assert.equal(second.messages[0].body.length, 2000);
  assert.deepEqual(await readFile(path.join(betaArchive(mind), name)), complete);
});

test('R-01: the complete file wins over an archived copy that is only its head', async (context) => {
  const { mind } = await fixture(context);
  const alice = await bind(mind, 'executor-alpha', 'chat-alpha');
  const bob = await bind(mind, 'executor-beta', 'chat-beta');
  await alice.send({ to: 'executor-beta', subject: 'Long', body: 'y'.repeat(2000) });
  const [name] = await names(betaInbox(mind));
  const complete = await readFile(path.join(betaInbox(mind), name));
  // An earlier read archived the copy that had arrived so far; the whole file landed afterwards.
  await mkdir(betaArchive(mind), { recursive: true });
  await writeFile(path.join(betaArchive(mind), name), complete.subarray(0, complete.indexOf('\n\n') + 2 + 700));
  const history = await alice.history({});
  assert.equal(history.messages.length, 1, 'history no longer reports the same id with different bytes');
  assert.equal(history.messages[0].body.length, 2000);
  assert.equal((await alice.threads()).threads.length, 1);
  assert.equal((await alice.events()).events.length, 1);
  const read = await bob.read();
  assert.equal(read.messages.length, 1, 'read_inbox no longer fails with an archive collision');
  assert.equal(read.messages[0].body.length, 2000);
  assert.deepEqual(await readFile(path.join(betaArchive(mind), name)), complete, 'the archive holds the complete file');
  assert.deepEqual(await names(betaInbox(mind)), []);
});

test('R-02: read_inbox returns what it archived and leaves a locked file in the inbox', async (context) => {
  const { mind } = await fixture(context);
  const alice = await bind(mind, 'executor-alpha', 'chat-alpha');
  const bob = await bind(mind, 'executor-beta', 'chat-beta');
  for (const subject of ['one', 'two', 'three']) await alice.send({ to: 'executor-beta', subject, body: subject });
  const files = await names(betaInbox(mind));
  const locked = path.join(betaInbox(mind), files.at(-1));
  let restore = await interceptFs('open', async (original, args) => {
    if (typeof args[1] === 'number' && path.resolve(String(args[0])) === locked) throw busy();
    return original(...args);
  });
  let first;
  try { first = await bob.read(); } finally { restore(); }
  assert.equal(first.messages.length, 2, 'the two messages before the locked file are returned');
  assert.equal((await names(betaArchive(mind))).length, 2, 'and they are the ones that were archived');
  assert.deepEqual(await names(betaInbox(mind)), [files.at(-1)]);
  const second = await bob.read();
  assert.equal(second.messages.length, 1, 'the locked message comes with the next read');
  assert.equal(new Set([...first.messages, ...second.messages].map((message) => message.id)).size, 3);

  // A source file that cannot be removed right after it was archived does not hide the message either.
  await alice.send({ to: 'executor-beta', subject: 'four', body: 'four' });
  const [fourth] = await names(betaInbox(mind));
  const stuck = path.join(betaInbox(mind), fourth);
  restore = await interceptFs('unlink', async (original, args) => {
    if (path.resolve(String(args[0])) === stuck) throw busy('EPERM');
    return original(...args);
  });
  let third;
  try { third = await bob.read(); } finally { restore(); }
  assert.deepEqual(third.messages.map((message) => message.subject), ['four']);
  assert.equal((await bob.inbox()).unread, 0, 'the leftover copy is a read copy');
  assert.equal((await bob.read()).messages.length, 0);
  assert.deepEqual(await names(betaInbox(mind)), [], 'and the next read cleans it');
});

test('R-14: a file NTFS is deleting is a missing file, not an unsafe path', async (context) => {
  const { mind } = await fixture(context);
  const alice = await bind(mind, 'executor-alpha', 'chat-alpha');
  const bob = await bind(mind, 'executor-beta', 'chat-beta');
  for (const subject of ['one', 'two']) await alice.send({ to: 'executor-beta', subject, body: subject });
  const files = await names(betaInbox(mind));
  const going = path.join(betaInbox(mind), files[0]);
  let answered = false;
  const restore = await interceptFs('realpath', async (original, args) => {
    if (!answered && path.resolve(String(args[0])) === going) {
      // Another reader archives the file: its name is gone and the volume answers with its internal deleted area.
      answered = true;
      await fsPromises.unlink(going);
      return `C:\\$Extend\\$Deleted\\${randomUUID().replaceAll('-', '')}`;
    }
    return original(...args);
  });
  let listed;
  try { listed = await bob.inbox(); } finally { restore(); }
  assert.equal(answered, true);
  assert.equal(listed.unread, 1, 'the file that is being deleted is skipped');
});

test('R-13: a locked routes file, a locked state file and a truncated event do not fail every call', async (context) => {
  const { mind } = await fixture(context);
  const alice = await bind(mind, 'executor-alpha', 'chat-alpha');
  const bob = await bind(mind, 'executor-beta', 'chat-beta');
  const sent = await alice.send({ to: 'executor-beta', subject: 'one', body: 'one' });
  assert.equal((await bob.inbox()).unread, 1);
  const routes = path.join(mind, 'user', 'routes.md');
  let restore = await interceptFs('readFile', async (original, args) => {
    if (path.resolve(String(args[0])) === routes) throw busy();
    return original(...args);
  });
  try {
    assert.equal((await bob.inbox()).unread, 1, 'the routes read last time answers while the file is locked');
    assert.equal((await bob.reminder({ nativeSessionId: 'chat-beta-native', client: 'codex' })).unread, 1);
    assert.equal((await alice.send({ to: 'executor-beta', subject: 'two', body: 'two' })).to, 'executor-beta');
  } finally { restore(); }

  const state = path.join(mind, 'user', 'projects', 'beta', 'state', 'executor-beta.md');
  restore = await interceptFs('readFile', async (original, args) => {
    if (path.resolve(String(args[0])) === state) throw busy();
    return original(...args);
  });
  let status;
  try { status = await bob.status({}); } finally { restore(); }
  assert.deepEqual(status.units.map((unit) => unit.unit).filter((unit) => unit === 'executor-alpha' || unit === 'overseer').sort(), ['executor-alpha', 'overseer']);
  assert.equal(status.units.some((unit) => unit.unit === 'executor-beta' && unit.state !== null), false, 'the unit with the locked state file is left out');
  assert.equal(status.issues.length, 1);
  assert.match(status.issues[0].path, /executor-beta\.md$/);

  const event = path.join(mind, 'user', 'relay', 'events', `${sent.id}.json`);
  await writeFile(event, (await readFile(event)).subarray(0, 30));
  const events = await alice.events();
  assert.equal(events.events.length, 2, 'the event of a message is rebuilt from the message');
  assert.equal(events.issues.length, 1);
  assert.match(events.issues[0].path, new RegExp(`${sent.id}\\.json$`));
});

// The worker liveness note and the lease of a local worker, as wake.mjs writes them.
function wakePolicy(extra = {}, binding = {}) {
  return {
    kind: 'relay-wake-policy', version: 1, key: 'e'.repeat(64),
    binding: { unit: 'executor-beta', nativeSessionId: 'bob-native', client: 'claude', machine: 'TESTBOX', ...binding },
    enabled: true, pausedReason: null, deadlineAt: new Date(Date.now() + 3600000).toISOString(), deliveries: {}, ...extra,
  };
}

const runningNote = (ageMs = 0) => ({ state: 'running', heartbeatAt: new Date(Date.now() - ageMs).toISOString() });

async function writePolicy(mind, policy, key = policy.key) {
  await mkdir(policiesOf(mind), { recursive: true });
  await writeFile(path.join(policiesOf(mind), `${key}.json`), JSON.stringify({ ...policy, key }));
}

async function writeLease(mind, key, expiresAt = Date.now() + 60_000) {
  const folder = path.join(relayLocalStatePath(await realpath(mind)), 'wake', 'workers');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, `${key}.json`), JSON.stringify({ kind: 'relay-wake-worker', key, ownerId: 'fixture', pid: process.pid, machine: 'TESTBOX', generation: null, heartbeatAt: new Date().toISOString(), expiresAt }));
}

test('R-05: delivery status reports a wake as live only when a worker, its budget and the message allow one', async (context) => {
  const { mind } = await fixture(context);
  const alice = await bind(mind, 'executor-alpha', 'wake-alice');
  await bind(mind, 'executor-beta', 'wake-bob');
  const sent = await alice.send({ to: 'executor-beta', subject: 'Urgent', body: 'urgent', priority: 'urgent' });
  const wakeOf = async () => (await alice.delivery({ ids: [sent.id] })).deliveries[0].wake;
  const key = (letter) => letter.repeat(64);

  assert.deepEqual(await wakeOf(), { live: false, reason: 'none' });
  await writePolicy(mind, wakePolicy());
  assert.deepEqual(await wakeOf(), { live: false, reason: 'no-worker' }, 'consent enabled, nobody polls');
  await writeLease(mind, key('e'), Date.now() - 1000);
  assert.deepEqual(await wakeOf(), { live: false, reason: 'no-worker' }, 'a lease that ran out');
  await writeLease(mind, key('e'));
  assert.deepEqual(await wakeOf(), { live: true, reason: null }, 'a worker holds the lease');

  const today = localDate(Date.now());
  await writePolicy(mind, wakePolicy({ maxDailyHandoffs: 2, day: { date: today, count: 2 } }));
  assert.deepEqual(await wakeOf(), { live: false, reason: 'daily-cap' });
  await writePolicy(mind, wakePolicy({ maxDailyHandoffs: 2, day: { date: '2020-01-01', count: 2 } }));
  assert.deepEqual(await wakeOf(), { live: true, reason: null }, 'the cap counts the day it belongs to');

  await writePolicy(mind, wakePolicy({ deliveries: { [sent.id]: { state: 'failed', attempts: 3 } } }));
  assert.deepEqual(await wakeOf(), { live: false, reason: 'wake-failed' }, 'every attempt for this message failed');
  await writePolicy(mind, wakePolicy({ deliveries: { [sent.id]: { state: 'submitted', attempts: 1 } } }));
  assert.deepEqual(await wakeOf(), { live: true, reason: null });

  // The consent of another machine has only its liveness note.
  const remote = (extra) => wakePolicy({ key: key('d'), ...extra }, { machine: 'OTHERBOX', nativeSessionId: 'bob-laptop' });
  await writePolicy(mind, wakePolicy({ enabled: false }));
  await writePolicy(mind, remote({ worker: runningNote(30_000) }), key('d'));
  assert.deepEqual(await wakeOf(), { live: true, reason: null }, 'a note of the last minute');
  await writePolicy(mind, remote({ worker: runningNote(20 * 60_000) }), key('d'));
  assert.deepEqual(await wakeOf(), { live: false, reason: 'no-worker' }, 'a note of twenty minutes ago');
  await writePolicy(mind, remote({ worker: { state: 'stopped', heartbeatAt: new Date().toISOString() } }), key('d'));
  assert.deepEqual(await wakeOf(), { live: false, reason: 'no-worker' }, 'a worker that said it stopped');
  await writePolicy(mind, remote({}), key('d'));
  assert.deepEqual(await wakeOf(), { live: false, reason: 'no-worker' }, 'no note at all');

  // The answers that were already right stay.
  await rm(path.join(policiesOf(mind), `${key('d')}.json`));
  await writePolicy(mind, wakePolicy({ deadlineAt: new Date(Date.now() - 60_000).toISOString() }));
  assert.deepEqual(await wakeOf(), { live: false, reason: 'expired' });
  await writePolicy(mind, wakePolicy({ enabled: false }));
  assert.deepEqual(await wakeOf(), { live: false, reason: 'disabled' });
  await writePolicy(mind, wakePolicy({ pausedReason: 'handoff-budget-exhausted' }));
  assert.deepEqual(await wakeOf(), { live: false, reason: 'handoff-budget-exhausted' });
});

test('R-05: the person tool and the shared rule read the same liveness note', async (context) => {
  const { mind } = await fixture(context);
  const now = Date.now();
  const policy = (extra) => wakePolicy({ worker: runningNote(1000), deadlineAt: null, ...extra });
  assert.equal(store.wakeCanRun(policy(), now), true);
  assert.equal(store.wakeCanRun(policy({ worker: undefined }), now), false, 'no note');
  assert.equal(store.wakeCanRun(policy({ worker: runningNote(4 * 60_000) }), now), false, 'a note older than three minutes');
  assert.equal(store.wakeCanRun(policy({ worker: { state: 'stopped', heartbeatAt: new Date(now).toISOString() } }), now), false, 'a worker that stopped');
  assert.equal(store.wakeCanRun(policy({ maxDailyHandoffs: 1, day: { date: localDate(now), count: 1 } }), now), false, 'the day is spent');
  assert.equal(store.wakeCanRun(policy({ maxDailyHandoffs: 1, day: { date: '2020-01-01', count: 1 } }), now), true);

  await mkdir(path.join(mind, 'user', 'projects', 'shop', 'state'), { recursive: true });
  await writeFile(path.join(mind, 'user', 'routes.md'), '## Projects\n- shop\n');
  await writeFile(path.join(mind, 'user', 'projects', 'shop', 'state', 'executor-shop.md'), 'unit: executor-shop\nstate: in\nmachine: TESTBOX\ndate: 2026-10-08 09:00\n\nWorking.\n');
  const person = await createPersonRelay({ mindPath: mind, tool: 'blueprint', hostname: 'TESTBOX', clock: () => now });
  await writePolicy(mind, wakePolicy({ deadlineAt: null, binding: { unit: 'executor-shop' } }), 'a'.repeat(64));
  assert.equal((await person.agentFor('shop')).awake, false, 'enabled, but no worker said it runs');
  await writePolicy(mind, wakePolicy({ deadlineAt: null, binding: { unit: 'executor-shop' }, worker: runningNote(1000) }), 'a'.repeat(64));
  assert.equal((await person.agentFor('shop')).awake, true);
});

async function oldRegistration(mind, fields) {
  const registrationId = randomUUID();
  const record = { kind: 'registration', registrationId, instanceId: `old-${registrationId}`, unit: 'executor-beta', unitId: 'project:beta:executor-beta', sessionId: randomUUID(),
    scopeId: 'project:beta', client: 'claude', machine: 'TESTBOX', registeredAt: new Date().toISOString(), activity: null, activityObservedAt: null, quota: null, quotaObservedAt: null, ...fields };
  await mkdir(sessionsOf(mind), { recursive: true });
  await writeFile(path.join(sessionsOf(mind), `${registrationId}.json`), `${JSON.stringify(record)}\n`);
  return record;
}

const localDate = (ms) => { const day = new Date(ms); return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`; };
const ago = (hours) => new Date(Date.now() - hours * 3600_000).toISOString();

test('R-08: registering a chat that is already attached reuses its record', async (context) => {
  const { mind } = await fixture(context);
  const first = await createRelay({ mindPath: mind, hostname: 'TESTBOX', sessionId: 'first', client: 'claude' });
  const registered = await first.register({ unit: 'executor-beta', nativeSessionId: 'chat-beta' });
  const [file] = await names(sessionsOf(mind));
  const pinned = JSON.parse(await readFile(path.join(sessionsOf(mind), file), 'utf8'));
  for (let call = 0; call < 4; call += 1) {
    const relay = await createRelay({ mindPath: mind, hostname: 'TESTBOX', sessionId: `call-${call}`, client: 'claude', scopeLock: true, pinnedRegistration: pinned,
      proveBinding: async () => true, commitFile: async (destination, bytes) => writeFile(destination, bytes), sessionLive: async () => null });
    const again = await relay.register({ unit: 'executor-beta', nativeSessionId: 'chat-beta', client: 'claude' });
    assert.equal(again.registrationId, registered.registrationId);
  }
  assert.equal((await names(sessionsOf(mind))).length, 1, 'no record was appended');
});

test('R-08: chats of this machine that vanished without a stop are retired, the quiet and the remote ones are judged by what the store can see', async (context) => {
  const { mind } = await fixture(context);
  const dead = [await oldRegistration(mind, { nativeSessionId: 'crashed-1', registeredAt: ago(72) }), await oldRegistration(mind, { nativeSessionId: 'crashed-2', registeredAt: ago(30) })];
  const quiet = await oldRegistration(mind, { nativeSessionId: 'lunch-break', registeredAt: ago(2) });
  const remoteGone = await oldRegistration(mind, { nativeSessionId: 'laptop-gone', machine: 'OTHERBOX', registeredAt: ago(24 * 30) });
  const remoteNear = await oldRegistration(mind, { nativeSessionId: 'laptop-near', machine: 'OTHERBOX', registeredAt: ago(24) });
  const relay = await createRelay({ mindPath: mind, hostname: 'TESTBOX', sessionId: 'new-chat-server', client: 'claude', sessionLive: async () => null });
  await relay.register({ unit: 'executor-beta', nativeSessionId: 'new-chat' });
  const left = await names(sessionsOf(mind));
  for (const record of dead) assert.equal(left.includes(`${record.registrationId}.json`), false, `${record.nativeSessionId} is retired`);
  for (const record of [quiet, remoteGone, remoteNear]) assert.equal(left.includes(`${record.registrationId}.json`), true, `${record.nativeSessionId} is kept on disk`);
  const listed = (await relay.status({ unit: 'executor-beta' })).units[0].registeredSessions.map((session) => session.nativeSessionId).sort();
  assert.deepEqual(listed, ['laptop-near', 'lunch-break', 'new-chat'], 'a registration of another machine that was last seen a month ago is not listed');
});

test('R-11: policies of chats that are gone do not reach the record limit', async (context) => {
  const { mind } = await fixture(context);
  const alice = await bind(mind, 'executor-alpha', 'wake-alice');
  const bob = await bind(mind, 'executor-beta', 'wake-bob', 'claude', 'bob-native');
  const sent = await alice.send({ to: 'executor-beta', subject: 'Urgent', body: 'urgent', priority: 'urgent' });
  await mkdir(policiesOf(mind), { recursive: true });
  const keyOf = (index) => createHash('sha256').update(`old-chat-${index}`).digest('hex');
  for (let index = 0; index < 520; index += 1) {
    await writeFile(path.join(policiesOf(mind), `${keyOf(index)}.json`), JSON.stringify(wakePolicy({ enabled: false, disabledAt: new Date().toISOString(), disabledReason: 'revoked', key: keyOf(index) }, { nativeSessionId: `old-chat-${index}`, client: 'claude' })));
  }
  const live = createHash('sha256').update('live-chat').digest('hex');
  await writePolicy(mind, wakePolicy({ worker: runningNote(1000), key: live }, { nativeSessionId: 'bob-native', client: 'claude' }), live);
  const delivery = await alice.delivery({ ids: [sent.id] });
  assert.equal(delivery.deliveries.length, 1, 'delivery_status keeps working');
  assert.ok((await readdir(policiesOf(mind))).length < 100, 'the policies of chats without a registration were removed');
  assert.equal((await readdir(policiesOf(mind))).includes(`${live}.json`), true, 'the policy of the attached chat stays');
});

test('R-16: a conflict copy of a state file is not a unit', async (context) => {
  const { mind } = await fixture(context);
  const bob = await bind(mind, 'executor-beta', 'chat-beta');
  const state = path.join(mind, 'user', 'projects', 'beta', 'state');
  await writeFile(path.join(state, 'executor-beta-DESKTOP-ABC1234.md'), 'unit: executor-beta\nstate: in\nmachine: DESKTOP-ABC1234\ndate: 2026-10-04 10:00\n\nOlder copy.\n');
  await writeFile(path.join(state, 'executor-beta-LAPTOP-5K2J9X1.md'), 'state: out\n\nCopy without a unit header.\n');
  await writeFile(path.join(state, 'executor-beta-2.md'), 'unit: executor-beta-2\nstate: in\nmachine: TESTBOX\ndate: 2026-10-05 10:00\n\nA second seat.\n');
  const { units } = await bob.status({});
  assert.deepEqual(units.filter((unit) => unit.scope === 'project:beta').map((unit) => unit.unit).sort(), ['executor-beta', 'executor-beta-2']);
});

test('R-17: a wake lock older than the bound is stale even when its process id is alive', async (context) => {
  const { mind } = await fixture(context);
  const relay = await createRelay({ mindPath: mind, hostname: 'TESTBOX', client: 'claude' });
  const folder = path.join(relayLocalStatePath(await realpath(mind)), 'wake', 'locks');
  await mkdir(folder, { recursive: true });
  const lockKey = createHash('sha256').update('policy-abc').digest('hex');
  const lock = (createdAt) => writeFile(path.join(folder, `${lockKey}.json`), `${JSON.stringify({ kind: 'wake-lock', pid: process.pid, token: randomUUID(), createdAt })}\n`);
  await lock(new Date(Date.now() - 86_400_000).toISOString());
  assert.equal(await relay.wakePersistence.withLock('policy-abc', async () => 'ran'), 'ran');
  await lock(new Date().toISOString());
  await assert.rejects(relay.wakePersistence.withLock('policy-abc', async () => 'ran'), { code: 'WAKE_STORE_BUSY' }, 'a lock of a live process that is fresh is still respected');
});

test('R-18: the wake reason is the one of the chat whose consent is still on', async (context) => {
  const { mind } = await fixture(context);
  const alice = await bind(mind, 'executor-alpha', 'wake-alice');
  await bind(mind, 'executor-beta', 'wake-bob');
  const sent = await alice.send({ to: 'executor-beta', subject: 'Urgent', body: 'urgent', priority: 'urgent' });
  const reasonOf = async () => (await alice.delivery({ ids: [sent.id] })).deliveries[0].wake.reason;
  for (const [current, older] of [['b', 'a'], ['a', 'b']]) {
    await rm(policiesOf(mind), { recursive: true, force: true });
    await writePolicy(mind, wakePolicy({ enabled: false, disabledAt: ago(30), disabledReason: 'revoked' }, { nativeSessionId: 'older' }), older.repeat(64));
    await writePolicy(mind, wakePolicy({ deadlineAt: ago(1) }, { nativeSessionId: 'current' }), current.repeat(64));
    assert.equal(await reasonOf(), 'expired', `the policy file order ${older}, ${current}`);
  }
  await rm(path.join(policiesOf(mind), `${'a'.repeat(64)}.json`));
  await writePolicy(mind, wakePolicy({ enabled: false, disabledAt: ago(1) }, { nativeSessionId: 'current' }), 'b'.repeat(64));
  assert.equal(await reasonOf(), 'disabled', 'with every consent off the reason is that');
});

async function callTool(mind, operations, name, args) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const chunks = [];
  stdout.on('data', (chunk) => chunks.push(chunk));
  const served = serveRelayMcp({ mindPath: mind, client: 'codex', operations, env: {}, stdin, stdout, stderr: new PassThrough() });
  stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })}\n`);
  await served;
  return JSON.parse(Buffer.concat(chunks).toString('utf8').trim()).result;
}

test('R-20: the tool schemas refuse what the store refuses', async (context) => {
  const send = RELAY_TOOLS.find((tool) => tool.name === 'send_message').inputSchema.properties;
  assert.equal(send.subject.maxLength, 240);
  const call = (args) => validateToolArguments('send_message', { to: 'executor-beta', subject: 's', body: 'b', ...args });
  await call({ subject: 'x'.repeat(240) });
  await assert.rejects(call({ subject: 'x'.repeat(241) }), { code: 'INVALID_ARGUMENTS' });
  await call({ body: 'é'.repeat(131072) });
  await assert.rejects(call({ body: 'é'.repeat(131073) }), { code: 'INVALID_ARGUMENTS' }, 'the body is counted in bytes, as the store counts it');
  await call({ body: 'b'.repeat(262144) });
  await assert.rejects(call({ body: 'b'.repeat(262145) }), { code: 'INVALID_ARGUMENTS' });
  await assert.rejects(call({ threadId: 'a'.repeat(181) }), { code: 'INVALID_ARGUMENTS' });
  await assert.rejects(call({ to: 'u'.repeat(81) }), { code: 'INVALID_ARGUMENTS' });
  await assert.rejects(call({ attachments: ['a'.repeat(2049)] }), { code: 'INVALID_ARGUMENTS' });
  await assert.rejects(validateToolArguments('register', { unit: 'u'.repeat(81), nativeSessionId: 'x' }), { code: 'INVALID_ARGUMENTS' });
  await assert.rejects(validateToolArguments('register', { unit: 'executor-beta', nativeSessionId: 'x'.repeat(181) }), { code: 'INVALID_ARGUMENTS' });

  // What the schema lets through, the store accepts.
  const { mind } = await fixture(context);
  const alice = await bind(mind, 'executor-alpha', 'chat-alpha');
  const longest = await callTool(mind, alice, 'send_message', { to: 'executor-beta', subject: 's'.repeat(240), body: 'é'.repeat(131072) });
  assert.equal(longest.isError, undefined);
  const tooLong = await callTool(mind, alice, 'send_message', { to: 'executor-beta', subject: 's'.repeat(241), body: 'b' });
  assert.equal(tooLong.structuredContent.code, 'INVALID_ARGUMENTS');
});
