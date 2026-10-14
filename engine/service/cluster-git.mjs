import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, canonicalJson, hashBytes, uuidV8 } from './identity.mjs';
import { assertNoLinks, safeRelative } from './paths.mjs';
import { parseGitStatus, publicGitRemote } from './cluster-git-data.mjs';
import { paginate } from './projection.mjs';
import { commitChange, commitTransaction, readBytes, revisionOf, withLocalChanges } from './store.mjs';

function unavailable() { throw new CoreError(409, 'git_unavailable', 'Read-only Git information is unavailable.'); }

export async function gitRead(directory, command, options = {}) {
  const env = Object.fromEntries(Object.entries(options.env ?? process.env).filter(([key]) => !/^GIT_/i.test(key)));
  Object.assign(env, { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_NO_REPLACE_OBJECTS: '1' });
  const args = ['--no-optional-locks', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=' + env.GIT_CONFIG_GLOBAL,
    '-c', 'core.attributesFile=' + env.GIT_CONFIG_GLOBAL, '-c', 'credential.helper=', '-c', 'diff.external=', '-c', 'core.pager=cat',
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
