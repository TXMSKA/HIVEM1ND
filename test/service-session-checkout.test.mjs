import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createNativeAdapter, enqueueStart, registerNative, stopSession } from '../engine/service/adapters.mjs';
import { createCluster } from '../engine/service/clusters.mjs';
import { createUnit } from '../engine/service/units.mjs';
import { directoryIdentity, readRepositoryIdentity } from '../engine/service/cluster-git.mjs';
import { bindLaunchScope } from '../engine/service/file-access.mjs';
import { readSessionCheckout } from '../engine/service/session-checkout.mjs';
import { advanceClock, dispose, makeCoreFixture } from './core-fixture.mjs';

const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0' };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd, windowsHide: true, shell: false, timeout: 30000, encoding: 'utf8', env: GIT_ENV }).trim();

// Two checkouts of one repository: the main folder on main and a worktree on review.
async function world(t) {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const main = path.join(fixture.home, 'Web', 'shop'), work = path.join(fixture.home, 'Web', 'shop-work');
  await mkdir(main, { recursive: true });
  git(main, 'init', '-b', 'main'); await writeFile(path.join(main, 'file.txt'), 'Initial.\n'); git(main, 'add', 'file.txt'); git(main, 'commit', '-m', 'Initial fixture');
  git(main, 'worktree', 'add', '-b', 'review', work);
  const owned = new Set(), pids = new Set();
  const context = { paths: fixture.paths, store: fixture.store, now: () => fixture.clock.now, principal: { audience: 'desktop', unitId: 'root:master' },
    projects: [], ownedPids: pids, adapters: { codex: { confirm: async proof => owned.has(proof.nativeSessionId) } } };
  let pid = 4000;
  // A launched session the way a start leaves it: a registration, a bound owner-local scope and a registered journal.
  async function launch(name, { directory = null, kind = 'repository', launchKind = 'cli', bind = true, journal = true } = {}) {
    const nativeSessionId = `native-${name}`, unitId = `root:${name}`;
    const registration = await registerNative(context, { client: 'codex', nativeSessionId, unitId, launchKind });
    if (bind) {
      const repository = kind === 'repository' ? await readRepositoryIdentity(directory, context) : null;
      const scope = { id: randomUUID(), sessionId: registration.sessionId, attemptId: null, unitId, clusterId: null, machine: fixture.machine,
        repositoryId: repository?.id ?? null, readScope: [unitId], contentScope: { additionIds: [], scopeRevision: null },
        writeRoots: directory ? [{ realPath: directory, identity: await directoryIdentity(directory), gitCommonDir: repository?.commonDir ?? null }] : [],
        git: { commit: false, push: false, intentId: null } };
      if (!directory) {
        const cwd = path.join(fixture.paths.localDirectory, 'sessions', randomUUID()); await mkdir(cwd, { recursive: true });
        scope.launchCwd = cwd; scope.launchCwdIdentity = await directoryIdentity(cwd);
      }
      await bindLaunchScope(context, scope, registration, ++pid);
      if (journal) {
        await mkdir(path.join(fixture.paths.localDirectory, 'session-starts'), { recursive: true });
        await writeFile(path.join(fixture.paths.localDirectory, 'session-starts', `${randomUUID()}.json`), JSON.stringify({ requestId: randomUUID(), unitId, client: 'codex',
          phase: 'registered', pid, sessionId: registration.sessionId, nativeSessionId, createAttempted: true }));
        pids.add(pid); owned.add(nativeSessionId);
      }
    }
    return { sessionId: registration.sessionId, nativeSessionId, registration };
  }
  const stop = session => owned.delete(session.nativeSessionId);
  const read = sessionId => readSessionCheckout(context, sessionId);
  return { fixture, context, main, work, launch, stop, read };
}

