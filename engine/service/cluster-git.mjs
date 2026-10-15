import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, realpath, readFile } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, canonicalJson, hashBytes, uuidV8 } from './identity.mjs';
import { assertNoLinks, safeRelative } from './paths.mjs';
import { parseGitStatus, publicGitRemote } from './cluster-git-data.mjs';
import { paginate } from './projection.mjs';
import { commitChange, commitTransaction, readBytes, revisionOf, withLocalChanges, withLocks } from './store.mjs';

function unavailable() { throw new CoreError(409, 'git_unavailable', 'Read-only Git information is unavailable.'); }

export async function gitRead(directory, command, options = {}) {
  const env = Object.fromEntries(Object.entries(options.env ?? process.env).filter(([key]) => !/^GIT_/i.test(key)));
  const emptyConfig = process.platform === 'win32' ? 'NUL' : '/dev/null';
  Object.assign(env, { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1',
    ...(options.reviewedWrite ? {} : { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig }) });
  const args = ['--no-optional-locks', '--literal-pathspecs', '-c', 'core.fsmonitor=false', ...(options.reviewedWrite ? [] : ['-c', 'core.hooksPath=' + emptyConfig, '-c', 'core.attributesFile=' + emptyConfig]),
    '-c', 'credential.helper=', '-c', 'diff.external=', '-c', 'core.pager=cat',
    ...(options.filterConfig ?? []), ...command];
  const remaining = Math.min(30000, (options.deadline ?? Date.now() + 30000) - Date.now());
  if (remaining <= 0) unavailable();
  const controller = new AbortController();
  const settings = { cwd: directory, shell: false, windowsHide: true, timeout: remaining, maxBuffer: 1048576, encoding: 'utf8', env, signal: controller.signal };
  let timer;
  try {
    const operation = options.gitRunner ? Promise.resolve(options.gitRunner('git', args, settings)) : new Promise((resolve, reject) => {
      execFile('git', args, settings, (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr, code: 0 }));
    });
    const result = await Promise.race([operation, new Promise((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new CoreError(409, 'git_unavailable', 'Git did not finish within its deadline.')); }, remaining);
    })]);
    const code = result?.code ?? result?.status ?? 0;
    if (code !== 0 && !(options.allowMissing && code === 1)) unavailable();
    const output = result?.stdout;
    if (typeof output !== 'string' || Buffer.byteLength(output) + Buffer.byteLength(result?.stderr ?? '') > 1048576) unavailable();
    if (options.readBudget) {
      options.readBudget.remaining -= Buffer.byteLength(output) + Buffer.byteLength(result?.stderr ?? '');
      if (options.readBudget.remaining < 0) unavailable();
    }
    return code === 1 ? null : output;
  } catch (error) {
    if (options.allowMissing && error.code === 1) return null;
    unavailable();
  } finally {
    clearTimeout(timer);
  }
}

async function readOptions(directory, options) {
  const config = await gitRead(directory, ['config', '--null', '--get-regexp', '^filter\\.'], { ...options, allowMissing: true });
  const names = new Set();
  for (const record of (config ?? '').split('\0').filter(Boolean)) {
    const match = /^filter\.(.+)\.(?:clean|smudge|process|required)\n/.exec(record);
    if (!match || /[\x00-\x1f]/.test(match[1])) unavailable();
    names.add(match[1]);
  }
  return { ...options, filterConfig: [...names].flatMap(name => ['-c', `filter.${name}.clean=`, '-c', `filter.${name}.smudge=`,
    '-c', `filter.${name}.process=`, '-c', `filter.${name}.required=false`]) };
}

