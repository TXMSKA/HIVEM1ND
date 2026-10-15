import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, canonicalJson, isUuid } from './identity.mjs';
import { directoryIdentity, gitRead, pathKey } from './cluster-git.mjs';
import { assertNoLinks } from './paths.mjs';
import { readBoundScope } from './file-access.mjs';
import { sessionOwnership } from './adapters.mjs';
import { readPlanSessionScope } from './runs.mjs';
import { commitTransaction, readBytes, revisionOf, withLocks } from './store.mjs';

const CACHE_MS = 15000;
const WRITE_MS = 60000;
const GIT_MS = 10000;
const KINDS = new Set(['repository', 'worktree', 'folder', 'private']);

function unavailable(code = 'unverified') { throw new CoreError(409, code, 'The checkout of this session cannot be verified.'); }

// Which folder (repository, worktree, plain folder or private directory) a session runs in, and on which branch, now.
// The folder is the immutable launch directory of its bound scope; the branch is a bounded read-only Git answer.
// Nothing is guessed: a manual session, another machine's session or an unverifiable one is reported as not known.
export async function readSessionCheckout(context, sessionId) {
  const principal = context.principal;
  if (principal?.audience !== 'desktop' || principal.capabilities && !principal.capabilities.includes('read')) {
    throw new CoreError(403, 'forbidden', 'Only an authorized desktop may read a session checkout.');
  }
  if (!isUuid(sessionId)) throw new CoreError(404, 'session_not_found', 'The session does not exist.');
  const cache = context.store.checkoutCache ??= new Map();
  const cached = cache.get(sessionId);
  if (cached && context.now() - cached.at < CACHE_MS) return structuredClone(cached.body);
  const body = await observe(context, sessionId);
  cache.set(sessionId, { at: context.now(), body });
  return structuredClone(body);
}

async function observe(context, sessionId) {
  const unknown = reason => ({ sessionId, known: false, reason });
  const owned = await sessionOwnership(context, sessionId);
  const plan = owned ? null : await readPlanSessionScope(context, sessionId);
  if (!owned && !plan) throw new CoreError(404, 'session_not_found', 'The session does not exist.');
  const machine = owned ? owned.registration.machine : plan.machine;
  if (machine && machine !== context.paths.machine) return unknown('other_machine');
  if (owned && owned.registration.launchKind !== 'cli') return unknown('manual');
  const live = owned ? owned.live : plan.live;
  const bound = owned ? await readBoundScope(context, sessionId) : plan.scope && { scope: plan.scope, directory: plan.directory };
  const directory = owned ? path.join(context.paths.localDirectory, 'sessions', sessionId) : plan.directory;
  if (!live) return await lastSeen(context, directory, sessionId) ?? unknown('not_observed');
  if (!bound) return unknown('unverified');
  let fact;
  try { fact = await checkout(context, bound); }
  catch (error) { return unknown(error.code === 'git_unavailable' ? 'git_unavailable' : 'unverified'); }
  const observation = { sessionId, ...fact, observedAt: new Date(context.now()).toISOString() };
  await remember(context, directory, observation);
  return { ...observation, live: true };
}

async function checkout(context, { scope, directory }) {
  const root = scope.writeRoots[0] ?? null;
  const base = { repositoryId: null, branch: null, head: null, detached: false };
  if (!root) return { path: directory, kind: 'private', ...base };
  await assertNoLinks(root.realPath);
  if (canonicalJson(await directoryIdentity(root.realPath).catch(() => unavailable())) !== canonicalJson(root.identity)) unavailable();
  if (!root.gitCommonDir) return { path: root.realPath, kind: 'folder', ...base };
  const options = { ...(context.settingsOwner ?? context), deadline: Date.now() + GIT_MS, readBudget: { remaining: 1048576 } };
  const gitDir = (await gitRead(root.realPath, ['rev-parse', '--absolute-git-dir'], options)).trim();
  if (!gitDir || /[\r\n\0]/.test(gitDir)) unavailable('git_unavailable');
  const actual = pathKey(await realpath(path.resolve(root.realPath, gitDir)).catch(() => unavailable()));
  const common = pathKey(root.gitCommonDir);
  const kind = actual === common ? 'repository' : actual.startsWith(common + path.sep + 'worktrees' + path.sep) ? 'worktree' : unavailable();
  const abbreviated = (await gitRead(root.realPath, ['rev-parse', '--abbrev-ref', 'HEAD'], options)).trim();
  const head = (await gitRead(root.realPath, ['rev-parse', 'HEAD'], options)).trim();
  if (!abbreviated || /[\r\n\0]/.test(abbreviated) || !/^[a-f0-9]{40,64}$/.test(head)) unavailable('git_unavailable');
  const detached = abbreviated === 'HEAD';
  return { path: root.realPath, kind, repositoryId: scope.repositoryId ?? null, branch: detached ? null : abbreviated, head, detached };
}

const recordPath = directory => path.join(directory, 'checkout.json');

// The last live reading stays on this machine, so a stopped session still says where it ran.
async function remember(context, directory, observation) {
  const written = context.store.checkoutWrites ??= new Map();
  const { observedAt, ...fact } = observation;
  const key = canonicalJson(fact), previous = written.get(observation.sessionId);
  if (previous?.key === key && context.now() - previous.at < WRITE_MS) return;
  try {
    await withLocks(context.store, [`checkout:${observation.sessionId}`], async () => {
      const file = recordPath(directory), before = await readBytes(context.store, file);
      await commitTransaction(context.store, { id: randomUUID(), entries: [{ resource: file, recordPath: file, private: true,
        beforeRevision: revisionOf(before), afterBytes: Buffer.from(`${canonicalJson({ format: 'hivem1nd-session-checkout-v1', ...observation })}\n`) }], events: [] });
    });
    written.set(observation.sessionId, { key, at: context.now() });
  } catch { /* A reading that cannot be kept is still a true reading. */ }
}

async function lastSeen(context, directory, sessionId) {
  let record;
  try { record = JSON.parse(await readBytes(context.store, recordPath(directory))); } catch { return null; }
  if (record?.format !== 'hivem1nd-session-checkout-v1' || record.sessionId !== sessionId || !KINDS.has(record.kind)
    || typeof record.path !== 'string' || typeof record.observedAt !== 'string') return null;
  const { format, ...fact } = record;
  return { ...fact, live: false };
}
