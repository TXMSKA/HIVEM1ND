import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CoreError, canonicalJson, hashBytes, isUuid, parseUnitId } from './identity.mjs';
import { clusterChoices, readCluster, resolveClusterLink } from './clusters.mjs';
import { directoryIdentity, pathKey, readRepositoryIdentity } from './cluster-git.mjs';
import { withinClusterRoot } from './cluster-policy.mjs';
import { assertNoLinks } from './paths.mjs';
import { atomicWrite, withLocks } from './store.mjs';
import { protectLocalFile, verifyLocalPermissions } from './security.mjs';
import { additionsForUnit } from './additions.mjs';
import { gitRead } from './cluster-git.mjs';
import { readApproval, requestApproval } from './approvals.mjs';
import { classifyApprovalAction, ownsSessionExecution } from './adapters.mjs';

function fail(code, message) { throw new CoreError(409, code, message); }
function freeze(value) { for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); return Object.freeze(value); }

export async function requestNativeOperation(context, operation, boundary) {
  operation = Object.fromEntries(Object.entries(operation).filter(([, value]) => value !== undefined));
  const scope = await verifiedSessionScope(context);
  if (boundary?.verified !== true || typeof boundary.authorize !== 'function' || operation.nativeSessionId !== scope.nativeSessionId) return false;
  if (operation.kind === 'process') {
    if (typeof operation.command !== 'string' || typeof operation.cwd !== 'string') return false;
    const executable = operation.command.match(/^\s*(?:"([^"]+)"|'([^']+)'|(\S+))/);
    if (executable && /^git(?:\.exe|\.cmd|\.bat)?$/i.test(path.win32.basename((executable[1] ?? executable[2] ?? executable[3]).replaceAll('/', '\\')))) return false;
    // Unclassifiable shells still run inside the verified sandbox; Git remains broker-only there.
    try { if (classifyApprovalAction('process.run', { command: operation.command }).gitAction) return false; } catch { /* Native sandbox must confine indirect writes and Git. */ }
  } else if (operation.kind !== 'write' || !Array.isArray(operation.paths) || !operation.paths.length || operation.paths.length > 256) return false;
  const paths = operation.kind === 'process' ? [operation.cwd] : operation.paths;
  const verified = [];
  for (const candidate of paths) {
    const target = await verifiedFilePath(candidate);
    if (withinClusterRoot(context.paths.mind, target.path, process.platform) || withinClusterRoot(context.paths.localDirectory, target.path, process.platform)
      || target.path.split(path.sep).some(part => part.toLowerCase() === '.git')
      || scope.writeRoots.some(root => root.gitCommonDir && withinClusterRoot(root.gitCommonDir, target.path, process.platform))) return false;
    verified.push({ path: target.path, identity: target.identity, ancestor: target.ancestor,
      modified: String(target.state.mtimeNs), changed: String(target.state.ctimeNs), exists: target.exists });
  }
  const pattern = { resource: scope.id, path: verified[0].path, operation: 'write',
    snapshot: hashBytes(Buffer.from(canonicalJson({ operation, verified }))) };
  const pending = await requestApproval(context, { action: 'file.write', pattern, display: operation.kind === 'process' ? 'Run this exact command in the session sandbox' : 'Apply these exact native file changes', alwaysAllowed: false, operationId: String(operation.id) });
  const deadline = Date.now() + Math.min(120000, context.nativeApprovalTimeoutMs ?? 120000);
  for (;;) {
    if (boundary.signal?.aborted || Date.now() >= deadline) return false;
    const approval = await readApproval(context, pending.approval.id);
    if (Date.parse(approval.expiresAt) <= context.now()) return false;
    if (approval.state !== 'pending' && approval.state !== 'answering') {
      if (approval.state !== 'approved') return false;
      await verifiedSessionScope(context);
      for (const previous of verified) {
        const current = await verifiedFilePath(previous.path);
        if (current.identity !== previous.identity || current.ancestor !== previous.ancestor
          || String(current.state.mtimeNs) !== previous.modified || String(current.state.ctimeNs) !== previous.changed || current.exists !== previous.exists) return false;
      }
      const result = await boundary.authorize({ scopeId: scope.id, sessionId: scope.sessionId, operation,
        paths: verified.map(item => item.path), approvalId: approval.id, once: true });
      return result?.authorized === true;
    }
    await new Promise(resolve => {
      const finish = () => { clearTimeout(timer); boundary.signal?.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, 50); boundary.signal?.addEventListener('abort', finish, { once: true });
    });
  }
}
function scopePath(context, sessionId) {
  if (!isUuid(sessionId)) fail('scope_unavailable', 'The session scope is unavailable.');
  return path.join(context.paths.localDirectory, 'sessions', sessionId, 'scope.json');
}

