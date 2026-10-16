import { watch } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { hashBytes } from './identity.mjs';
import { assertNoLinks, resolveTarget } from './paths.mjs';
import { readBytes, withLocalChanges } from './store.mjs';
import { observeExternal, readComments, readEditor } from './editors.mjs';
import { eligibleTargets, observationSnapshot, observeLocalChange, settleAppliedMarker, targetKey } from '../sync/store.mjs';

export async function watchLocalChanges(runtime, onChanges) {
  const context = {
    store: runtime.sync.store, paths: runtime.paths, projects: runtime.sync.projects,
    sync: runtime.sync, pulse: runtime.pulse, ledger: runtime.ledger,
    bus: runtime.bus, now: runtime.now, principal: { audience: 'desktop', unitId: 'root:master' },
  };
  const known = new Map();
  const validatedHashes = new Map();
  let catalogHash = null;
  const handles = new Map();
  let closed = false;
  let timer = null;
  let running = null;
  let dirty = false;
  let localError = null;
  context.store.localChangesWatched = true;

  function schedule() {
    if (closed) return;
    dirty = true;
    if (timer || running) return;
    timer = setTimeout(() => {
      timer = null;
      running = drain().catch(report).finally(() => {
        running = null;
        if (dirty && !closed) schedule();
      });
    }, 75);
    timer.unref?.();
  }

  function report(error) {
    localError = error;
    runtime.lastError = error;
    runtime.bus?.emit({ name: 'issue.changed', data: { issue: 'local_change_failed', code: error?.code ?? 'sync_failed' } });
  }

  function closeBinding(key) {
    handles.get(key)?.watcher.close();
    handles.delete(key);
  }

  function bindDirectory(key, directory, stats, filename = null) {
    if (closed) return;
    const identity = `${stats.dev}:${stats.ino}:${stats.birthtimeMs}`;
    const previous = handles.get(key);
    if (previous?.identity === identity && previous.directory === directory) return;
    closeBinding(key);
    const watcher = watch(directory, { persistent: false, recursive: filename === null }, (_event, name) => {
      if (filename === null || name === null || String(name).split(/[\\/]/)[0] === filename) schedule();
    });
    watcher.on('error', error => {
      closeBinding(key);
      report(error);
      schedule();
    });
    watcher.unref?.();
    handles.set(key, { watcher, directory, identity });
  }

  async function directoryStats(directory) {
    await assertNoLinks(directory);
    return lstat(directory).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  }

  async function bindRoots() {
    const roots = [path.join(runtime.paths.mind, 'user'), ...runtime.sync.projects.filter(item => item.eligible !== false).map(item => item.localPath)].filter(Boolean);
    const expected = new Set();
    for (const root of roots) {
      const rootKey = `root:${root}`;
      const parentKey = `parent:${root}`;
      expected.add(rootKey);
      expected.add(parentKey);
      const stats = await directoryStats(root);
      if (stats?.isDirectory()) bindDirectory(rootKey, root, stats);
      else closeBinding(rootKey);
      let parent = path.dirname(root);
      let parentStats = await directoryStats(parent);
      while (!parentStats?.isDirectory() && path.dirname(parent) !== parent) {
        parent = path.dirname(parent);
        parentStats = await directoryStats(parent);
      }
      if (parentStats?.isDirectory()) bindDirectory(parentKey, parent, parentStats, path.relative(parent, root).split(path.sep)[0]);
    }
    for (const key of handles.keys()) if (!expected.has(key)) closeBinding(key);
  }

  async function resources() {
    const bytes = await readBytes(context.store, path.join(runtime.paths.mind, 'user', 'gui', 'resources.json'));
    const revision = bytes ? hashBytes(bytes) : null;
    if (revision !== catalogHash) { validatedHashes.clear(); catalogHash = revision; }
    if (!bytes) return [];
    const catalog = JSON.parse(bytes.toString('utf8'));
    return catalog.format === 'hivem1nd-resources-v1' && Array.isArray(catalog.resources) ? catalog.resources : [];
  }

  async function importedTargets() {
    const held = new Set();
    const received = path.join(runtime.paths.localDirectory, 'received');
    const directory = path.join(received, 'groups');
    const names = await readdir(directory).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const name of names.filter(item => /^[a-f0-9-]+\.json$/.test(item))) {
      const bytes = await readBytes(context.store, path.join(directory, name));
      if (!bytes) continue;
      const group = JSON.parse(bytes.toString('utf8'));
      if (!Array.isArray(group.ops)) continue;
      for (const op of group.ops) {
        if (op.conflict || !['write', 'remove'].includes(op.kind)) continue;
        let target = op.target;
        if (!target && typeof op.file === 'string') {
          const relative = path.relative(runtime.paths.mind, op.file).split(path.sep).join('/');
          if (relative.startsWith('user/')) target = { kind: 'mind', path: relative };
        }
        if (!target) continue;
        const key = targetKey(target);
        known.set(key, target);
        if (group.done !== group.ops.length || group.emitted !== true) held.add(key);
      }
    }
    const machines = await readdir(received, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const machine of machines) {
      if (!machine.isDirectory() || machine.isSymbolicLink() || ['groups', 'pending'].includes(machine.name)) continue;
      const directory = path.join(received, machine.name);
      const names = await readdir(directory);
      for (const name of names.filter(item => /^\d+\.applied\.json$/.test(item))) {
        const bytes = await readBytes(context.store, path.join(directory, name));
        if (!bytes) continue;
        const record = JSON.parse(bytes.toString('utf8'));
        for (const target of record.targets ?? []) known.set(targetKey(target), target);
      }
    }
    return held;
  }

  async function reconcile(baseline = false) {
    return withLocalChanges(context.store, () => reconcileLocal(baseline));
  }

  async function reconcileLocal(baseline) {
    const previousError = localError;
    localError = null;
    await bindRoots();
    const held = await importedTargets();
    const targets = await eligibleTargets(runtime.sync);
    const candidates = new Map(targets.map(target => [targetKey(target), target]));
    for (const [key, target] of known) if (!candidates.has(key)) candidates.set(key, target);
    const catalog = await resources();
    let snapshot = await observationSnapshot(runtime.sync);
    const changes = [];
    for (const [key, target] of candidates) {
      if (closed) break;
      if (held.has(key)) continue;
      try {
        const { absolute } = await resolveTarget(runtime.paths, target, { projects: runtime.sync.projects });
        if (snapshot.markers.has(key)) {
          const settled = await settleAppliedMarker(runtime.sync, target);
          if (settled.change) changes.push(settled.change);
          if (settled.settled) snapshot = await observationSnapshot(runtime.sync);
        }
        let bytes = await readBytes(context.store, absolute);
        if (bytes === null && !known.has(key)) continue;
        const entry = target.kind === 'project' ? catalog.find(item => item.project === target.project && item.path === target.path) : null;
        let unchanged = await snapshot.unchanged(target, bytes, bytes === null);
        const revision = bytes ? hashBytes(bytes) : null;
        if (unchanged && (target.kind === 'mind' || validatedHashes.get(key) === revision)) {
          if (bytes) known.set(key, target);
          else known.delete(key);
          continue;
        }
        if (bytes && entry && !entry.readOnly) {
          const validated = await readEditor(context, entry.id);
          if (entry.kind === 'void') {
            // Baseline the bytes just classified. A write that lands before the next read is its own observation.
            const adopt = baseline || unchanged;
            const outside = await observeExternal(context, entry.id, adopt ? { baseline: true, bytes } : {});
            if (outside.issue) continue;
            changes.push(...(outside.changes ?? []));
            if (outside.changed) {
              snapshot.note(outside.changes ?? []);
              validatedHashes.set(key, context.externalHashes.get(entry.id));
              known.set(key, target);
              continue;
            }
          }
          bytes = await readBytes(context.store, absolute);
          const revision = entry.kind === 'void' ? context.externalHashes.get(entry.id) : validated.revision;
          if (!bytes || hashBytes(bytes) !== revision) {
            schedule();
            continue;
          }
          unchanged = await snapshot.unchanged(target, bytes, false);
        }
        if (bytes && target.kind === 'project') {
          const comments = catalog.find(item => item.project === target.project && (item.kind === 'void'
            ? target.path === item.path.replace(/\.json$/, '.comments.json')
            : target.path === `docs/flows/comments/${item.legacyId}.json`));
          if (comments) await readComments(context, comments.id);
        }
        if (!unchanged) {
          const result = await observeLocalChange(runtime.sync, target, { bytes, deleted: bytes === null });
          if (result.staged) { changes.push(result.change); snapshot.note([result.change]); }
        }
        validatedHashes.set(key, bytes ? hashBytes(bytes) : null);
        if (bytes) known.set(key, target);
        else known.delete(key);
      } catch (error) {
        if (error?.code === 'project_unavailable' || error?.code === 'invalid_pack') known.delete(key);
        report(error);
      }
    }
    if (changes.length > 0 && !closed) {
      const unique = [...new Map(changes.map(change => [change.id, change])).values()];
      await runtime.pulse.changed(unique.map(change => change.id));
      await onChanges?.(unique);
    }
    if (previousError && !localError && runtime.lastError === previousError) {
      runtime.lastError = null;
      runtime.bus?.emit({ name: 'issue.changed', data: { issue: 'local_change_recovered' } });
    }
  }

  async function drain() {
    while (dirty && !closed) {
      dirty = false;
      await reconcile();
    }
  }

  async function close() {
    closed = true;
    dirty = false;
    if (timer) clearTimeout(timer);
    timer = null;
    for (const { watcher } of handles.values()) watcher.close();
    handles.clear();
    await running;
    for (const { watcher } of handles.values()) watcher.close();
    handles.clear();
    context.store.localChangesWatched = false;
  }

  try {
    for (const folder of ['acked', 'changes']) {
      const directory = path.join(runtime.paths.localDirectory, 'staging', folder);
      const names = await readdir(directory).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      for (const name of names.filter(item => /^[a-f0-9-]+\.json$/.test(item))) {
        const bytes = await readBytes(context.store, path.join(directory, name));
        if (!bytes) continue;
        const change = JSON.parse(bytes.toString('utf8'));
        if (change.target && change.operation !== 'delete') known.set(targetKey(change.target), change.target);
      }
    }
    await reconcile(true);
  } catch (error) {
    await close();
    throw error;
  }
  if (dirty) schedule();
  return close;
}
