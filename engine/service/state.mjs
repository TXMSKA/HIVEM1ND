import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, parseUnitId, unitStatePath } from './identity.mjs';
import { readBytes } from './store.mjs';

export function stateHeader(bytes, name) {
  const text = bytes.toString('utf8');
  const end = text.search(/\r?\n\r?\n/);
  for (const line of (end < 0 ? text : text.slice(0, end)).split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0 && line.slice(0, colon).trim() === name) return line.slice(colon + 1).trim();
  }
  return null;
}

export function stateRunsIn(bytes) {
  const raw = stateHeader(bytes, 'runs-in');
  if (!raw) return null;
  let choice;
  try { choice = JSON.parse(raw); } catch { /* A malformed stored choice must never fall back. */ }
  if (!choice || Object.keys(choice).sort().join(',') !== 'client,effort,mode,model'
    || !['claude', 'codex', 'cursor', 'lyra'].includes(choice.client) || typeof choice.model !== 'string' || !choice.model
    || choice.client === 'lyra' && (choice.effort !== null || !['fast', 'normal', 'thinking'].includes(choice.mode))
    || choice.client !== 'lyra' && (typeof choice.effort !== 'string' || !choice.effort || choice.mode !== null)) {
    throw new CoreError(422, 'unsupported_launch_choice', 'The stored Runs in choice is invalid.');
  }
  return Object.freeze(choice);
}

export function stateUnitId(bytes, relative) {
  const explicit = stateHeader(bytes, 'unit-id');
  if (explicit) return parseUnitId(explicit).id;
  const name = String(stateHeader(bytes, 'unit') || path.basename(relative, '.md')).toLowerCase();
  const parts = relative.split('/');
  const id = parts[1] === 'projects' ? `project:${parts[2]}:${name}`
    : parts[1] === 'envs' ? `env:${parts[2]}:${name}` : `root:${name}`;
  return parseUnitId(id).id;
}

export async function readUnitState(context, parsed) {
  const relative = unitStatePath(parsed);
  const absolute = path.join(context.paths.mind, ...relative.split('/'));
  const bytes = await readBytes(context.store, absolute);
  if (bytes) {
    try { return stateUnitId(bytes, relative) === parsed.id ? { bytes, relative, absolute } : null; }
    catch { return null; }
  }
  const legacy = `user/state/${parsed.unit}.md`;
  if (legacy === relative) return null;
  const oldAbsolute = path.join(context.paths.mind, ...legacy.split('/'));
  const old = await readBytes(context.store, oldAbsolute);
  if (!old || stateHeader(old, 'unit-id') !== parsed.id) return null;
  return { bytes: old, relative: legacy, absolute: oldAbsolute };
}

export async function readUnitStates(context) {
  const directories = ['user/state'];
  for (const kind of ['envs', 'projects']) {
    const parent = path.join(context.paths.mind, 'user', kind);
    for (const entry of await entries(parent)) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) directories.push(`user/${kind}/${entry.name}/state`);
    }
  }
  const records = new Map();
  for (const directory of directories) {
    for (const entry of await entries(path.join(context.paths.mind, ...directory.split('/')))) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.md') || entry.name.includes('.conflict-')) continue;
      const relative = `${directory}/${entry.name}`;
      const bytes = await readBytes(context.store, path.join(context.paths.mind, ...relative.split('/')));
      if (!bytes) continue;
      try {
        const id = stateUnitId(bytes, relative);
        if (records.has(id)) continue;
        const current = await readUnitState(context, parseUnitId(id));
        if (current) records.set(id, { ...current, id });
      } catch (error) { if (error?.code !== 'invalid_unit' && error?.code !== 'invalid_name') throw error; }
    }
  }
  return [...records.values()];
}

async function entries(directory) {
  try { return await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
}