test('two checkouts of one repository report two different folders and branches', async t => {
  const { fixture, main, work, launch, read } = await world(t);
  const first = await launch('first', { directory: main }), second = await launch('second', { directory: work });
  const one = await read(first.sessionId), two = await read(second.sessionId);
  assert.deepEqual([one.path, one.kind, one.branch, one.detached, one.live], [main, 'repository', 'main', false, true]);
  assert.deepEqual([two.path, two.kind, two.branch, two.detached, two.live], [work, 'worktree', 'review', false, true]);
  assert.equal(one.head, git(main, 'rev-parse', 'HEAD')); assert.equal(two.head, one.head);
  assert.equal(one.repositoryId, two.repositoryId); assert.ok(one.repositoryId);
  assert.equal(one.observedAt, new Date(fixture.clock.now).toISOString());
  assert.deepEqual(Object.keys(one).sort(), ['branch', 'detached', 'head', 'kind', 'live', 'observedAt', 'path', 'repositoryId', 'sessionId']);
});

test('an unlinked launch reports its actual immutable cwd after registration changes the session id', async t => {
  const fixture = await makeCoreFixture();
  const adapter = createNativeAdapter('codex', { fixture: true, models: ['observed'], transcript: [JSON.stringify({ id: 1, result: { thread: { id: 'actual-private-session' } } })] });
  const launches = [], create = adapter.create.bind(adapter);
  adapter.create = async input => { launches.push(input); return create(input); };
  const context = { paths: { ...fixture.paths, origin: path.join(fixture.root, 'origin') }, store: fixture.store,
    now: () => fixture.clock.now, principal: { audience: 'desktop', unitId: 'root:master' },
    projects: [], ownedPids: new Set(), adapters: { codex: adapter },
    beat: { state: 'running', heartbeatAt: new Date(fixture.clock.now).toISOString() } };
  let sessionId;
  t.after(async () => { if (sessionId) await stopSession(context, sessionId, { confirmed: true }); await adapter.close(); await dispose(fixture); });
  await mkdir(path.join(context.paths.origin, 'machines', fixture.machine), { recursive: true });
  await writeFile(path.join(context.paths.origin, 'machines', fixture.machine, 'service.json'), JSON.stringify(context.beat));
  const cluster = await createCluster(context, { title: 'Planning', parentId: null, link: { kind: 'none' }, members: [], machine: fixture.machine, confirmed: true });
  const made = await createUnit(context, { clusterId: cluster.id, role: 'executor', machine: fixture.machine,
    runsIn: { client: 'codex', model: 'observed', effort: 'high', mode: null }, useAsDefault: false, expectedRevision: cluster.revision });
  const started = await enqueueStart(context, { unitId: made.unit.id, runMode: 'chat', stateRevision: made.unit.revision });
  assert.equal(started.result.state, 'started');
  sessionId = started.result.sessionId;
  assert.equal(launches.length, 1);
  assert.notEqual(path.basename(launches[0].cwd), sessionId, 'The start request and registration have different identities.');
  const reading = await readSessionCheckout(context, sessionId);
  assert.deepEqual([reading.path, reading.kind, reading.live], [launches[0].cwd, 'private', true]);
  await rename(launches[0].cwd, `${launches[0].cwd}-old`); await mkdir(launches[0].cwd);
  context.store.checkoutCache.clear();
  assert.deepEqual(await readSessionCheckout(context, sessionId), { sessionId, known: false, reason: 'unverified' });
});

test('the answer is kept for 15 seconds and a detached head reports its commit', async t => {
  const { fixture, work, launch, read } = await world(t);
  const session = await launch('worker', { directory: work });
  assert.equal((await read(session.sessionId)).branch, 'review');
  git(work, 'checkout', '--detach');
  assert.equal((await read(session.sessionId)).branch, 'review', 'Git is not asked again inside the window.');
  advanceClock(fixture, 14999);
  assert.equal((await read(session.sessionId)).branch, 'review');
  advanceClock(fixture, 1);
  const detached = await read(session.sessionId);
  assert.deepEqual([detached.detached, detached.branch, detached.kind], [true, null, 'worktree']);
  assert.equal(detached.head, git(work, 'rev-parse', 'HEAD'));
  git(work, 'switch', 'review'); advanceClock(fixture, 15000);
  assert.deepEqual([(await read(session.sessionId)).branch, (await read(session.sessionId)).detached], ['review', false]);
});