// This is an owner-only snapshot, never a request-supplied filesystem capability.
export async function prepareLaunchScope(context, request) {
  const choice = await clusterChoices(context, request.unitId);
  if (choice.ambiguous) fail('scope_unresolved', 'Choose a cluster before launching this agent.');
  const cluster = choice.clusterId ? await readCluster(context, choice.clusterId, { machine: context.paths.machine }) : null;
  const mapping = cluster && cluster.link.kind !== 'none' ? await resolveClusterLink(context, cluster.link, context.paths.machine) : null;
  const directory = path.dirname(scopePath(context, request.id));
  await assertNoLinks(directory);
  await mkdir(directory, { recursive: true });
  await protectLocalFile(directory, { store: context.store });
  const additions = await additionsForUnit(context, request.unitId);
  const repository = cluster?.link.kind === 'repository' ? await readRepositoryIdentity(mapping.localPath, context.settingsOwner ?? context) : null;
  if (repository && repository.id !== mapping.repositoryId) fail('scope_unavailable', 'The repository changed identity.');
  const permissions = repository ? (await import('./settings.mjs').then(module => module.readAgentPermissions(context))).filter(item => item.client === request.client) : [];
  const scope = { id: randomUUID(), sessionId: request.id, attemptId: null, unitId: request.unitId,
    clusterId: cluster?.id ?? null, clusterRevision: cluster?.revision ?? null, machine: context.paths.machine,
    repositoryId: repository?.id ?? null,
    readScope: [request.unitId], contentScope: { additionIds: additions.map(item => item.record.id), scopeRevision: null },
    writeRoots: mapping ? [{ realPath: mapping.localPath, identity: await directoryIdentity(mapping.localPath), gitCommonDir: repository?.commonDir ?? null }] : [],
    git: { commit: permissions.some(item => item.actions.includes('git.commit')), push: permissions.some(item => item.actions.includes('git.push')), intentId: null } };
  scope.revision = hashBytes(Buffer.from(canonicalJson(scope)));
  await saveScope(context, scope);
  return { scope: freeze(scope), cwd: mapping?.localPath ?? directory, directory };
}

export async function bindLaunchScope(context, scope, registration, pid, executionId) {
  const bound = { ...scope, sessionId: registration.sessionId, client: registration.client, nativeSessionId: registration.nativeSessionId, pid,
    ...(executionId ? { executionId } : {}) };
  return saveScope(context, bound);
}

async function saveScope(context, scope) {
  const file = scopePath(context, scope.sessionId);
  const { revision, ...fields } = scope;
  const record = { ...fields, revision: hashBytes(Buffer.from(canonicalJson(fields))) };
  await assertNoLinks(file);
  await atomicWrite(context.store, file, Buffer.from(`${canonicalJson(record)}\n`));
  await protectLocalFile(file, { store: context.store });
  return record;
}