export async function readRepositoryIdentity(directory, options = {}) {
  options = { ...options, deadline: options.deadline ?? Date.now() + 30000, readBudget: options.readBudget ?? { remaining: 1048576 } };
  await assertNoLinks(directory);
  const root = await realpath(directory).catch(unavailable);
  if (!(await lstat(root)).isDirectory()) unavailable();
  const top = (await gitRead(root, ['rev-parse', '--show-toplevel'], options)).trim();
  const common = (await gitRead(root, ['rev-parse', '--git-common-dir'], options)).trim();
  if (!path.isAbsolute(top) || !common || /[\r\n\0]/.test(top + common)) unavailable();
  await assertNoLinks(top); await assertNoLinks(path.resolve(root, common));
  const topLevel = await realpath(top).catch(unavailable), commonDir = await realpath(path.resolve(root, common)).catch(unavailable);
  if (pathKey(topLevel) !== pathKey(root)) unavailable();
  const output = await gitRead(root, ['worktree', 'list', '--porcelain', '-z'], options);
  if (!output.endsWith('\0\0')) unavailable();
  const worktrees = [];
  for (const record of output.split('\0\0').filter(Boolean)) {
    const fields = record.split('\0'), first = fields.shift();
    if (!first?.startsWith('worktree ') || !path.isAbsolute(first.slice(9))) unavailable();
    if (fields.some(field => !/^(?:HEAD [a-f0-9]{40,64}|branch refs\/heads\/[^\r\n]+|detached|bare|locked(?: [^\r\n]*)?|prunable(?: [^\r\n]*)?)$/.test(field))) unavailable();
    if (fields.includes('bare')) unavailable();
    const head = fields.find(field => field.startsWith('HEAD '))?.slice(5);
    const branch = fields.find(field => field.startsWith('branch refs/heads/'))?.slice(18) ?? null;
    if (!/^[a-f0-9]{40,64}$/.test(head ?? '') || branch === null && !fields.includes('detached')) unavailable();
    const candidate = first.slice(9);
    await assertNoLinks(candidate);
    const actual = await realpath(candidate).catch(() => null);
    if (!actual) continue;
    if (worktrees.some(tree => pathKey(tree.path) === pathKey(actual))) unavailable();
    const candidateCommon = (await gitRead(actual, ['rev-parse', '--git-common-dir'], options)).trim();
    if (!candidateCommon || pathKey(await realpath(path.resolve(actual, candidateCommon)).catch(unavailable)) !== pathKey(commonDir)) unavailable();
    worktrees.push({ id: uuidV8(['git-worktree', pathKey(actual)]), path: actual, branch });
  }
  if (!worktrees.some(tree => pathKey(tree.path) === pathKey(root))) unavailable();
  const main = worktrees[0].path;
  return { id: uuidV8(['git-repository', pathKey(commonDir), await directoryIdentity(commonDir)]), commonDir, path: main, worktrees };
}

export function pathKey(value) { const resolved = path.resolve(value); return process.platform === 'win32' ? resolved.toLowerCase() : resolved; }
export async function directoryIdentity(directory) {
  const state = await lstat(directory, { bigint: true });
  if (!state.isDirectory() || state.isSymbolicLink()) unavailable();
  return { kind: process.platform === 'win32' ? 'windows-file-id' : 'posix-inode', value: `${state.dev}:${state.ino}` };
}

async function linked(context, clusterId, machine) {
  const { readCluster, resolveClusterLink } = await import('./clusters.mjs');
  const cluster = await readCluster(context, clusterId, { machine });
  if (cluster.link.kind !== 'repository') unavailable();
  const mapping = await resolveClusterLink(context, cluster.link, machine);
  const options = { ...(context.settingsOwner ?? context), deadline: Date.now() + 30000, readBudget: { remaining: 1048576 } };
  const identity = await readRepositoryIdentity(mapping.localPath, options);
  if (identity.id !== mapping.repositoryId) unavailable();
  return { cluster, mapping, identity, options: await readOptions(mapping.localPath, options) };
}

