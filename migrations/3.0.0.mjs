import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, hashBytes, uuidV8 } from '../engine/service/identity.mjs';
import { atomicWrite, createStore } from '../engine/service/store.mjs';

export const version = '3.0.0';
export const idempotent = true;

const NOTICE_ID = uuidV8(['migration-notice', '3.0.0', 'state']);

async function stats(target) {
  try { return await lstat(target); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

function relativeTo(root, target) {
  return path.relative(root, target).split(path.sep).join('/');
}

function headerValue(bytes, name) {
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  const end = text.search(/\r?\n\r?\n/);
  const header = end === -1 ? text : text.slice(0, end);
  let value = '';
  for (const line of header.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    if (line.slice(0, separator).trim().toLowerCase() === name) value = line.slice(separator + 1).trim();
  }
  return value;
}

function messageId(filename, bytes) {
  const explicit = headerValue(bytes, 'id');
  if (explicit) return explicit;
  return `legacy-${createHash('sha256').update(filename).update('\0').update(headerValue(bytes, 'to')).update('\0').update(headerValue(bytes, 'from')).update('\0').update(bytes).digest('hex').slice(0, 32)}`;
}

async function regularFiles(directory) {
  const state = await stats(directory);
  if (!state || state.isSymbolicLink() || !state.isDirectory()) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
}

async function scopeDirectories(userPath) {
  const scopes = [userPath];
  for (const bucket of ['envs', 'projects']) {
    const directory = path.join(userPath, bucket);
    const state = await stats(directory);
    if (!state || state.isSymbolicLink() || !state.isDirectory()) continue;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      scopes.push(path.join(directory, entry.name));
    }
  }
  return scopes;
}

export async function migrate({ userPath, faultAfterMoves = null } = {}) {
  const root = path.resolve(userPath);
  const rootState = await stats(root);
  if (!rootState || rootState.isSymbolicLink() || !rootState.isDirectory()) return { moved: 0, notice: false };
  const progressPath = path.join(root, 'relay', 'migration-3.0.0.json');
  const store = createStore({
    root,
    mindPath: root,
    localDirectory: path.join(root, 'relay'),
    confineRoot: root,
    autoRecover: false,
  });
  let progress = { format: 'hivem1nd-migration-3.0.0', completed: false, moves: [], stateConflict: false, notice: false };
  const existing = await stats(progressPath);
  if (existing && !existing.isSymbolicLink() && existing.isFile()) {
    progress = JSON.parse(await readFile(progressPath, 'utf8'));
    if (progress.completed) return { moved: 0, notice: false };
  }
  let moved = 0;
  const movedAlready = new Set(progress.moves.map((entry) => entry.from));

  async function checkpoint() {
    await atomicWrite(store, progressPath, Buffer.from(`${JSON.stringify(progress)}\n`));
  }

  async function finishMove(source, target, bytes) {
    const written = await readFile(target);
    if (!written.equals(bytes)) throw new CoreError(500, 'migration_verify_failed', 'A migrated file did not match its source bytes.');
    await unlink(source);
    progress.moves.push({ from: relativeTo(root, source), to: relativeTo(root, target), sha256: hashBytes(bytes) });
    await checkpoint();
    moved += 1;
    if (faultAfterMoves !== null && moved >= faultAfterMoves) {
      throw new CoreError(500, 'MIGRATION_INTERRUPTED', 'Migration stopped so it can resume.');
    }
  }

  async function writeNew(source, target, bytes) {
    if (movedAlready.has(relativeTo(root, source))) {
      const current = await stats(target);
      if (current && !current.isSymbolicLink() && (await readFile(target)).equals(bytes)) {
        if (await stats(source)) await unlink(source);
        return;
      }
    }
    await atomicWrite(store, target, bytes);
    await finishMove(source, target, bytes);
  }

  async function retireSource(source, directory, bytes) {
    const digest = hashBytes(bytes);
    let conflict = path.join(directory, `${path.basename(source)}.conflict-${digest.slice(0, 16)}`);
    const existing = await stats(conflict);
    if (existing && !existing.isSymbolicLink() && !(await readFile(conflict)).equals(bytes)) {
      conflict = path.join(directory, `${path.basename(source)}.conflict-${digest}`);
    }
    const conflictState = await stats(conflict);
    if (conflictState?.isSymbolicLink()) throw new CoreError(422, 'unsafe_path', 'Refusing to follow a link.');
    if (!conflictState) await atomicWrite(store, conflict, bytes);
    else if (!(await readFile(conflict)).equals(bytes)) throw new CoreError(409, 'migration_conflict', 'A conflict copy does not match the source bytes.');
    await finishMove(source, conflict, bytes);
  }

  const userState = path.join(root, 'state', 'user.md');
  const masterState = path.join(root, 'state', 'master.md');
  const userStateStats = await stats(userState);
  if (userStateStats?.isFile() && !userStateStats.isSymbolicLink()) {
    const bytes = await readFile(userState);
    const masterStats = await stats(masterState);
    if (!masterStats) await writeNew(userState, masterState, bytes);
    else if (masterStats.isSymbolicLink()) throw new CoreError(422, 'unsafe_path', 'Refusing to follow a link.');
    else if ((await readFile(masterState)).equals(bytes)) await finishMove(userState, masterState, bytes);
    else {
      progress.stateConflict = true;
      await retireSource(userState, path.dirname(userState), bytes);
    }
  }

  for (const scope of await scopeDirectories(root)) {
    const sourceDir = path.join(scope, 'inbox', 'user');
    const targetDir = path.join(scope, 'inbox', 'master');
    const sourceStats = await stats(sourceDir);
    if (!sourceStats || sourceStats.isSymbolicLink() || !sourceStats.isDirectory()) continue;
    await mkdir(targetDir, { recursive: true });
    for (const name of await regularFiles(sourceDir)) {
      const source = path.join(sourceDir, name);
      const bytes = await readFile(source);
      const id = messageId(name, bytes);
      let match = null;
      for (const targetName of await regularFiles(targetDir)) {
        const target = path.join(targetDir, targetName);
        const targetBytes = await readFile(target);
        if (messageId(targetName, targetBytes) !== id) continue;
        match = { target, targetBytes };
        break;
      }
      if (!match) {
        const destination = path.join(targetDir, name);
        if (!await stats(destination)) await writeNew(source, destination, bytes);
        else await retireSource(source, targetDir, bytes);
      } else if (match.targetBytes.equals(bytes)) await finishMove(source, match.target, bytes);
      else await retireSource(source, targetDir, bytes);
    }
    if ((await readdir(sourceDir)).length === 0) await rmdir(sourceDir);
  }

  const archiveSource = path.join(root, 'relay', 'archive', 'user');
  const archiveTarget = path.join(root, 'relay', 'archive', 'master');
  const archiveStats = await stats(archiveSource);
  if (archiveStats?.isDirectory() && !archiveStats.isSymbolicLink()) {
    await mkdir(archiveTarget, { recursive: true });
    for (const name of await regularFiles(archiveSource)) {
      const source = path.join(archiveSource, name);
      const bytes = await readFile(source);
      const destination = path.join(archiveTarget, name);
      if (!await stats(destination)) await writeNew(source, destination, bytes);
      else if ((await readFile(destination)).equals(bytes)) await finishMove(source, destination, bytes);
      else await retireSource(source, archiveTarget, bytes);
    }
    if ((await readdir(archiveSource)).length === 0) await rmdir(archiveSource);
  }

  if (progress.stateConflict && !progress.notice) {
    const noticeDir = path.join(root, 'inbox', 'master');
    await mkdir(noticeDir, { recursive: true });
    const noticePath = path.join(noticeDir, `20261010-000000-master-${NOTICE_ID}.md`);
    if (!await stats(noticePath)) {
      const notice = [
        `id: ${NOTICE_ID}`,
        'from: master',
        'from-id: root:master',
        'to: master',
        'to-id: root:master',
        'machine: local',
        'timestamp: 2026-10-10T00:00:00.000Z',
        'priority: normal',
        'subject: Person state conflict',
        'kind: conflict-notice',
        'resource-id: state/user.md',
        'notice-key: migration-3.0.0:state',
        'attachments: []',
        '',
        'The previous person state differed from master and was kept beside it.',
        '',
      ].join('\n');
      await atomicWrite(store, noticePath, Buffer.from(notice));
    }
    progress.notice = true;
    await checkpoint();
  }

  if (moved === 0 && progress.moves.length === 0 && !progress.stateConflict && !existing) return { moved: 0, notice: false };
  progress.completed = true;
  await checkpoint();
  return { moved, notice: progress.notice };
}