export async function verifiedSessionScope(context) {
  const actor = context.principal ?? context.credential;
  if (actor?.audience !== 'agent' || !isUuid(actor.sessionId)) fail('scope_unavailable', 'A verified native actor is required.');
  const file = scopePath(context, actor.sessionId);
  await assertNoLinks(file);
  await verifyLocalPermissions(file, { store: context.store });
  const scope = await readFile(file, 'utf8').then(JSON.parse).catch(() => null);
  if (!scope || scope.sessionId !== actor.sessionId || scope.unitId !== actor.unitId || scope.machine !== context.paths.machine
    || !ownsSessionExecution(context, scope) || actor.client && actor.client !== scope.client
    || await context.adapters?.[scope.client]?.confirm?.({ unitId: scope.unitId, client: scope.client, nativeSessionId: scope.nativeSessionId, pid: scope.pid, executionId: scope.executionId, machine: scope.machine, sessionId: scope.sessionId }) !== true) {
    fail('scope_unavailable', 'The native scope binding is no longer owned.');
  }
  const state = await import('./state.mjs').then(module => module.readUnitState(context, parseUnitId(scope.unitId)));
  if (!state || /^removed:\s*true$/m.test(state.bytes.toString('utf8').split(/\r?\n\r?\n/)[0])) fail('scope_unavailable', 'The agent is unavailable.');
  if (scope.clusterId) {
    const choice = await clusterChoices(context, scope.unitId);
    const cluster = choice.clusterId === scope.clusterId && await readCluster(context, scope.clusterId, { machine: scope.machine });
    if (!cluster || choice.ambiguous || cluster.revision !== scope.clusterRevision) fail('scope_unavailable', 'The approved cluster changed.');
    const mapping = cluster.link.kind !== 'none' && await resolveClusterLink(context, cluster.link, scope.machine).catch(() => fail('scope_unavailable', 'The cluster link changed.'));
    if (scope.writeRoots.length && (!mapping || !scope.writeRoots.some(root => pathKey(root.realPath) === pathKey(mapping.localPath)))) fail('scope_unavailable', 'The cluster link changed.');
  }
  const additions = await additionsForUnit(context, scope.unitId);
  scope.contentScope.additionIds = scope.contentScope.additionIds.filter(id => additions.some(item => item.record.id === id));
  for (const root of scope.writeRoots) {
    await assertNoLinks(root.realPath);
    if (canonicalJson(await directoryIdentity(root.realPath)) !== canonicalJson(root.identity)) fail('scope_unavailable', 'The approved directory changed identity.');
    if (root.gitCommonDir) {
      const repository = await readRepositoryIdentity(root.realPath, context.settingsOwner ?? context).catch(() => fail('scope_unavailable', 'The approved repository changed.'));
      if (repository.id !== scope.repositoryId || pathKey(repository.commonDir) !== pathKey(root.gitCommonDir)) fail('scope_unavailable', 'The approved Git common directory changed.');
    }
  }
  return scope;
}

export async function verifiedFilePath(candidate) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || /[\u0000-\u001f\u007f]/.test(candidate)
    || process.platform === 'win32' && (candidate.startsWith('\\\\') || candidate.slice(2).includes(':') || candidate.split(/[\\/]/).some(part => /[. ]$|^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))) {
    fail('scope_unavailable', 'An ordinary absolute local path is required.');
  }
  const requested = path.resolve(candidate), missing = [];
  let ancestor = requested;
  for (;;) {
    try {
      await assertNoLinks(ancestor);
      const state = await lstat(ancestor, { bigint: true });
      const actual = await realpath(ancestor);
      if (pathKey(actual) !== pathKey(ancestor) || state.isSymbolicLink()) fail('scope_unavailable', 'Linked paths cannot grant file authority.');
      if (missing.length && !state.isDirectory() || !missing.length && !state.isFile() && !state.isDirectory()) fail('scope_unavailable', 'The file target is unavailable.');
      return { path: path.join(actual, ...missing), ancestor, identity: `${state.dev}:${state.ino}`, exists: missing.length === 0, state };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) fail('scope_unavailable', 'The file ancestor is unavailable.');
      missing.unshift(path.basename(ancestor)); ancestor = parent;
    }
  }
}