export async function readClusterGit(context, clusterId, { machine } = {}) {
  const { mapping, options } = await linked(context, clusterId, machine);
  const status = await gitRead(mapping.localPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], options);
  const changes = parseGitStatus(status);
  const branch = await gitRead(mapping.localPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { ...options, allowMissing: true });
  const remote = await gitRead(mapping.localPath, ['config', '--get', 'remote.origin.url'], { ...options, allowMissing: true });
  const head = await gitRead(mapping.localPath, ['rev-parse', '--verify', '--quiet', 'HEAD'], { ...options, allowMissing: true });
  if (branch && /[\r\n\0]/.test(branch.trim()) || head && !/^[a-f0-9]{40,64}$/.test(head.trim())) unavailable();
  let lastCommit = null;
  if (head) {
    const fields = (await gitRead(mapping.localPath, ['log', '-1', '--format=%H%x00%s%x00%cI'], options)).trimEnd().split('\0');
    if (fields.length !== 3 || !/^[a-f0-9]{40,64}$/.test(fields[0]) || !Number.isFinite(Date.parse(fields[2]))) unavailable();
    lastCommit = { id: fields[0], subject: privateText(fields[1]) ? '[redacted]' : fields[1], at: new Date(fields[2]).toISOString() };
  }
  const result = { remote: publicGitRemote(remote?.trim()), branch: branch?.trim() || null, dirtyCount: changes.length, lastCommit };
  return { ...result, revision: hashBytes(Buffer.from(canonicalJson({ ...result, status }))) };
}

export async function readClusterChanges(context, clusterId, query = {}) {
  const { mapping, options } = await linked(context, clusterId, query.machine);
  const changes = parseGitStatus(await gitRead(mapping.localPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], options));
  for (const item of changes) {
    safeRelative(item.path); if (item.from) safeRelative(item.from);
  }
  const filtered = changes.filter(item => !query.q || item.path.toLowerCase().includes(query.q.toLowerCase()));
  const page = paginate(filtered, { ...query, filters: { machine: query.machine, q: query.q ?? null }, snapshot: hashBytes(Buffer.from(canonicalJson(changes))) });
  const head = await gitRead(mapping.localPath, ['rev-parse', '--verify', '--quiet', 'HEAD'], { ...options, allowMissing: true });
  for (const item of page.items) {
    item.binary = false; item.patch = null;
    if (!head || item.status === '??') continue;
    try { await assertNoLinks(path.join(mapping.localPath, ...item.path.split('/')), { root: mapping.localPath }); }
    catch { unavailable(); }
    const stats = await gitRead(mapping.localPath, ['diff', '--no-ext-diff', '--no-textconv', '--numstat', '-z', 'HEAD', '--', item.path], options);
    item.binary = stats.startsWith('-\t-\t');
    if (item.binary) continue;
    const patch = await gitRead(mapping.localPath, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', 'HEAD', '--', item.path], options);
    if (Buffer.byteLength(patch) > 65536) unavailable();
    if (!privateText(patch)) item.patch = patch;
  }
  return page;
}

