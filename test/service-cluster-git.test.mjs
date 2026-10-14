import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { access, mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { gitRead, readRepositoryIdentity, readClusterGit, readClusterChanges, openClusterEditor } from '../engine/service/cluster-git.mjs';
import { createCluster, migrateClusters, rawClusters } from '../engine/service/clusters.mjs';
import { legacyTreeInventory } from '../engine/legacy-copy.mjs';
import { createSettingsOwner } from '../engine/service/settings.mjs';
import { discoverProjects } from '../engine/discovery.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

async function repository(t) {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const directory = path.join(fixture.home, 'Web', 'shop'); await mkdir(directory, { recursive: true });
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=NUL', ...args], { cwd: directory, windowsHide: true, shell: false, timeout: 30000, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL', GIT_TERMINAL_PROMPT: '0' } });
  git('init', '-b', 'main'); await writeFile(path.join(directory, 'file.txt'), 'Initial.\n'); git('add', 'file.txt'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Initial fixture');
  const context = createSettingsOwner({ ...fixture, now: () => fixture.clock.now, homeDir: fixture.home, projects: [{ name: 'shop', localPath: directory }], probeAgents: async () => ({}) });
  await migrateClusters(context);
  const cluster = (await rawClusters(context)).find(item => item.cluster.link.kind === 'repository').cluster;
  return { fixture, directory, git, context, cluster };
}

test('directory and worktree file fold into one canonical repository without changing any byte', async t => {
  const { fixture, directory, git } = await repository(t);
  const worktree = path.join(fixture.home, 'Web', 'shop-work'); git('worktree', 'add', '-b', 'other', worktree);
  const before = await legacyTreeInventory(fixture.home);
  const first = await readRepositoryIdentity(directory), second = await readRepositoryIdentity(worktree);
  assert.equal(first.id, second.id); assert.equal(first.path, directory); assert.equal(first.worktrees.length, 2);
  const discovered = await discoverProjects([fixture.home]);
  assert.equal(discovered.length, 1); assert.equal(discovered[0].worktrees.length, 2);
  assert.deepEqual(await legacyTreeInventory(fixture.home), before);
});

test('clean, dirty, renamed, detached, binary and credential remote reads stay read-only', async t => {
  const { directory, git, context, cluster } = await repository(t);
  const query = { machine: context.paths.machine };
  assert.equal((await readClusterGit(context, cluster.id, query)).dirtyCount, 0);
  const url = new URL('https://example.invalid/shop.git'); url.username = 'fixture'; url.password = 'fixture';
  git('remote', 'add', 'origin', url.toString());
  git('mv', 'file.txt', 'renamed.txt'); await writeFile(path.join(directory, 'binary.bin'), Buffer.from([0, 1, 2]));
  git('checkout', '--detach');
  const before = await legacyTreeInventory(directory), state = await readClusterGit(context, cluster.id, query);
  assert.equal(state.remote, 'https://example.invalid/shop.git'); assert.equal(state.branch, null); assert.equal(state.dirtyCount, 2);
  assert.deepEqual(Object.keys(state.lastCommit).sort(), ['at', 'id', 'subject']);
  const changes = await readClusterChanges(context, cluster.id, { ...query, limit: 1 });
  assert.equal(changes.items.length, 1); assert.ok(changes.nextCursor);
  const next = await readClusterChanges(context, cluster.id, { ...query, limit: 1, cursor: changes.nextCursor });
  assert.equal(next.items.length, 1); assert.equal(changes.total, 2);
  assert.ok([changes.items[0], next.items[0]].some(item => item.from === 'file.txt'));
  assert.deepEqual(await legacyTreeInventory(directory), before);
});

test('runner receives hardened bounded executable arguments and sanitizes unavailable output', async () => {
  let observed;
  assert.equal(await gitRead(process.cwd(), ['rev-parse', '--show-toplevel'], { env: { PATH: '', GIT_DIR: 'foreign' }, gitRunner: async (exe, args, settings) => {
    observed = { exe, args, settings }; return { stdout: 'result' };
  } }), 'result');
  assert.equal(observed.exe, 'git'); assert.equal(observed.settings.shell, false); assert.equal(observed.settings.windowsHide, true);
  assert.ok(observed.settings.timeout > 0 && observed.settings.timeout <= 30000); assert.equal(observed.settings.maxBuffer, 1048576);
  assert.equal(observed.settings.env.GIT_DIR, undefined); assert.equal(observed.settings.env.GIT_OPTIONAL_LOCKS, '0');
  for (const arg of ['credential.helper=', 'core.fsmonitor=false', 'diff.external=']) assert.ok(observed.args.includes(arg));
  for (const result of [{ code: 129, stdout: 'Unsupported' }, { stdout: 'x'.repeat(1048577) }, { stdout: null }]) await assert.rejects(gitRead(process.cwd(), ['status', '--porcelain=v1', '-z'], { gitRunner: async () => result }), { code: 'git_unavailable' });
});