async function access(context, input, write) {
  const candidate = input?.path;
  const scope = await verifiedSessionScope(context), target = await verifiedFilePath(candidate);
  const roots = scope.writeRoots.filter(root => withinClusterRoot(root.realPath, target.path, process.platform));
  if (target.path.split(path.sep).some(part => ['.git', '.m1nd'].includes(part.toLowerCase()))
    || scope.writeRoots.some(root => root.gitCommonDir && withinClusterRoot(root.gitCommonDir, target.path, process.platform))) fail('scope_unavailable', 'Internal Git and M1ND files require their scoped service operation.');
  if (withinClusterRoot(context.paths.mind, target.path, process.platform) || withinClusterRoot(context.paths.localDirectory, target.path, process.platform)) fail('scope_unavailable', 'M1ND records use actor-bound service tools.');
  if (!roots.length) await outsideApproval(context, scope, target, input, write);
  return { scope, target };
}

async function outsideApproval(context, scope, target, input, write) {
  const pattern = { resource: scope.id, path: target.path, operation: write ? 'write' : 'read',
    snapshot: hashBytes(Buffer.from(canonicalJson({ ancestor: target.ancestor, identity: target.identity, exists: target.exists,
      modified: String(target.state.mtimeNs), changed: String(target.state.ctimeNs), size: String(target.state.size),
      expectedRevision: input.expectedRevision ?? null, textHash: write ? hashBytes(Buffer.from(input.text)) : null }))) };
  if (!input.approvalId) {
    const requested = await requestApproval(context, { action: 'file.write', pattern, display: write ? 'Write this exact file outside the cluster' : 'Read this exact file outside the cluster', alwaysAllowed: false, operationId: input.requestId });
    throw new CoreError(409, 'outside_scope', 'This exact file needs person approval.', { approvalId: requested.approval.id });
  }
  const approval = await readApproval(context, input.approvalId);
  if (approval.unitId !== scope.unitId || approval.sessionId !== scope.sessionId || approval.state !== 'approved'
    || approval.action !== 'file.write' || canonicalJson(approval.pattern) !== canonicalJson(pattern)) fail('outside_scope', 'The exact outside-scope operation was not approved.');
  const consumed = path.join(path.dirname(scopePath(context, scope.sessionId)), `outside-${input.approvalId}.json`);
  await assertNoLinks(consumed);
  if (await readFile(consumed).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) fail('outside_scope', 'This one-time operation was already used.');
  return consumed;
}

async function consumeOutside(context, scope, target, input, write) {
  if (scope.writeRoots.some(root => withinClusterRoot(root.realPath, target.path, process.platform))) return;
  const consumed = await outsideApproval(context, scope, target, input, write);
  const handle = await open(consumed, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600).catch(() => fail('outside_scope', 'This one-time operation was already used.'));
  try { await handle.writeFile('{}'); await handle.sync(); } finally { await handle.close(); }
  await protectLocalFile(consumed, { store: context.store });
}