test('a stopped session keeps its last reading marked as no longer live', async t => {
  const { fixture, work, launch, stop, read, context } = await world(t);
  const session = await launch('worker', { directory: work });
  const seen = await read(session.sessionId);
  git(work, 'switch', '-c', 'later'); stop(session); context.store.checkoutCache.delete(session.sessionId);
  advanceClock(fixture, 600000);
  const last = await read(session.sessionId);
  assert.equal(last.live, false);
  assert.deepEqual([last.branch, last.path, last.kind, last.head, last.observedAt], [seen.branch, seen.path, seen.kind, seen.head, seen.observedAt]);
  assert.equal(last.branch, 'review');
  const never = await launch('never', { directory: work }); stop(never);
  assert.deepEqual(await read(never.sessionId), { sessionId: never.sessionId, known: false, reason: 'not_observed' });
});

test('manual, unverified and other machines are reported as not known and never guessed', async t => {
  const { fixture, main, launch, read, context } = await world(t);
  const manual = await launch('manual', { launchKind: 'manual-app', bind: false });
  assert.deepEqual(await read(manual.sessionId), { sessionId: manual.sessionId, known: false, reason: 'manual' });
  const unstarted = await launch('unstarted', { bind: false });
  assert.deepEqual(await read(unstarted.sessionId), { sessionId: unstarted.sessionId, known: false, reason: 'not_observed' });
  const nameless = await launch('nameless', { directory: main });
  await rm(path.join(fixture.paths.localDirectory, 'sessions', nameless.sessionId, 'scope.json')); context.store.checkoutCache.clear();
  assert.deepEqual(await read(nameless.sessionId), { sessionId: nameless.sessionId, known: false, reason: 'unverified' });
  const foreign = await registerNative({ ...context, paths: { ...fixture.paths, machine: 'LAPTOP' } }, { client: 'codex', nativeSessionId: 'native-foreign', unitId: 'root:foreign', launchKind: 'cli' });
  assert.deepEqual(await read(foreign.sessionId), { sessionId: foreign.sessionId, known: false, reason: 'other_machine' });
  await assert.rejects(read(randomUUID()), { code: 'session_not_found', status: 404 });
  await assert.rejects(read('not-a-session'), { code: 'session_not_found' });
});

test('a replaced folder is unverified, a broken repository is unavailable and a folder or a private directory names itself without Git', async t => {
  const { fixture, main, launch, read } = await world(t);
  const plain = path.join(fixture.home, 'notes'); await mkdir(plain);
  const folder = await launch('folder', { directory: plain, kind: 'folder' }), priv = await launch('private', { kind: 'private' });
  const noted = await read(folder.sessionId), alone = await read(priv.sessionId);
  assert.deepEqual([noted.path, noted.kind, noted.repositoryId, noted.branch, noted.head, noted.detached], [plain, 'folder', null, null, null, false]);
  assert.equal(path.dirname(alone.path), path.join(fixture.paths.localDirectory, 'sessions'));
  assert.notEqual(path.basename(alone.path), priv.sessionId);
  assert.deepEqual([alone.kind, alone.branch], ['private', null]);
  const replaced = await launch('replaced', { directory: plain, kind: 'folder' });
  await rename(plain, `${plain}-old`); await mkdir(plain);
  assert.deepEqual(await read(replaced.sessionId), { sessionId: replaced.sessionId, known: false, reason: 'unverified' });
  const broken = await launch('broken', { directory: main });
  await rm(path.join(main, '.git'), { recursive: true, force: true }); await writeFile(path.join(main, '.git'), 'gitdir: nowhere\n');
  assert.deepEqual(await read(broken.sessionId), { sessionId: broken.sessionId, known: false, reason: 'git_unavailable' });
});

test('only an authorized desktop reads a checkout', async t => {
  const { context, work, launch } = await world(t);
  const session = await launch('worker', { directory: work });
  for (const principal of [{ audience: 'phone' }, { audience: 'agent', unitId: 'root:worker', sessionId: session.sessionId }, { audience: 'desktop', capabilities: ['chat.post'] }, undefined]) {
    await assert.rejects(readSessionCheckout({ ...context, principal }, session.sessionId), { code: 'forbidden', status: 403 });
  }
  assert.equal((await readSessionCheckout({ ...context, principal: { audience: 'desktop', capabilities: ['read'] } }, session.sessionId)).kind, 'worktree');
});
