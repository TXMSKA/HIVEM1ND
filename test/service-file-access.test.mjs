import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bindLaunchScope, prepareLaunchScope, readScopedFile, verifiedFilePath, verifiedSessionScope, writeScopedFile } from '../engine/service/file-access.mjs';
import { createCluster } from '../engine/service/clusters.mjs';
import { directoryIdentity } from '../engine/service/cluster-git.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { answerApproval, readApproval } from '../engine/service/approvals.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

async function world(t, linked = true) {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const root = path.join(fixture.root, 'repository'), other = path.join(fixture.root, 'other');
  await mkdir(root); await mkdir(other);
  const unitId = 'root:worker', sessionId = randomUUID(), folderId = randomUUID();
  const context = { paths: fixture.paths, store: fixture.store, now: () => fixture.clock.now,
    principal: { audience: 'desktop', unitId: 'root:master' }, projects: [], ownedPids: new Set([4242]),
    adapters: { codex: { confirm: async proof => proof.unitId === unitId && proof.nativeSessionId === 'owned' } } };
  await mkdir(path.join(fixture.paths.mind, 'user', 'state'), { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'worker.md'), `unit: worker\nunit-id: ${unitId}\nrole: executor\nstate: in\nmachine: DESKTOP\n\nReady.\n`);
  if (linked) await writeFile(path.join(fixture.paths.localDirectory, 'cluster-links.json'), JSON.stringify({ format: 'hivem1nd-cluster-links-v1', machine: 'DESKTOP', links: {
    [`folder:${folderId}`]: { localPath: root, machine: 'DESKTOP', identity: await directoryIdentity(root) },
  } }));
  const cluster = await createCluster(context, { title: 'Work', members: [unitId], parentId: null,
    link: linked ? { kind: 'folder', folderId } : { kind: 'none' }, machine: 'DESKTOP', confirmed: true });
  const prepared = await prepareLaunchScope(context, { id: randomUUID(), unitId });
  await bindLaunchScope(context, prepared.scope, { sessionId, client: 'codex', nativeSessionId: 'owned' }, 4242);
  const actor = { ...context, principal: { audience: 'agent', unitId, sessionId } };
  return { fixture, context, actor, root, other, prepared, cluster };
}

test('owned file callbacks enforce revisions, creation identity and bounded secret-free reads', async t => {
  const { actor, root } = await world(t);
  const file = path.join(root, 'owned.txt');
  const created = await writeScopedFile(actor, { path: file, text: 'first', expectedRevision: null });
  assert.equal(created.revision, hashBytes(Buffer.from('first')));
  await assert.rejects(writeScopedFile(actor, { path: file, text: 'overwrite', expectedRevision: null }), { code: 'revision_conflict' });
  const read = await readScopedFile(actor, { path: file });
  assert.equal(read.text, 'first');
  await writeScopedFile(actor, { path: file, text: 'next', expectedRevision: read.revision });
  assert.equal(await readFile(file, 'utf8'), 'next');
  await assert.rejects(writeScopedFile(actor, { path: path.join(root, 'missing', 'child'), text: 'bad', expectedRevision: null }), { code: 'scope_unavailable' });
  await writeFile(path.join(root, '.env'), 'API_KEY=fixture-value\nPORT=1234\n');
  const environment = await readScopedFile(actor, { path: path.join(root, '.env') });
  assert.equal(environment.text, 'API_KEY\nPORT');
  assert.equal(JSON.stringify(environment).includes('fixture-value'), false);
  await writeFile(path.join(root, 'private.key'), '-----BEGIN PRIVATE KEY-----\nfixture-key-bytes\n');
  assert.equal((await readScopedFile(actor, { path: path.join(root, 'private.key') })).text, '');
  await writeFile(path.join(root, 'binary'), Buffer.from([0, 1, 2]));
  await assert.rejects(readScopedFile(actor, { path: path.join(root, 'binary') }), { code: 'scope_unavailable' });
});

test('junctions, hard links, sibling prefixes, Windows aliases and a replaced root grant no file authority', async t => {
  const { actor, root, other } = await world(t);
  await writeFile(path.join(other, 'kept.txt'), 'foreign');
  await symlink(other, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const file of [path.join(root, 'escape', 'kept.txt'), path.join(root, 'escape', 'missing.txt')]) {
    await assert.rejects(writeScopedFile(actor, { path: file, text: 'bad', expectedRevision: null }));
  }
  const hard = path.join(root, 'hard.txt'); await link(path.join(other, 'kept.txt'), hard);
  await assert.rejects(writeScopedFile(actor, { path: hard, text: 'bad', expectedRevision: hashBytes(Buffer.from('foreign')) }), { code: 'scope_unavailable' });
  await assert.rejects(readScopedFile(actor, { path: hard }), { code: 'scope_unavailable' });
  await assert.rejects(verifiedFilePath('relative.txt'), { code: 'scope_unavailable' });
  if (process.platform === 'win32') for (const file of [`${root}\\file:stream`, `${root}\\name.`, '\\\\server\\share\\file']) await assert.rejects(verifiedFilePath(file), { code: 'scope_unavailable' });
  const original = `${root}-old`; await rename(root, original); await mkdir(root);
  await assert.rejects(writeScopedFile(actor, { path: path.join(root, 'bad'), text: 'bad', expectedRevision: null }), { code: 'scope_unavailable' });
  assert.equal(await readFile(path.join(other, 'kept.txt'), 'utf8'), 'foreign');
});

test('outside-cluster consent is bound to one exact operation, revision, actor and session', async t => {
  const { actor, context, other } = await world(t, false);
  const input = { path: path.join(other, 'approved.txt'), text: 'approved', expectedRevision: null, requestId: randomUUID() };
  let approvalId;
  await assert.rejects(writeScopedFile(actor, input), error => { approvalId = error.details.approvalId; return error.code === 'outside_scope'; });
  const pending = await readApproval(context, approvalId);
  assert.equal(pending.alwaysAllowed, false);
  await assert.rejects(answerApproval(context, approvalId, { decision: 'approve-always', expectedRevision: pending.revision }), { code: 'always_unavailable' });
  await answerApproval(context, approvalId, { decision: 'approve', expectedRevision: pending.revision });
  await assert.rejects(writeScopedFile(actor, { ...input, text: 'different', approvalId }), { code: 'outside_scope' });
  await writeScopedFile(actor, { ...input, approvalId });
  assert.equal(await readFile(input.path, 'utf8'), 'approved');
  await assert.rejects(writeScopedFile(actor, { ...input, approvalId }), { code: 'outside_scope' });
  assert.deepEqual((await verifiedSessionScope(actor)).writeRoots, []);
  await assert.rejects(verifiedSessionScope({ ...actor, principal: { ...actor.principal, sessionId: randomUUID() } }));
  actor.ownedPids.clear();
  await assert.rejects(verifiedSessionScope(actor), { code: 'scope_unavailable' });
});