test('owner, identity and reviewed editor bindings cannot become arbitrary shell execution', async t => {
  const { context, cluster, directory } = await repository(t);
  await assert.rejects(readClusterGit(context, cluster.id, { machine: 'OFFLINE' }), { code: 'machine_unavailable' });
  await assert.rejects(openClusterEditor(context, cluster.id, { machine: context.paths.machine }), { code: 'editor_unavailable' });
  let opened; context.editorLauncher = { reviewed: true, open: async input => { opened = input; return { requestId: 'fixture-request' }; } };
  await openClusterEditor(context, cluster.id, { machine: context.paths.machine });
  assert.equal(opened.path, directory); assert.equal(opened.shell, false);
  const unlinked = await createCluster(context, { title: 'No link', link: { kind: 'none' }, parentId: null, machine: context.paths.machine, confirmed: true });
  await assert.rejects(readClusterGit(context, unlinked.id, { machine: context.paths.machine }), { code: 'git_unavailable' });
});

test('discovery skips directory links and never exceeds four levels even when a caller asks for more', async t => {
  const { fixture } = await repository(t);
  const atFour = path.join(fixture.home, 'a', 'b', 'c', 'four'), atFive = path.join(fixture.home, 'd', 'e', 'f', 'g', 'five');
  for (const directory of [atFour, atFive]) {
    await mkdir(directory, { recursive: true });
    execFileSync('git', ['init', '-b', 'main'], { cwd: directory, timeout: 30000, windowsHide: true, shell: false, stdio: 'ignore' });
  }
  const outside = path.join(fixture.root, 'outside'); await mkdir(outside);
  execFileSync('git', ['init', '-b', 'main'], { cwd: outside, timeout: 30000, windowsHide: true, shell: false, stdio: 'ignore' });
  await symlink(outside, path.join(fixture.home, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const found = await discoverProjects([fixture.home], { maxDepth: 10 });
  assert.deepEqual(found.map(item => item.name).sort(), ['four', 'shop']);
});

test('Git filters never run; credential-bearing patches are omitted and large patches fail closed', async t => {
  const { context, cluster, directory, git } = await repository(t), query = { machine: context.paths.machine };
  const marker = path.join(directory, 'filter-ran'), script = path.join(directory, 'filter.mjs');
  await writeFile(script, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'Executed');`);
  git('config', 'filter.fixture.clean', `node "${script}"`);
  git('config', 'filter.fixture.required', 'true');
  await writeFile(path.join(directory, '.gitattributes'), 'file.txt filter=fixture\n');
  await writeFile(path.join(directory, 'file.txt'), 'const token = "fixture";\n');
  const before = await legacyTreeInventory(directory);
  const changes = await readClusterChanges(context, cluster.id, query);
  assert.equal(changes.items.find(item => item.path === 'file.txt').patch, null);
  await assert.rejects(access(marker), { code: 'ENOENT' });
  assert.deepEqual(await legacyTreeInventory(directory), before);
  await writeFile(path.join(directory, 'file.txt'), 'x'.repeat(70000));
  await assert.rejects(readClusterChanges(context, cluster.id, { ...query, q: 'file.txt' }), { code: 'git_unavailable' });
});

test('a tracked binary change exposes only its status and path', async t => {
  const { context, cluster, directory, git } = await repository(t);
  await writeFile(path.join(directory, 'data.bin'), Buffer.from([0, 1, 2])); git('add', 'data.bin');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Binary fixture');
  await writeFile(path.join(directory, 'data.bin'), Buffer.from([0, 3, 4]));
  const result = await readClusterChanges(context, cluster.id, { machine: context.paths.machine });
  assert.equal(result.items[0].path, 'data.bin'); assert.equal(result.items[0].binary, true); assert.equal(result.items[0].patch, null);
});

test('an injected operation observes cancellation at its bounded deadline', async () => {
  let aborted = false;
  await assert.rejects(gitRead(process.cwd(), ['status', '--porcelain=v1', '-z'], { deadline: Date.now() + 100,
    gitRunner: async (_exe, _args, settings) => new Promise((_resolve, reject) => settings.signal.addEventListener('abort', () => {
      aborted = true; reject(new Error('Interrupted'));
    }, { once: true })) }), { code: 'git_unavailable' });
  assert.equal(aborted, true);
});

test('an empty Git marker is not imported and an unsupported real repository fails closed', async t => {
  const { fixture, directory } = await repository(t);
  const marker = path.join(fixture.home, 'placeholder'); await mkdir(path.join(marker, '.git'), { recursive: true });
  const found = await discoverProjects([fixture.home]);
  assert.equal(found.some(item => item.path === marker), false);
  await assert.rejects(discoverProjects([directory], { gitRunner: async () => ({ code: 129, stdout: '' }) }), { code: 'git_unavailable' });
});

test('changed paths behind a junction cannot start a patch read outside the linked repository', async t => {
  const { fixture, context, directory, cluster } = await repository(t);
  const outside = path.join(fixture.root, 'outside'); await mkdir(outside);
  await writeFile(path.join(outside, 'file.txt'), 'Foreign fixture bytes.');
  await symlink(outside, path.join(directory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  let diffCalls = 0;
  context.gitRunner = async (exe, args, settings) => {
    if (args.includes('status')) return { stdout: ' M linked/file.txt\0' };
    if (args.includes('diff')) diffCalls++;
    return new Promise((resolve, reject) => execFile(exe, args, settings, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })));
  };
  await assert.rejects(readClusterChanges(context, cluster.id, { machine: context.paths.machine }), { code: 'git_unavailable' });
  assert.equal(diffCalls, 0);
});