export async function readScopedFile(context, input) {
  const { scope, target } = await access(context, input, false);
  if (!target.exists || !target.state.isFile() || target.state.nlink !== 1n || target.state.size > 1048576n) fail('scope_unavailable', 'The bounded text file is unavailable.');
  await consumeOutside(context, scope, target, input, false);
  const handle = await open(target.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat({ bigint: true });
    if (`${opened.dev}:${opened.ino}` !== target.identity) fail('scope_unavailable', 'The file changed while opening.');
    const bytes = await handle.readFile();
    if (bytes.length > 1048576 || bytes.includes(0)) fail('scope_unavailable', 'Only bounded text files are supported.');
    const verified = await verifiedFilePath(target.path);
    if (verified.identity !== target.identity) fail('scope_unavailable', 'The file changed while reading.');
    await verifiedSessionScope(context);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const sensitive = /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|id_(?:rsa|ecdsa|ed25519)(?:\.pub)?|.*\.(?:pem|key|p12|pfx)|credentials(?:\..*)?)$/i.test(path.basename(target.path));
    return { path: target.path, revision: hashBytes(bytes), text: sensitive ? text.split(/\r?\n/).map(line => line.match(/^\s*(?:export\s+)?["']?([A-Za-z_][A-Za-z0-9_.-]*)["']?\s*[:=]/)?.[1]).filter(Boolean).join('\n') : text };
  } finally { await handle.close(); }
}

export async function writeScopedFile(context, input) {
  if (typeof input?.text !== 'string' || Buffer.byteLength(input.text) > 1048576 || input.expectedRevision !== null && !/^[a-f0-9]{64}$/.test(input.expectedRevision ?? '')) {
    throw new CoreError(422, 'invalid_body', 'A bounded text and exact revision are required.');
  }
  return withLocks(context.store, [`scoped-file:${pathKey(input.path)}`], async () => {
    const { scope, target } = await access(context, input, true);
    if (target.exists && (!target.state.isFile() || target.state.nlink !== 1n)) fail('scope_unavailable', 'Only an ordinary singly linked file may be written.');
    if (!target.exists && path.dirname(target.path) !== target.ancestor) fail('scope_unavailable', 'Create the reviewed parent directory first.');
    const previous = target.exists ? await readFile(target.path) : null;
    if ((previous ? hashBytes(previous) : null) !== input.expectedRevision) fail('revision_conflict', 'The file changed before writing.');
    const checkedTarget = (await access(context, input, true)).target;
    if (checkedTarget.identity !== target.identity || checkedTarget.ancestor !== target.ancestor) fail('scope_unavailable', 'The file ancestor changed before writing.');
    await consumeOutside(context, scope, target, input, true);
    const flags = constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0) | (target.exists ? 0 : constants.O_CREAT | constants.O_EXCL);
    const handle = await open(target.path, flags, 0o600);
    try {
      const opened = await handle.stat({ bigint: true });
      if (opened.nlink !== 1n || target.exists && `${opened.dev}:${opened.ino}` !== target.identity) fail('scope_unavailable', 'The file changed while opening.');
      const checked = await verifiedFilePath(target.path);
      if (checked.identity !== `${opened.dev}:${opened.ino}`) fail('scope_unavailable', 'The parent changed while opening.');
      if (target.exists && hashBytes(await readFile(target.path)) !== input.expectedRevision) fail('revision_conflict', 'The file changed before writing.');
      await verifiedSessionScope(context);
      const bytes = Buffer.from(input.text);
      await handle.writeFile(bytes); await handle.truncate(bytes.length); await handle.sync();
      return { revision: hashBytes(bytes) };
    } finally { await handle.close(); }
  });
}

async function gitSnapshot(context, repository, paths) {
  const options = context.settingsOwner ?? context;
  const filters = await gitRead(repository, ['config', '--get-regexp', '^filter\\.'], { ...options, allowMissing: true });
  if (filters) fail('git_unavailable', 'A repository with executable filters needs a separate review.');
  const commands = await gitRead(repository, ['config', '--get-regexp', '^(core\\.(sshcommand|gitproxy)|remote\\..*\\.(uploadpack|receivepack|vcs))$'], { ...options, allowMissing: true });
  if (commands) fail('git_unavailable', 'A repository with executable Git overrides needs a separate review.');
  const branch = (await gitRead(repository, ['symbolic-ref', '--quiet', '--short', 'HEAD'], options)).trim();
  const head = (await gitRead(repository, ['rev-parse', '--verify', 'HEAD'], options)).trim();
  const indexPath = (await gitRead(repository, ['rev-parse', '--git-path', 'index'], options)).trim();
  const indexFile = path.resolve(repository, indexPath);
  await assertNoLinks(indexFile);
  const index = await readFile(indexFile).then(hashBytes).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const files = [];
  for (const relative of paths) {
    if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => !part || part === '..' || part.toLowerCase() === '.git') || /[\0\r\n]/.test(relative)) fail('git_changed', 'Only reviewed relative task paths are supported.');
    const target = await verifiedFilePath(path.resolve(repository, relative));
    if (!withinClusterRoot(repository, target.path, process.platform) || target.exists && (!target.state.isFile() || target.state.nlink !== 1n)) fail('git_changed', 'A reviewed task path is unavailable.');
    files.push({ path: relative, hash: target.exists ? hashBytes(await readFile(target.path)) : null, identity: target.identity });
  }
  const configuration = hashBytes(Buffer.from(await gitRead(repository, ['config', '--null', '--list'], options)));
  return { branch, head, index, files, configuration };
}