function privateText(value) {
  return /secret|token|password|credential|authorization|bearer|private[-_ ]?key|BEGIN[^\n]*PRIVATE KEY|(?:https?|ssh):\/\/[^\s]*[@?#]/i.test(value);
}

export async function openClusterEditor(context, clusterId, input) {
  const { mapping } = await linked(context, clusterId, input?.machine);
  const owner = context.settingsOwner ?? context;
  if (context.principal?.audience !== 'desktop') throw new CoreError(403, 'forbidden', 'Only the desktop may open an editor.');
  if (!owner.editorLauncher?.reviewed || typeof owner.editorLauncher.open !== 'function') throw new CoreError(409, 'editor_unavailable', 'No reviewed editor launcher is configured.');
  return withLocalChanges(context.store, async () => {
    const requestId = context.receipt ? uuidV8(['cluster-editor', context.receipt.principalHash, context.receipt.key]) : randomUUID();
    const file = path.join(context.paths.localDirectory, 'editor-requests', `${requestId}.json`);
    const before = await readBytes(context.store, file);
    if (before) {
      const prior = JSON.parse(before);
      if (prior.clusterId !== clusterId || prior.machine !== input.machine || prior.repositoryId !== mapping.repositoryId || prior.state !== 'opened') throw new CoreError(409, 'editor_unavailable', 'The previous editor opening is unconfirmed.');
      return { requestId };
    }
    const record = { requestId, clusterId, machine: input.machine, repositoryId: mapping.repositoryId, state: 'opening' };
    const source = Buffer.from(canonicalJson(record));
    await commitTransaction(context.store, { id: randomUUID(), entries: [{ resource: `cluster-editor:${requestId}`, recordPath: file, beforeRevision: null, afterBytes: source, private: true }] });
    try { await owner.editorLauncher.open({ requestId, path: mapping.localPath, machine: input.machine, clusterId, shell: false, windowsHide: true }); }
    catch { throw new CoreError(409, 'editor_unavailable', 'The configured editor did not confirm opening.'); }
    const result = { requestId };
    await commitChange(context, { id: randomUUID(), entries: [{ resource: `cluster-editor:${requestId}`, recordPath: file,
      beforeRevision: revisionOf(source), afterBytes: Buffer.from(canonicalJson({ ...record, state: 'opened' })), private: true }], events: [], response: { status: 202, body: result } });
    return result;
  });
}

async function planGitState(context, directory) {
  const options = { ...(context.settingsOwner ?? context), reviewedWrite: true };
  const branch = (await gitRead(directory, ['symbolic-ref', '--quiet', '--short', 'HEAD'], options)).trim();
  const head = (await gitRead(directory, ['rev-parse', '--verify', 'HEAD'], options)).trim();
  const indexPath = path.resolve(directory, (await gitRead(directory, ['rev-parse', '--git-path', 'index'], options)).trim());
  await assertNoLinks(indexPath);
  const index = await readFile(indexPath).then(hashBytes).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const configuration = hashBytes(Buffer.from(await gitRead(directory, ['config', '--null', '--list'], options)));
  return { branch, head, index, configuration };
}
async function requirePlanGitCapability(context, plan) {
  const { readAgentPermissions } = await import('./settings.mjs');
  const permissions = await readAgentPermissions(context);
  if (plan.tasks.some(task => !permissions.some(permission => permission.client === task.runsIn.client && permission.actions.includes('git.commit')))) {
    throw new CoreError(409, 'git_capability_required', 'Every task requires its separate reviewed commit capability.');
  }
}
export async function snapshotPlanGit(context, plan, tasks) {
  const { mapping, identity } = await linked(context, plan.clusterId, plan.machine);
  await requirePlanGitCapability(context, plan);
  if (tasks.some(task => !task.paths.length)) throw new CoreError(422, 'invalid_plan', 'Each execution task must name its reviewed changed paths.');
  if (await gitRead(mapping.localPath, ['check-ref-format', '--branch', plan.branch], context.settingsOwner ?? context) === null) unavailable();
  const state = await planGitState(context, mapping.localPath);
  if (state.branch !== plan.branch && await gitRead(mapping.localPath, ['show-ref', '--verify', '--quiet', `refs/heads/${plan.branch}`], { ...(context.settingsOwner ?? context), allowMissing: true }) !== null) {
    throw new CoreError(409, 'git_changed', 'The proposed plan branch already exists.');
  }
  return { directory: mapping.localPath, repositoryId: identity.id, ...state };
}
async function writePlanGitReceipt(context, file, value) {
  const before = await readBytes(context.store, file);
  await commitTransaction(context.store, { id: randomUUID(), entries: [{ resource: file, recordPath: file, beforeRevision: revisionOf(before),
    afterBytes: Buffer.from(canonicalJson(value)), private: true }], events: [] });
}
export async function preparePlanBranch(context, approval) {
  const { plan, git } = approval;
  if (!git || approval.confirmedBy !== 'root:master' || approval.commits !== true) throw new CoreError(403, 'git_intent_required', 'The exact plan branch was not approved.');
  const file = path.join(context.paths.localDirectory, 'runs', approval.runId, 'git', 'branch.json');
  return withLocks(context.store, [`plan-git:${pathKey(git.directory)}`], async () => {
    await requirePlanGitCapability(context, plan);
    const identity = await readRepositoryIdentity(git.directory, context.settingsOwner ?? context);
    if (identity.id !== git.repositoryId) throw new CoreError(409, 'git_changed', 'The plan repository changed identity.');
    const bytes = await readBytes(context.store, file), prior = bytes ? JSON.parse(bytes) : null;
    const state = await planGitState(context, git.directory);
    if (prior?.state === 'done') {
      if (state.branch !== plan.branch || state.head !== prior.head || state.index !== prior.index || state.configuration !== git.configuration) throw new CoreError(409, 'git_changed', 'The approved branch, head, index or configuration changed.');
      return prior;
    }
    if (state.branch === plan.branch && state.head === git.head && state.index === git.index && state.configuration === git.configuration) {
      const done = { state: 'done', branch: plan.branch, head: git.head, index: state.index, configuration: git.configuration };
      await writePlanGitReceipt(context, file, done); return done;
    }
    if (prior || canonicalJson(state) !== canonicalJson({ branch: git.branch, head: git.head, index: git.index, configuration: git.configuration })) {
      throw new CoreError(409, 'launch_ambiguous', 'Interrupted branch preparation cannot be repeated.');
    }
    await writePlanGitReceipt(context, file, { state: 'executing', branch: plan.branch, before: state });
    await gitRead(git.directory, ['switch', '-c', plan.branch], { ...(context.settingsOwner ?? context), reviewedWrite: true });
    const after = await planGitState(context, git.directory);
    if (after.branch !== plan.branch || after.head !== git.head || after.index !== git.index || after.configuration !== git.configuration) throw new CoreError(409, 'git_changed', 'The approved branch state changed.');
    const done = { state: 'done', branch: plan.branch, head: git.head, index: after.index, configuration: git.configuration };
    await writePlanGitReceipt(context, file, done); return done;
  });
}
async function reviewedFiles(context, directory, paths) {
  const { verifiedFilePath } = await import('./file-access.mjs');
  const files = [];
  for (const relative of paths) {
    safeRelative(relative);
    const target = await verifiedFilePath(path.join(directory, relative));
    if (!pathKey(target.path).startsWith(pathKey(directory) + path.sep) || target.exists && (!target.state.isFile() || target.state.nlink !== 1n)) unavailable();
    const blob = target.exists ? (await gitRead(directory, ['hash-object', `--path=${relative}`, '--', relative], { ...(context.settingsOwner ?? context), reviewedWrite: true })).trim() : null;
    if (blob !== null && !/^[a-f0-9]{40,64}$/.test(blob)) unavailable();
    files.push({ path: relative, hash: target.exists ? hashBytes(await readFile(target.path)) : null, blob });
  }
  return files;
}
async function stagedForeign(context, directory, paths) {
  return (await gitRead(directory, ['ls-files', '--stage', '-z'], context.settingsOwner ?? context)).split('\0')
    .filter(record => record && !paths.includes(record.slice(record.indexOf('\t') + 1))).join('\0');
}
async function reconcileTaskCommit(context, approval, taskId, receipt, head) {
  const directory = approval.git.directory, options = context.settingsOwner ?? context;
  const fields = (await gitRead(directory, ['show', '-s', '--format=%P%x00%B', head], options)).trimEnd().split('\0');
  const changed = (await gitRead(directory, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', head], options)).split('\0').filter(Boolean).sort();
  if (fields[0] !== receipt.head || !fields[1]?.includes(taskId) || canonicalJson(changed) !== canonicalJson(receipt.files.map(file => file.path).sort())) return false;
  for (const file of receipt.files) {
    const tree = await gitRead(directory, ['ls-tree', '-z', head, '--', file.path], options);
    const actual = tree ? /^[0-7]{6} blob ([a-f0-9]{40,64})\t/.exec(tree)?.[1] : null;
    if (actual !== file.blob) return false;
  }
  return true;
}
export async function commitPlanTask(context, approval, taskId) {
  if (approval.confirmedBy !== 'root:master' || approval.commits !== true || !approval.git) throw new CoreError(403, 'git_intent_required', 'Per-task commit intent is required.');
  const task = approval.taskWitnesses.find(task => task.id === taskId);
  if (!task?.paths.length) throw new CoreError(409, 'git_changed', 'The reviewed task paths are unavailable.');
  const directory = approval.git.directory, root = path.join(context.paths.localDirectory, 'runs', approval.runId, 'git');
  const file = path.join(root, `${hashBytes(Buffer.from(taskId))}.json`), branchFile = path.join(root, 'branch.json');
  return withLocks(context.store, [`plan-git:${pathKey(directory)}`], async () => {
    await requirePlanGitCapability(context, approval.plan);
    if ((await readRepositoryIdentity(directory, context.settingsOwner ?? context)).id !== approval.git.repositoryId) unavailable();
    const bytes = await readBytes(context.store, file), branchBytes = await readBytes(context.store, branchFile);
    const prior = bytes ? JSON.parse(bytes) : null, branch = branchBytes ? JSON.parse(branchBytes) : null;
    const state = await planGitState(context, directory);
    if (branch?.state !== 'done' || state.branch !== approval.plan.branch || state.configuration !== branch.configuration) throw new CoreError(409, 'git_changed', 'The approved branch changed before commit.');
    if (prior?.state === 'done') {
      if (state.head !== branch.head || state.index !== branch.index) throw new CoreError(409, 'git_changed', 'Git changed after the verified task commit.');
      return { commitId: prior.commitId, reconciled: true };
    }
    const options = { ...(context.settingsOwner ?? context), reviewedWrite: true };
    const changedPaths = prior ? prior.files.map(file => file.path) : [...new Set([
      ...(await gitRead(directory, ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', branch.head, '--', ...task.paths], options)).split('\0'),
      ...(await gitRead(directory, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...task.paths], options)).split('\0'),
    ].filter(Boolean))].sort();
    if (!changedPaths.length || changedPaths.some(file => !task.paths.includes(file))) throw new CoreError(409, 'git_changed', 'No reviewed changed task paths could be verified.');
    const receipt = prior ?? { state: 'prepared', taskId, head: branch.head, files: await reviewedFiles(context, directory, changedPaths),
      foreign: await stagedForeign(context, directory, changedPaths), index: state.index, configuration: state.configuration };
    if (state.head !== receipt.head) {
      if (!await reconcileTaskCommit(context, approval, taskId, receipt, state.head)) throw new CoreError(409, 'git_changed', 'An existing task commit could not be verified.');
    } else {
      if (prior?.state === 'executing') throw new CoreError(409, 'launch_ambiguous', 'An interrupted commit must be reconciled.');
      if (state.index !== receipt.index || canonicalJson(await reviewedFiles(context, directory, changedPaths)) !== canonicalJson(receipt.files)) throw new CoreError(409, 'git_changed', 'The reviewed index or task files changed.');
      await writePlanGitReceipt(context, file, { ...receipt, state: 'executing' });
      await gitRead(directory, ['add', '--', ...changedPaths], options);
      const staged = await planGitState(context, directory);
      if (await stagedForeign(context, directory, changedPaths) !== receipt.foreign || canonicalJson(await reviewedFiles(context, directory, changedPaths)) !== canonicalJson(receipt.files)
        || staged.head !== receipt.head || staged.branch !== approval.plan.branch || staged.configuration !== receipt.configuration) throw new CoreError(409, 'git_changed', 'Git changed while staging the reviewed paths.');
      await gitRead(directory, ['commit', '--only', '--message', `Complete task ${taskId}`, '--', ...changedPaths], options);
    }
    const after = await planGitState(context, directory);
    if (after.branch !== approval.plan.branch || after.configuration !== receipt.configuration
      || !await reconcileTaskCommit(context, approval, taskId, receipt, after.head) || await stagedForeign(context, directory, changedPaths) !== receipt.foreign) {
      throw new CoreError(409, 'git_changed', 'The completed task commit could not be verified.');
    }
    await writePlanGitReceipt(context, file, { ...receipt, state: 'done', commitId: after.head });
    await writePlanGitReceipt(context, branchFile, { ...branch, head: after.head, index: after.index });
    return { commitId: after.head, reconciled: state.head !== receipt.head };
  });
}
