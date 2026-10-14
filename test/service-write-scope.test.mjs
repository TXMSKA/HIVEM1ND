import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { approveScopedGit, readScopedFile, requestNativeOperation, requestScopedGit, runScopedGit, verifiedSessionScope, writeScopedFile } from '../engine/service/file-access.mjs';
import { answerApproval, readApproval } from '../engine/service/approvals.mjs';
import { createCluster } from '../engine/service/clusters.mjs';
import { directoryIdentity, readRepositoryIdentity } from '../engine/service/cluster-git.mjs';
import { createNativeAdapter, enqueueStart, stopSession } from '../engine/service/adapters.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const run = promisify(execFile);
async function git(directory, ...args) { return (await run('git', args, { cwd: directory, windowsHide: true, timeout: 10000,
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' } })).stdout.trim(); }

async function world(t) {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const repository = path.join(fixture.root, 'repository'); await mkdir(repository);
  await git(repository, 'init', '--initial-branch=main'); await git(repository, 'config', 'user.name', 'Fixture'); await git(repository, 'config', 'user.email', 'fixture@example.invalid');
  for (const file of ['task.txt', 'foreign.txt']) await writeFile(path.join(repository, file), 'original');
  await git(repository, 'add', '--', 'task.txt', 'foreign.txt'); await git(repository, 'commit', '-m', 'Fixture baseline');
  const unitId = 'project:shop:worker', choice = { client: 'codex', model: 'verified-model', effort: 'high', mode: null };
  const state = `unit: worker\nunit-id: ${unitId}\nrole: executor\nstate: in\nmachine: DESKTOP\nruns-in: ${JSON.stringify(choice)}\n\nReady.\n`;
  await mkdir(path.join(fixture.paths.mind, 'user', 'state'), { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'worker.md'), state);
  const adapter = createNativeAdapter('codex', { fixture: true, models: ['verified-model'], transcript: ['{"id":1,"result":{"thread":{"id":"owned-thread"}}}'] });
  t.after(() => adapter.close());
  const context = { store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, projects: [{ name: 'shop', localPath: repository }],
    adapters: { codex: adapter }, ownedPids: new Set(), beat: { state: 'running', heartbeatAt: new Date(fixture.clock.now).toISOString() }, principal: { audience: 'desktop', unitId: 'root:master' } };
  const identity = await readRepositoryIdentity(repository);
  await writeFile(path.join(fixture.paths.localDirectory, 'cluster-links.json'), JSON.stringify({ format: 'hivem1nd-cluster-links-v1', machine: 'DESKTOP', links: {
    'repository:shop': { localPath: repository, machine: 'DESKTOP', identity: await directoryIdentity(repository), repositoryId: identity.id },
  } }));
  await createCluster(context, { title: 'Shop', members: [unitId], parentId: null, link: { kind: 'repository', projectId: 'shop' }, machine: 'DESKTOP', confirmed: true });
  const permissionFile = path.join(fixture.paths.localDirectory, 'client-permissions.json');
  await writeFile(permissionFile, JSON.stringify({ permissions: [{ id: randomUUID(), machine: 'DESKTOP', client: 'codex', actions: ['git.commit', 'git.push'],
    scope: 'hivem1nd-started-sessions', grantedAt: new Date(fixture.clock.now).toISOString(), grantedBy: 'root:master' }] }));
  const started = await enqueueStart(context, { unitId, runMode: 'chat', stateRevision: hashBytes(Buffer.from(state)) });
  const sessionId = started.result.sessionId, actor = { ...context, principal: { audience: 'agent', unitId, sessionId } };
  const instruction = { confirmed: true, sessionId, repository, branch: 'main', paths: ['task.txt'], action: 'git.commit', message: 'Apply reviewed task' };
  return { fixture, context, actor, repository, instruction, permissionFile, sessionId };
}

test('Git metadata never becomes ordinary file or native write authority', async t => {
  const { actor, repository } = await world(t);
  const file = path.join(repository, '.git', 'index'), before = await readFile(file);
  await assert.rejects(readScopedFile(actor, { path: file }), { code: 'scope_unavailable' });
  await assert.rejects(writeScopedFile(actor, { path: file, text: 'unreviewed', expectedRevision: hashBytes(before) }), { code: 'scope_unavailable' });
  let permits = 0;
  assert.equal(await requestNativeOperation(actor, { id: 'metadata-write', nativeSessionId: 'owned-thread', kind: 'write', paths: [file] },
    { verified: true, authorize: async () => { permits += 1; return { authorized: true }; } }), false);
  assert.equal(permits, 0);
  assert.deepEqual(await readFile(file), before);
});

test('Git capability never supplies intent, while an explicit commit preserves foreign staged work', async t => {
  const { actor, context, repository, instruction } = await world(t);
  await writeFile(path.join(repository, 'task.txt'), 'reviewed'); await writeFile(path.join(repository, 'foreign.txt'), 'foreign staged');
  await git(repository, 'add', '--', 'foreign.txt');
  const staged = await git(repository, 'show', ':foreign.txt'), head = await git(repository, 'rev-parse', 'HEAD');
  await assert.rejects(runScopedGit(actor, { intentId: randomUUID() }), { code: 'git_intent_required' });
  await assert.rejects(approveScopedGit(actor, instruction), { code: 'git_intent_required' });
  assert.equal(await git(repository, 'rev-parse', 'HEAD'), head);
  const approved = await approveScopedGit(context, instruction);
  assert.equal((await runScopedGit(actor, approved)).state, 'done');
  assert.equal(await git(repository, 'show', 'HEAD:task.txt'), 'reviewed');
  assert.equal(await git(repository, 'show', 'HEAD:foreign.txt'), 'original');
  assert.equal(await git(repository, 'diff', '--cached', '--name-only'), 'foreign.txt');
  assert.equal(await git(repository, 'show', ':foreign.txt'), staged);
  const committed = await git(repository, 'rev-parse', 'HEAD');
  assert.equal((await runScopedGit(actor, approved)).state, 'done');
  assert.equal(await git(repository, 'rev-parse', 'HEAD'), committed);
  await assert.rejects(runScopedGit(actor, { intentId: randomUUID() }), { code: 'git_intent_required' });
});

test('changed head, index, branch, reviewed paths or remote configuration cause zero Git writes', async t => {
  for (const drift of ['head', 'index', 'branch', 'path', 'remote']) {
    await t.test(drift, async t => {
      const { actor, context, repository, instruction } = await world(t);
      await writeFile(path.join(repository, 'task.txt'), 'reviewed');
      const approved = await approveScopedGit(context, instruction);
      if (drift === 'head') await git(repository, 'commit', '--allow-empty', '-m', 'Foreign head');
      if (drift === 'index') { await writeFile(path.join(repository, 'foreign.txt'), 'staged elsewhere'); await git(repository, 'add', '--', 'foreign.txt'); }
      if (drift === 'branch') await git(repository, 'switch', '-c', 'foreign-branch');
      if (drift === 'path') await writeFile(path.join(repository, 'task.txt'), 'changed after review');
      if (drift === 'remote') await git(repository, 'config', 'remote.origin.url', path.join(repository, 'different'));
      const before = await readFile(path.join(repository, '.git', 'index')), head = await git(repository, 'rev-parse', 'HEAD');
      await assert.rejects(runScopedGit(actor, approved), { code: 'git_changed' });
      assert.deepEqual(await readFile(path.join(repository, '.git', 'index')), before);
      assert.equal(await git(repository, 'rev-parse', 'HEAD'), head);
    });
  }
});

test('revocation, manual actors and automatic closure cannot use a scoped Git instruction', async t => {
  const { actor, context, repository, instruction, permissionFile, sessionId } = await world(t);
  await writeFile(path.join(repository, 'task.txt'), 'reviewed');
  const approved = await approveScopedGit(context, instruction), before = await git(repository, 'rev-parse', 'HEAD');
  await writeFile(permissionFile, JSON.stringify({ permissions: [] }));
  await assert.rejects(runScopedGit(actor, approved), { code: 'git_capability_required' });
  await assert.rejects(verifiedSessionScope({ ...actor, principal: { ...actor.principal, sessionId: randomUUID() } }));
  await stopSession(context, sessionId, { confirmed: true });
  assert.equal(await git(repository, 'rev-parse', 'HEAD'), before);
  assert.equal(await readFile(path.join(repository, 'task.txt'), 'utf8'), 'reviewed');
  await assert.rejects(runScopedGit(actor, approved), { code: 'scope_unavailable' });
});

test('a push requires its own exact instruction and targets only the named branch and remote', async t => {
  const { actor, context, repository, instruction, fixture } = await world(t);
  const remote = path.join(fixture.root, 'remote.git'); await mkdir(remote); await git(remote, 'init', '--bare');
  await git(repository, 'remote', 'add', 'reviewed', remote);
  const approved = await approveScopedGit(context, { ...instruction, action: 'git.push', remote: 'reviewed' });
  assert.equal((await runScopedGit(actor, approved)).action, 'git.push');
  assert.equal(await git(remote, 'rev-parse', 'refs/heads/main'), await git(repository, 'rev-parse', 'HEAD'));
  const relay = await readFile(new URL('../commands/relay.md', import.meta.url), 'utf8');
  assert.match(relay, /`\/relay out` alone records the handoff and releases claims/);
  assert.match(relay, /separate explicit instruction/);
  assert.doesNotMatch(relay, /Running the exit is the user's yes/);
});

test('an agent requests Git consent through the real approval record and cannot approve its own intent', async t => {
  const { actor, context, repository, instruction } = await world(t);
  await writeFile(path.join(repository, 'task.txt'), 'reviewed');
  const requested = await requestScopedGit(actor, instruction), head = await git(repository, 'rev-parse', 'HEAD');
  const approval = await readApproval(context, requested.approvalId);
  assert.equal(approval.alwaysAllowed, false); assert.equal(approval.action, 'git.commit');
  await assert.rejects(runScopedGit(actor, requested), { code: 'git_intent_required' });
  assert.equal(await git(repository, 'rev-parse', 'HEAD'), head);
  await answerApproval(context, approval.id, { decision: 'approve', expectedRevision: approval.revision });
  assert.equal((await runScopedGit(actor, requested)).state, 'done');
});

test('native indirect writes require exact person consent and a verified once-only sandbox permit', async t => {
  for (const decision of ['approve', 'deny', 'expired']) await t.test(decision, async t => {
    const { actor, context, repository, fixture } = await world(t);
    const authorized = [], operation = { id: 'native-option-id', kind: 'process', command: 'node task-build.mjs', cwd: repository,
      nativeSessionId: 'owned-thread', protocol: 'codex', payload: { itemId: 'native-item' } };
    actor.notify = async request => {
      const approval = await readApproval(context, request.id);
      assert.equal(approval.alwaysAllowed, false);
      if (decision === 'expired') { fixture.clock.now += 121000; return; }
      await answerApproval(context, request.id, { decision, expectedRevision: approval.revision });
    };
    const boundary = { verified: true, authorize: async input => { authorized.push(input); return { authorized: true }; } };
    assert.equal(await requestNativeOperation(actor, operation, boundary), decision === 'approve');
    assert.equal(authorized.length, decision === 'approve' ? 1 : 0);
    if (authorized.length) { assert.equal(authorized[0].once, true); assert.equal(authorized[0].operation.id, 'native-option-id'); }
    assert.equal(await requestNativeOperation(actor, { ...operation, command: 'git push origin main' }, boundary), false);
    assert.equal(await requestNativeOperation(actor, operation, { ...boundary, verified: false }), false);
  });
});