// Only a desktop instruction or the service's authenticated Run handler creates intent.
export async function approveScopedGit(context, input) {
  if (context.principal?.audience !== 'desktop' || context.principal.unitId !== 'root:master'
    || input.confirmed !== true || !['git.commit', 'git.push'].includes(input.action)
    || !isUuid(input.sessionId) || !Array.isArray(input.paths) || !input.paths.length || new Set(input.paths).size !== input.paths.length
    || typeof input.branch !== 'string' || !input.branch || input.action === 'git.commit' && (typeof input.message !== 'string' || !input.message.trim())) {
    throw new CoreError(403, 'git_intent_required', 'An explicit scoped person instruction is required.');
  }
  return prepareGitIntent(context, input, 'approved');
}

export async function requestScopedGit(context, input) {
  const scope = await verifiedSessionScope(context);
  if (!['git.commit', 'git.push'].includes(input.action) || !Array.isArray(input.paths) || !input.paths.length
    || new Set(input.paths).size !== input.paths.length || typeof input.branch !== 'string' || !input.branch
    || input.action === 'git.commit' && (typeof input.message !== 'string' || !input.message.trim())) throw new CoreError(422, 'invalid_body', 'An exact Git instruction is required.');
  return prepareGitIntent(context, { ...input, sessionId: scope.sessionId }, 'pending');
}

export async function assertGitCapability(context, action, repository) {
  const scope = await verifiedSessionScope(context);
  const { sessionGitPermissions } = await import('./adapters.mjs');
  const permissions = await sessionGitPermissions(context, scope.sessionId, { unitId: scope.unitId, client: scope.client, repository });
  if (!permissions.some(permission => permission.actions.includes(action))) fail('git_capability_required', 'The reviewed session Git capability is unavailable.');
}

async function prepareGitIntent(context, input, state) {
  const file = scopePath(context, input.sessionId);
  await assertNoLinks(file);
  const scope = JSON.parse(await readFile(file, 'utf8'));
  const actor = { ...context, principal: { audience: 'agent', unitId: scope.unitId, sessionId: input.sessionId } };
  await verifiedSessionScope(actor);
  const root = scope.writeRoots.find(root => pathKey(root.realPath) === pathKey(input.repository));
  if (!root) fail('outside_scope', 'The repository is outside the approved session scope.');
  const { sessionGitPermissions } = await import('./adapters.mjs');
  const permissions = await sessionGitPermissions(context, input.sessionId, { unitId: scope.unitId, client: scope.client, repository: root.realPath });
  if (!permissions.some(permission => permission.actions.includes(input.action))) fail('git_capability_required', 'The reviewed session Git capability is unavailable.');
  const snapshot = await gitSnapshot(context, root.realPath, input.paths);
  if (snapshot.branch !== input.branch) fail('git_changed', 'The reviewed branch changed.');
  if (input.action === 'git.push' && (typeof input.remote !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.remote))) fail('git_changed', 'Name one configured remote explicitly.');
  const id = randomUUID(), pattern = { repository: root.realPath, args: [input.branch, ...input.paths, ...(input.action === 'git.commit' ? ['--message', input.message] : ['--remote', input.remote])] };
  const requested = state === 'pending' ? await requestApproval(actor, { action: input.action, pattern, display: input.action === 'git.push' ? 'Push this exact branch to the named remote' : 'Commit only these reviewed task paths', alwaysAllowed: false, operationId: id }) : null;
  const intent = { id, scopeId: scope.id, sessionId: input.sessionId, unitId: scope.unitId,
    machine: scope.machine, client: scope.client, repository: root.realPath, action: input.action, paths: input.paths,
    branch: input.branch, message: input.message ?? null, remote: input.remote ?? null, snapshot, state,
    approvalId: requested?.approval.id ?? null, pattern: requested?.approval.pattern ?? null };
  const intentPath = path.join(path.dirname(file), `git-${id}.json`);
  await atomicWrite(context.store, intentPath, Buffer.from(canonicalJson(intent)));
  await protectLocalFile(intentPath, { store: context.store });
  return { intentId: id, ...(requested ? { approvalId: requested.approval.id, state: 'pending' } : {}) };
}

