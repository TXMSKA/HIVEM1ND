import './relay-local-state.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fsPromises, { mkdtemp, mkdir, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRelay } from '../engine/relay/store.mjs';

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-relay-speed-'));
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

// Alice sends `total` messages to Bob, who reads the first `read` of them, so the mind holds both archived and unread files.
async function populate(mind, total, read) {
  const alice = await bind(mind, 'executor-alpha', 'chat-alpha');
  const bob = await bind(mind, 'executor-beta', 'chat-beta');
  const sent = [];
  for (let index = 0; index < total; index += 1) sent.push((await alice.send({ to: 'executor-beta', subject: `Message ${index}`, body: `Body ${index}` })).id);
  if (read > 0) assert.equal((await bob.read({ limit: read })).messages.length, read);
  return { alice, bob, sent };
}

// Every call the store makes to these filesystem functions while `action` runs, with the path it was given.
async function countFs(action, methods = ['lstat', 'realpath', 'open', 'readdir']) {
  const calls = [];
  const originals = new Map();
  for (const method of methods) {
    const original = fsPromises[method];
    originals.set(method, original);
    fsPromises[method] = (...args) => { calls.push({ method, target: path.resolve(String(args[0])) }); return original(...args); };
  }
  syncBuiltinESMExports();
  try { await action(); } finally {
    for (const [method, original] of originals) fsPromises[method] = original;
    syncBuiltinESMExports();
  }
  return calls;
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

const isMessageFile = (call) => call.target.endsWith('.md') && /[\\/](?:inbox|archive)[\\/]/.test(call.target);
const messageOpens = (calls) => calls.filter((call) => call.method === 'open' && isMessageFile(call)).length;
const folderCalls = (calls) => calls.filter((call) => !call.target.endsWith('.md') && !call.target.endsWith('.json')).length;

const betaInbox = (mind) => path.join(mind, 'user', 'projects', 'beta', 'inbox', 'executor-beta');
const betaArchive = (mind) => path.join(mind, 'user', 'relay', 'archive', 'executor-beta');
const sessionsOf = (mind) => path.join(mind, 'user', 'relay', 'sessions');
const eventsOf = (mind) => path.join(mind, 'user', 'relay', 'events');
const names = async (directory) => (await readdir(directory).catch(() => [])).filter((name) => name.endsWith('.md') || name.endsWith('.json')).sort();

test('R-09: a call that reads the whole mind checks each folder once, however many messages it holds', async (context) => {
  const small = await populate((await fixture(context)).mind, 8, 4);
  const large = await populate((await fixture(context)).mind, 40, 24);
  const smallCalls = await countFs(() => small.alice.history({ limit: 5 }));
  const largeCalls = await countFs(() => large.alice.history({ limit: 5 }));
  assert.equal((await large.alice.history({ limit: 100 })).messages.length, 40);
  // The folders are walked on the first file and not again: 32 more messages add no call on a folder.
  assert.ok(folderCalls(largeCalls) - folderCalls(smallCalls) <= 4, `folder calls: ${folderCalls(smallCalls)} for 8 messages, ${folderCalls(largeCalls)} for 40`);
  // A message file costs a look at the file itself: its entry, its path, its content and the check after reading it.
  const perFile = (largeCalls.length - smallCalls.length) / 32;
  assert.ok(perFile <= 12, `${perFile} filesystem calls per message`);
});

test('R-09: the checks of a call are its own, so a folder swapped for a junction between two calls is refused by the second', async (context) => {
  const { mind, root } = await fixture(context);
  const { alice, sent } = await populate(mind, 12, 12);
  assert.equal((await alice.delivery({ ids: sent.slice(0, 10) })).deliveries.every((item) => item.read), true);
  const outside = path.join(root, 'outside');
  await mkdir(outside);
  await rm(betaArchive(mind), { recursive: true, force: true });
  try { await symlink(outside, betaArchive(mind), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error;
    context.skip('The host does not permit creating an isolated junction or symlink.');
    return;
  }
  await assert.rejects(alice.delivery({ ids: sent.slice(0, 10) }), (error) => error?.code === 'UNSAFE_SYMLINK');
});

test('R-09: a file NTFS is deleting in the middle of a scan is skipped, the folder it is in stays checked', async (context) => {
  const { mind } = await fixture(context);
  const { alice } = await populate(mind, 30, 0);
  const files = await names(betaInbox(mind));
  const going = path.join(betaInbox(mind), files[20]);
  let answered = 0;
  const restore = await interceptFs('realpath', async (original, args) => {
    if (!answered && path.resolve(String(args[0])) === going) {
      // Another reader archives the file: its name is gone and the volume answers with its internal deleted area.
      answered += 1;
      await unlink(going);
      return `C:\\$Extend\\$Deleted\\${randomUUID().replaceAll('-', '')}`;
    }
    return original(...args);
  });
  let history;
  try { history = await alice.history({}); } finally { restore(); }
  assert.equal(answered, 1);
  assert.equal(history.messages.length, 29);
});

test('R-09: delivery_status finds a message that has no event by its file name and reads no other message', async (context) => {
  const { mind } = await fixture(context);
  const { alice, sent } = await populate(mind, 30, 20);
  // Which twenty were read depends on the file names, which carry the second they were sent in and then their ids.
  const archived = await names(betaArchive(mind));
  const wasRead = (id) => archived.some((name) => name.endsWith(`-${id}.md`));
  const lost = sent.find(wasRead);
  const waiting = sent.find((id) => !wasRead(id));
  await unlink(path.join(eventsOf(mind), `${lost}.json`));
  const unknownCalls = await countFs(async () => {
    const answer = await alice.delivery({ ids: [randomUUID()] });
    assert.equal(answer.deliveries.length, 0);
    assert.equal(answer.unknown.length, 1);
  });
  assert.equal(messageOpens(unknownCalls), 0, 'an unknown id opens no message');
  const foundCalls = await countFs(async () => {
    const answer = await alice.delivery({ ids: [lost, waiting] });
    assert.deepEqual(answer.deliveries.map((item) => [item.id, item.stage, item.read]), [[lost, 'read', true], [waiting, 'published', false]]);
    assert.deepEqual(answer.unknown, []);
  });
  assert.ok(messageOpens(foundCalls) <= 3, `${messageOpens(foundCalls)} messages opened`);
});

test('R-09: events reads only the messages that have no event', async (context) => {
  const { mind } = await fixture(context);
  const { alice, sent } = await populate(mind, 30, 20);
  let all;
  const quiet = await countFs(async () => { all = await alice.events({ limit: 100 }); });
  assert.equal(all.events.length, 30);
  assert.equal(messageOpens(quiet), 0, 'every message has its event');
  await unlink(path.join(eventsOf(mind), `${sent[4]}.json`));
  await unlink(path.join(eventsOf(mind), `${sent[27]}.json`));
  const repair = await countFs(async () => { all = await alice.events({ limit: 100 }); });
  assert.equal(all.events.length, 30, 'the two events are built again from their messages');
  assert.equal(messageOpens(repair), 2);
  assert.equal((await names(eventsOf(mind))).length, 30);
});

test('R-10: register reads every registration once, and status once', async (context) => {
  const { mind } = await fixture(context);
  for (const [unit, count] of [['executor-alpha', 8], ['executor-beta', 8], ['overseer', 8]]) {
    for (let index = 0; index < count; index += 1) await bind(mind, unit, `${unit}-${index}`, 'codex', `${unit}-native-${index}`);
  }
  const registrations = (await names(sessionsOf(mind))).length;
  assert.equal(registrations, 24);
  const opensOfSessions = (calls) => calls.filter((call) => call.method === 'open' && path.dirname(call.target) === sessionsOf(mind)).length;
  const fresh = await createRelay({ mindPath: mind, hostname: 'TESTBOX', sessionId: 'late', client: 'codex' });
  const registering = await countFs(() => fresh.register({ unit: 'executor-alpha', nativeSessionId: 'late-native' }));
  assert.ok(opensOfSessions(registering) <= registrations + 6, `${opensOfSessions(registering)} registration files opened by one register`);
  const statusCalls = await countFs(async () => { assert.equal((await fresh.status({})).units.length >= 3, true); });
  assert.ok(opensOfSessions(statusCalls) <= registrations + 3, `${opensOfSessions(statusCalls)} registration files opened by one status`);
  // A chat that registers again with nothing new to record is answered from the index and reads no registration but its own.
  const again = await createRelay({ mindPath: mind, hostname: 'TESTBOX', sessionId: 'late-again', client: 'codex' });
  const repeat = await countFs(() => again.register({ unit: 'executor-alpha', nativeSessionId: 'late-native' }));
  assert.ok(opensOfSessions(repeat) <= 2, `${opensOfSessions(repeat)} registration files opened by a repeated register`);
  assert.equal((await names(sessionsOf(mind))).length, registrations + 1, 'and writes no second record');
});

test('R-15: the unread count is exact and a reminder costs a few filesystem calls per unread message', async (context) => {
  const { mind } = await fixture(context);
  const { bob } = await populate(mind, 60, 0);
  let reminder;
  const calls = await countFs(async () => { reminder = await bob.reminder({ nativeSessionId: 'chat-beta-native', client: 'codex' }); });
  assert.equal(reminder.unread, 60);
  assert.deepEqual(reminder.from, ['executor-alpha']);
  assert.ok(calls.length / 60 <= 14, `${calls.length / 60} filesystem calls per unread message`);
  // The limit cuts what is returned and not what is counted.
  const listed = await bob.inbox({ limit: 5 });
  assert.equal(listed.unread, 60);
  assert.deepEqual(listed.messages.map((message) => message.subject), [0, 1, 2, 3, 4].map((index) => `Message ${index}`));
  assert.deepEqual(listed.malformed, []);
  const wide = await bob.inbox({ limit: 500 });
  assert.deepEqual(wide.messages.map((message) => message.subject), Array.from({ length: 60 }, (_, index) => `Message ${index}`));
});

test('R-15: a malformed file and a late read copy do not change the count of the others', async (context) => {
  const { mind } = await fixture(context);
  const { bob } = await populate(mind, 20, 0);
  const files = await names(betaInbox(mind));
  const read = await bob.read({ ids: [(await bob.inbox({ limit: 1 })).messages[0].id] });
  assert.equal(read.messages.length, 1);
  // Its twin arrives again from another machine, and a broken file lands beside the rest.
  const archived = await names(betaArchive(mind));
  await writeFile(path.join(betaInbox(mind), archived[0]), await readFile(path.join(betaArchive(mind), archived[0])));
  const broken = files.at(-1).replace(/-[0-9a-f-]{36}\.md$/, '-deadbeef-dead-beef-dead-beefdeadbeef.md');
  await writeFile(path.join(betaInbox(mind), broken), 'not a message');
  const listed = await bob.inbox({ limit: 3 });
  assert.equal(listed.unread, 19);
  assert.equal(listed.messages.length, 3);
  assert.deepEqual(listed.malformed, [broken]);
});

test('R-01: a message cut anywhere inside its body waits for the rest', async (context) => {
  const { mind } = await fixture(context);
  const alice = await bind(mind, 'executor-alpha', 'chat-alpha');
  const bob = await bind(mind, 'executor-beta', 'chat-beta');
  await alice.send({ to: 'executor-beta', subject: 'Long', body: 'x'.repeat(600) });
  const [name] = await names(betaInbox(mind));
  const file = path.join(betaInbox(mind), name);
  const complete = await readFile(file);
  const bodyStart = complete.indexOf('\n\n') + 2;
  assert.equal(complete.length - bodyStart, 600);
  for (const cut of [bodyStart, bodyStart + 1, bodyStart + 300, complete.length - 1]) {
    await writeFile(file, complete.subarray(0, cut));
    const listed = await bob.inbox();
    assert.equal(listed.unread, 0, `a copy cut at ${cut - bodyStart} body bytes is not listed`);
    assert.deepEqual(listed.malformed, [name]);
    assert.equal((await bob.read()).messages.length, 0);
    assert.deepEqual(await names(betaArchive(mind)), [], 'and not archived');
  }
  await writeFile(file, complete);
  assert.equal((await bob.inbox()).unread, 1);
  const read = await bob.read();
  assert.equal(read.messages.length, 1);
  assert.equal(read.messages[0].body, 'x'.repeat(600));
  assert.deepEqual(await readFile(path.join(betaArchive(mind), name)), complete);
  assert.match(complete.subarray(0, bodyStart).toString('utf8'), /^body-bytes: 600$/m, 'the file declares the size of its body');
});

test('R-01: a cut inside a multi-byte character is a cut, not a shorter message', async (context) => {
  const { mind } = await fixture(context);
  const alice = await bind(mind, 'executor-alpha', 'chat-alpha');
  const bob = await bind(mind, 'executor-beta', 'chat-beta');
  const body = 'é雪'.repeat(40);
  await alice.send({ to: 'executor-beta', subject: 'Wide', body });
  const [name] = await names(betaInbox(mind));
  const file = path.join(betaInbox(mind), name);
  const complete = await readFile(file);
  const bodyStart = complete.indexOf('\n\n') + 2;
  assert.equal(complete.length - bodyStart, Buffer.byteLength(body));
  // Each pair is five bytes, 2 and 3; these cuts leave a part of a character at the end, which text decodes as one whole character.
  for (const at of [1, 3, 4, 101, 103, 104, 199]) {
    await writeFile(file, complete.subarray(0, bodyStart + at));
    assert.equal((await bob.inbox()).unread, 0, `cut after ${at} body bytes`);
  }
  await writeFile(file, complete);
  assert.equal((await bob.read()).messages[0].body, body);
});

test('R-01: a message without the size header is taken as before, and a header that is wrong is refused', async (context) => {
  const { mind } = await fixture(context);
  const alice = await bind(mind, 'executor-alpha', 'chat-alpha');
  const bob = await bind(mind, 'executor-beta', 'chat-beta');
  await alice.send({ to: 'executor-beta', subject: 'New', body: 'seven b' });
  const [name] = await names(betaInbox(mind));
  const file = path.join(betaInbox(mind), name);
  const complete = (await readFile(file, 'utf8'));
  // A file of an older kit or of another machine declares nothing.
  const older = complete.replace(/^body-bytes: .*\n/m, '');
  assert.notEqual(older, complete);
  await writeFile(file, older);
  assert.equal((await bob.inbox()).unread, 1);
  // A body shorter than its size, or a size that is not a number, is not a whole message.
  for (const header of ['body-bytes: 8', 'body-bytes: seven']) {
    await writeFile(file, complete.replace(/^body-bytes: .*$/m, header));
    const listed = await bob.inbox();
    assert.equal(listed.unread, 0, header);
    assert.deepEqual(listed.malformed, [name]);
  }
  // A longer body, as after a line ending conversion, is whole.
  await writeFile(file, complete.replace(/^body-bytes: .*$/m, 'body-bytes: 6'));
  assert.equal((await bob.inbox()).unread, 1);
  await writeFile(file, complete);
  const read = await bob.read();
  assert.deepEqual(read.messages.map((message) => message.body), ['seven b']);
});

test('R-01: the size header is in the file and in no answer of a tool', async (context) => {
  const { mind } = await fixture(context);
  const alice = await bind(mind, 'executor-alpha', 'chat-alpha');
  const bob = await bind(mind, 'executor-beta', 'chat-beta');
  const sent = await alice.send({ to: 'executor-beta', subject: 'Plain', body: 'Plain body', replyRequested: true });
  const [name] = await names(betaInbox(mind));
  assert.match(await readFile(path.join(betaInbox(mind), name), 'utf8'), /^body-bytes: 10$/m);
  const answers = [await bob.inbox(), await bob.reminder({ nativeSessionId: 'chat-beta-native', client: 'codex' }), await alice.history({}), await alice.threads(),
    await alice.events(), await alice.delivery({ ids: [sent.id] }), await bob.read(), await alice.history({})];
  for (const answer of answers) assert.doesNotMatch(JSON.stringify(answer), /body-?bytes/i);
});