export async function runScopedGit(context, input) {
  const scope = await verifiedSessionScope(context);
  if (!isUuid(input?.intentId)) fail('git_intent_required', 'Git needs an explicit operation intent.');
  const file = path.join(path.dirname(scopePath(context, scope.sessionId)), `git-${input.intentId}.json`);
  await assertNoLinks(file);
  const intent = await readFile(file, 'utf8').then(JSON.parse).catch(() => null);
  if (!intent || intent.scopeId !== scope.id || intent.sessionId !== scope.sessionId || intent.unitId !== scope.unitId || intent.machine !== scope.machine) fail('git_intent_required', 'This Git instruction belongs to another session.');
  const { sessionGitPermissions } = await import('./adapters.mjs');
  const permissions = await sessionGitPermissions(context, scope.sessionId, { unitId: scope.unitId, client: scope.client, repository: intent.repository });
  if (!permissions.some(permission => permission.actions.includes(intent.action))) fail('git_capability_required', 'The session Git capability was revoked.');
  return withLocks(context.store, [`git:${pathKey(intent.repository)}`], async () => {
    await assertGitCapability(context, intent.action, intent.repository);
    const current = JSON.parse(await readFile(file, 'utf8'));
    if (current.state === 'done') return current.result;
    if (current.state === 'pending') {
      const approval = await readApproval(context, current.approvalId);
      if (approval.state !== 'approved' || approval.unitId !== scope.unitId || approval.sessionId !== scope.sessionId
        || approval.action !== intent.action || canonicalJson(approval.pattern) !== canonicalJson(intent.pattern)) fail('git_intent_required', 'The person has not approved this exact Git instruction.');
    } else if (current.state !== 'approved') fail('git_changed', 'The interrupted Git operation must be reconciled.');
    const snapshot = await gitSnapshot(context, intent.repository, intent.paths);
    if (canonicalJson(snapshot) !== canonicalJson(intent.snapshot)) fail('git_changed', 'The branch, HEAD, index or reviewed files changed.');
    await atomicWrite(context.store, file, Buffer.from(canonicalJson({ ...intent, state: 'executing' })));
    const options = context.settingsOwner ?? context;
    if (intent.action === 'git.commit') {
      await gitRead(intent.repository, ['add', '--', ...intent.paths], options);
      await assertGitCapability(context, intent.action, intent.repository);
      const staged = await gitSnapshot(context, intent.repository, intent.paths);
      if (staged.branch !== snapshot.branch || staged.head !== snapshot.head || staged.configuration !== snapshot.configuration
        || canonicalJson(staged.files) !== canonicalJson(snapshot.files)) fail('git_changed', 'The reviewed Git state changed while staging the task.');
      await gitRead(intent.repository, ['-c', 'commit.gpgsign=false', 'commit', '--only', '--message', intent.message, '--', ...intent.paths], options);
    } else {
      const urls = (await gitRead(intent.repository, ['remote', 'get-url', '--push', '--all', intent.remote], options)).trim().split(/\r?\n/);
      if (urls.length !== 1 || !urls[0] || !/^(?:https:\/\/|ssh:\/\/|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:)/.test(urls[0]) && !path.isAbsolute(urls[0])) fail('git_unavailable', 'The named remote has an unsupported or ambiguous transport.');
      if (path.isAbsolute(urls[0])) await verifiedFilePath(urls[0]);
      await gitRead(intent.repository, ['-c', 'push.gpgSign=false', '-c', 'protocol.ext.allow=never', 'push', '--receive-pack=git-receive-pack', '--', intent.remote, `HEAD:refs/heads/${intent.branch}`], options);
    }
    const result = { intentId: intent.id, state: 'done', action: intent.action };
    await atomicWrite(context.store, file, Buffer.from(canonicalJson({ ...intent, state: 'done', result })));
    return result;
  });
}
